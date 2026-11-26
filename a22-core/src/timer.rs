//! Timer engine. Pure functions taking an explicit `now`.
//!
//! Month/year steps replicate JS `Date.setMonth`/`setFullYear` in the timezone of
//! `now`: local wall-clock fields with overflow, not clamping (Jan 31 + 1 month →
//! Mar 3 when Feb has 28 days; Feb 29 + 1 year → Mar 1 in a non-leap year).
//! Nonexistent/ambiguous local times follow V8 normalization (verified in Node
//! under Europe/Belgrade): gap → mapped with the pre-transition offset (result
//! renders shifted forward by the gap length), overlap → first occurrence.
//! Status labels stay on the TypeScript side.

use chrono::{DateTime, Datelike, Duration, MappedLocalTime, NaiveDate, NaiveDateTime, Offset, SecondsFormat, TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};

use crate::types::{ItemTimerLink, Timer, TimerIntervalUnit};

const HOUR_MS: i64 = 60 * 1000 * 60;
const DAY_MS: i64 = 24 * HOUR_MS;
const YELLOW_WARNING_MS: i64 = DAY_MS;
const RUN_LOOP_GUARD: u32 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VisualState {
    Red,
    Blue,
    Yellow,
    Green,
    Muted,
}

/// Timer status without label text (labels stay in the TS view model).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerStatus {
    pub visual_state: VisualState,
    /// Unix milliseconds; `None` when not applicable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<i64>,
}

/// Parse an ISO-8601 UTC instant; `None` for invalid input (TS `toValidDate`).
fn parse_instant(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value).ok().map(|dt| dt.with_timezone(&Utc))
}

/// Whether the base time carries an explicit clock time (00:00:00 = date-only).
/// Compared in UTC; identical to the TS local-time check for all whole-hour-offset zones.
pub fn has_explicit_time(base_at: &str) -> bool {
    let Some(date) = parse_instant(base_at) else {
        return false;
    };
    date.hour() != 0 || date.minute() != 0 || date.second() != 0
}

/// Next run strictly after `now` (TS `getNextTimerRunAt`).
pub fn next_run_at<Tz: TimeZone>(timer: &Timer, now: &DateTime<Tz>) -> Option<DateTime<Tz>> {
    let tz = now.timezone();
    let base = parse_instant(&timer.base_at)?.with_timezone(&tz);
    if !timer.is_active {
        return None;
    }
    let schedule = match &timer.schedule {
        Some(schedule) if schedule.every > 0 => schedule,
        _ => return (base > *now).then_some(base),
    };
    let mut next = base;
    let mut guard = 0u32;
    while next <= *now && guard < RUN_LOOP_GUARD {
        next = add_by_schedule(&tz, &next, schedule.every, schedule.unit);
        guard += 1;
    }
    (next > *now).then_some(next)
}

/// Last run at or before `now` (TS `getLastTimerRunAt`).
pub fn last_run_at<Tz: TimeZone>(timer: &Timer, now: &DateTime<Tz>) -> Option<DateTime<Tz>> {
    let tz = now.timezone();
    let base = parse_instant(&timer.base_at)?.with_timezone(&tz);
    if !timer.is_active {
        return None;
    }
    let schedule = match &timer.schedule {
        Some(schedule) if schedule.every > 0 => schedule,
        _ => return (base <= *now).then_some(base),
    };
    let mut next = base;
    let mut previous: Option<DateTime<Tz>> = None;
    let mut guard = 0u32;
    while next <= *now && guard < RUN_LOOP_GUARD {
        let advanced = add_by_schedule(&tz, &next, schedule.every, schedule.unit);
        previous = Some(next);
        next = advanced;
        guard += 1;
    }
    previous
}

/// Visual state per the TS `getTimerStatus` precedence: red → blue → yellow/green/muted.
pub fn timer_status<Tz: TimeZone>(timer: &Timer, last_checked_at: &str, now: &DateTime<Tz>) -> TimerStatus {
    if !timer.is_active || parse_instant(&timer.base_at).is_none() {
        return TimerStatus { visual_state: VisualState::Muted, next_run_at: None, last_run_at: None };
    }
    let next_ms = next_run_at(timer, now).map(|dt| dt.timestamp_millis());
    let last_ms = last_run_at(timer, now).map(|dt| dt.timestamp_millis());
    let checked_ms = parse_instant(last_checked_at).map(|dt| dt.timestamp_millis());

    let is_red = match (last_ms, checked_ms) {
        (Some(last), Some(checked)) => checked < last,
        (Some(_), None) => true,
        _ => false,
    };
    if is_red {
        return TimerStatus { visual_state: VisualState::Red, next_run_at: next_ms, last_run_at: last_ms };
    }

    let is_blue = match (last_ms, checked_ms, next_ms) {
        (Some(last), Some(checked), _) => checked > last,
        (None, Some(checked), Some(next)) => checked >= next,
        _ => false,
    };
    if is_blue {
        return TimerStatus { visual_state: VisualState::Blue, next_run_at: next_ms, last_run_at: last_ms };
    }

    match next_ms {
        Some(next) => {
            let remaining = next - now.timestamp_millis();
            let visual_state = if remaining <= YELLOW_WARNING_MS {
                VisualState::Yellow
            } else if last_ms.is_some() {
                VisualState::Green
            } else {
                VisualState::Muted
            };
            TimerStatus { visual_state, next_run_at: next_ms, last_run_at: last_ms }
        }
        None => TimerStatus { visual_state: VisualState::Green, next_run_at: None, last_run_at: last_ms },
    }
}

/// Next `lastCheckedAt` after a cycle click (TS `getTimerCycleNextCheckedAt`), ISO-8601 UTC.
pub fn cycle_next_checked_at<Tz: TimeZone>(timer: &Timer, link: &ItemTimerLink, now: &DateTime<Tz>) -> String {
    let status = timer_status(timer, &link.last_checked_at, now);
    let (pick, fallback_ms) = match status.visual_state {
        VisualState::Red => (status.last_run_at, now.timestamp_millis()),
        VisualState::Blue => (status.last_run_at, 0),
        _ => (status.next_run_at, now.timestamp_millis()),
    };
    to_iso_ms(pick.unwrap_or(fallback_ms))
}

/// One schedule step (TS `addBySchedule`). Hours/days/weeks are plain millisecond
/// arithmetic; months/years operate on local wall-clock fields with JS overflow.
fn add_by_schedule<Tz: TimeZone>(tz: &Tz, base: &DateTime<Tz>, every: i64, unit: TimerIntervalUnit) -> DateTime<Tz> {
    match unit {
        TimerIntervalUnit::Hours => from_ms(tz, base.timestamp_millis().saturating_add(every.saturating_mul(HOUR_MS))),
        TimerIntervalUnit::Days => from_ms(tz, base.timestamp_millis().saturating_add(every.saturating_mul(DAY_MS))),
        TimerIntervalUnit::Weeks => from_ms(tz, base.timestamp_millis().saturating_add(every.saturating_mul(7 * DAY_MS))),
        TimerIntervalUnit::Months | TimerIntervalUnit::Years => {
            let naive = base.naive_local();
            let date = step_local_date(naive.date(), every, unit == TimerIntervalUnit::Months);
            from_local_v8(tz, date.and_time(naive.time()))
        }
    }
}

/// JS `setMonth`/`setFullYear` on a local calendar date: the day-of-month field is
/// kept and overflows into following months when the target month is shorter
/// (Jan 31 + 1 month → Mar 3 in a non-leap year).
fn step_local_date(date: NaiveDate, every: i64, monthly: bool) -> NaiveDate {
    let day = date.day();
    let target_first = if monthly {
        let total = date.year() as i64 * 12 + date.month() as i64 - 1 + every;
        NaiveDate::from_ymd_opt(total.div_euclid(12) as i32, total.rem_euclid(12) as u32 + 1, 1).expect("month in range")
    } else {
        NaiveDate::from_ymd_opt(date.year() + every as i32, date.month(), 1).expect("year in range")
    };
    let days_in_target = target_first.num_days_in_month() as u32;
    if day <= days_in_target {
        NaiveDate::from_ymd_opt(target_first.year(), target_first.month(), day).expect("valid date")
    } else {
        let next_first = if target_first.month() == 12 {
            NaiveDate::from_ymd_opt(target_first.year() + 1, 1, 1).expect("valid date")
        } else {
            NaiveDate::from_ymd_opt(target_first.year(), target_first.month() + 1, 1).expect("valid date")
        };
        next_first + Duration::days((day - days_in_target) as i64 - 1)
    }
}

/// Map a local wall-clock time to an instant following V8's rules (verified in
/// Node): single → itself; ambiguous → first occurrence; gap → mapped with the
/// pre-transition offset.
fn from_local_v8<Tz: TimeZone>(tz: &Tz, naive: NaiveDateTime) -> DateTime<Tz> {
    match tz.from_local_datetime(&naive) {
        MappedLocalTime::Single(dt) => dt,
        MappedLocalTime::Ambiguous(earlier, _) => earlier,
        MappedLocalTime::None => {
            let first_offset = tz.offset_from_utc_datetime(&naive);
            let second_naive = naive - Duration::milliseconds(first_offset.fix().local_minus_utc() as i64 * 1000);
            let pre_offset = if second_naive < naive { tz.offset_from_utc_datetime(&second_naive) } else { first_offset };
            let result_naive = naive - Duration::milliseconds(pre_offset.fix().local_minus_utc() as i64 * 1000);
            tz.from_utc_datetime(&result_naive)
        }
    }
}

fn from_ms<Tz: TimeZone>(tz: &Tz, ms: i64) -> DateTime<Tz> {
    DateTime::<Utc>::from_timestamp_millis(ms).expect("millisecond timestamp in range").with_timezone(tz)
}

fn to_iso_ms(ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms).expect("millisecond timestamp in range").to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, NaiveDate, Weekday};

    /// Europe/Belgrade for golden tests: CET (UTC+1) with DST from the last Sunday
    /// of March to the last Sunday of October, both at 01:00 UTC — unchanged since
    /// 1981, covering every date in `timer.json`.
    #[derive(Debug, Clone)]
    struct Belgrade;

    impl Belgrade {
        fn standard() -> FixedOffset {
            FixedOffset::east_opt(3600).expect("valid offset")
        }

        fn daylight() -> FixedOffset {
            FixedOffset::east_opt(7200).expect("valid offset")
        }

        /// DST start/end instants (01:00 UTC) for the given year.
        fn dst_bounds(year: i32) -> (NaiveDateTime, NaiveDateTime) {
            let last_sunday = |month: u32| {
                let next_first =
                    if month == 12 { NaiveDate::from_ymd_opt(year + 1, 1, 1).expect("valid date") } else { NaiveDate::from_ymd_opt(year, month + 1, 1).expect("valid date") };
                let mut day = next_first - Duration::days(1);
                while day.weekday() != Weekday::Sun {
                    day -= Duration::days(1);
                }
                day.and_hms_opt(1, 0, 0).expect("valid time")
            };
            (last_sunday(3), last_sunday(10))
        }

        fn offset_at(utc: &NaiveDateTime) -> FixedOffset {
            for year in utc.year() - 1..=utc.year() + 1 {
                let (start, end) = Self::dst_bounds(year);
                if start <= *utc && *utc < end {
                    return Self::daylight();
                }
            }
            Self::standard()
        }
    }

    impl TimeZone for Belgrade {
        type Offset = FixedOffset;

        fn from_offset(_offset: &FixedOffset) -> Self {
            Belgrade
        }

        fn offset_from_utc_datetime(&self, utc: &NaiveDateTime) -> FixedOffset {
            Self::offset_at(utc)
        }

        fn offset_from_utc_date(&self, utc: &NaiveDate) -> FixedOffset {
            Self::offset_at(&utc.and_hms_opt(12, 0, 0).expect("valid time"))
        }

        fn offset_from_local_datetime(&self, local: &NaiveDateTime) -> MappedLocalTime<FixedOffset> {
            let mut results = Vec::new();
            for offset in [Self::standard(), Self::daylight()] {
                let utc_naive = *local - Duration::milliseconds(offset.local_minus_utc() as i64 * 1000);
                if Self::offset_at(&utc_naive) == offset {
                    results.push((utc_naive.and_utc().timestamp(), offset));
                }
            }
            match results.len() {
                0 => MappedLocalTime::None,
                1 => MappedLocalTime::Single(results.into_iter().next().expect("result").1),
                _ => {
                    results.sort_by_key(|(timestamp, _)| *timestamp);
                    MappedLocalTime::Ambiguous(results[0].1, results[1].1)
                }
            }
        }

        fn offset_from_local_date(&self, local: &NaiveDate) -> MappedLocalTime<FixedOffset> {
            self.offset_from_local_datetime(&local.and_hms_opt(12, 0, 0).expect("valid time"))
        }
    }

    fn belgrade_naive(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S").expect("valid naive")
    }

    #[test]
    fn v8_gap_maps_with_pre_transition_offset() {
        // 2026-03-29: transition at 01:00Z (+1 → +2); local 02:00–02:59 do not exist.
        let dt = from_local_v8(&Belgrade, belgrade_naive("2026-03-29T02:30:00"));
        assert_eq!(dt.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Secs, true), "2026-03-29T01:30:00Z");
    }

    #[test]
    fn v8_ambiguous_picks_first_occurrence() {
        // 2025-10-26: transition at 01:00Z (+2 → +1); local 02:00–02:59 occur twice.
        let dt = from_local_v8(&Belgrade, belgrade_naive("2025-10-26T02:30:00"));
        assert_eq!(dt.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Secs, true), "2025-10-26T00:30:00Z");
    }

    #[test]
    fn month_and_year_steps_overflow_like_js() {
        assert_eq!(step_local_date(NaiveDate::from_ymd_opt(2026, 1, 31).expect("valid"), 1, true), NaiveDate::from_ymd_opt(2026, 3, 3).expect("valid"));
        assert_eq!(step_local_date(NaiveDate::from_ymd_opt(2024, 1, 31).expect("valid"), 1, true), NaiveDate::from_ymd_opt(2024, 3, 2).expect("valid"));
        assert_eq!(step_local_date(NaiveDate::from_ymd_opt(2024, 2, 29).expect("valid"), 1, false), NaiveDate::from_ymd_opt(2025, 3, 1).expect("valid"));
    }

    #[test]
    fn explicit_time_checks() {
        assert!(!has_explicit_time("2026-09-01T00:00:00.000Z"));
        assert!(has_explicit_time("2026-09-01T15:30:00.000Z"));
        assert!(!has_explicit_time("not-a-date"));
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TimerVector {
        name: String,
        timer: Timer,
        last_checked_at: String,
        now: String,
        expected: Expected,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Expected {
        next_run_at: Option<String>,
        last_run_at: Option<String>,
        status: StatusExpected,
        cycle_next_checked_at: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StatusExpected {
        visual_state: VisualState,
        next_run_at: Option<String>,
        last_run_at: Option<String>,
    }

    fn iso(dt: Option<DateTime<Belgrade>>) -> Option<String> {
        dt.map(|dt| dt.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Millis, true))
    }

    #[test]
    fn golden_timer() {
        let raw = std::fs::read_to_string("tests/golden/timer.json").expect("read tests/golden/timer.json");
        let vectors: Vec<TimerVector> = serde_json::from_str(&raw).expect("parse timer.json");
        assert!(!vectors.is_empty());

        for vector in &vectors {
            let now: DateTime<Utc> = DateTime::parse_from_rfc3339(&vector.now).expect("valid now").with_timezone(&Utc);
            let now_b = now.with_timezone(&Belgrade);
            let link = ItemTimerLink {
                id: "link-1".to_string(),
                item_id: "item-1".to_string(),
                timer_id: vector.timer.id.clone(),
                last_checked_at: vector.last_checked_at.clone(),
                created_at: "2026-01-01T00:00:00.000Z".to_string(),
                updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            };

            assert_eq!(iso(next_run_at(&vector.timer, &now_b)).as_deref(), vector.expected.next_run_at.as_deref(), "nextRunAt [{}]", vector.name);
            assert_eq!(iso(last_run_at(&vector.timer, &now_b)).as_deref(), vector.expected.last_run_at.as_deref(), "lastRunAt [{}]", vector.name);

            let status = timer_status(&vector.timer, &vector.last_checked_at, &now_b);
            // The label stays on the TypeScript side and is intentionally not compared.
            assert_eq!(status.visual_state, vector.expected.status.visual_state, "visualState [{}]", vector.name);
            assert_eq!(status.next_run_at.map(to_iso_ms).as_deref(), vector.expected.status.next_run_at.as_deref(), "status.nextRunAt [{}]", vector.name);
            assert_eq!(status.last_run_at.map(to_iso_ms).as_deref(), vector.expected.status.last_run_at.as_deref(), "status.lastRunAt [{}]", vector.name);

            assert_eq!(cycle_next_checked_at(&vector.timer, &link, &now_b), vector.expected.cycle_next_checked_at, "cycleNextCheckedAt [{}]", vector.name);
        }
    }
}
