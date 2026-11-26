//! Import, export, and snapshot handling for the supported JSON contract.
//! Accepts file formats v1 and v2 (see `docs/db-design.md` §10) and exports
//! format v2. The checksum is not verified on import.

use std::collections::HashSet;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use a22_db::{DatabaseSnapshot, DateTimeEntry, DbData, InfoEntry, Item, ItemLink, ItemTimerLink, SnapshotEncoding, Timer, TimerIntervalUnit, TimerSchedule};

use crate::normalize::normalize_tags;
use crate::state::{AppState, Result, StateError};

/// A parsed import file: the validated dataset plus collected per-row warnings.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportData {
    /// `"1"` or `"2"` — the accepted file format version.
    pub source_version: String,
    pub items: Vec<Item>,
    pub timers: Vec<Timer>,
    pub item_links: Vec<ItemLink>,
    pub item_timer_links: Vec<ItemTimerLink>,
    pub warnings: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("failed to parse import file: {0}")]
    Parse(String),
    #[error("unsupported import format. expected metadata.version=\"1\" or \"2\".")]
    UnsupportedVersion,
}

/// Result of a completed import.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub items: usize,
    pub timers: usize,
    pub item_links: usize,
    pub item_timer_links: usize,
    pub warnings: Vec<String>,
}

/// A rendered export file (format v2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExportedFile {
    /// The full JSON document, compact.
    pub json: String,
    /// `items-export-<ISO-with-dashes>.json`.
    pub filename: String,
}

/// TS `toTrimmedString`: non-strings map to the empty string.
fn trimmed(value: &serde_json::Value) -> String {
    value.as_str().map(str::trim).unwrap_or_default().to_string()
}

/// Map lookup that tolerates missing keys (direct `Map` indexing panics).
fn field<'a>(obj: &'a serde_json::Map<String, serde_json::Value>, key: &str) -> &'a serde_json::Value {
    obj.get(key).unwrap_or(&serde_json::Value::Null)
}

/// JS `new Date(raw)` for the formats this app produces: RFC 3339 instants and
/// date-only strings (UTC midnight, like V8). Anything else is invalid.
fn parse_date(raw: &str) -> Option<DateTime<Utc>> {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(raw) {
        return Some(parsed.with_timezone(&Utc));
    }
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok().and_then(|date| date.and_hms_opt(0, 0, 0)).map(|naive| DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
}

/// TS `toIsoOrDefault`: re-serialize to canonical millisecond ISO; empty or
/// invalid input falls back.
fn to_iso_or_default(value: Option<&serde_json::Value>, fallback: &str) -> String {
    let raw = trimmed(value.unwrap_or(&serde_json::Value::Null));
    if raw.is_empty() {
        return fallback.to_string();
    }
    parse_date(&raw).map(|date| date.to_rfc3339_opts(SecondsFormat::Millis, true)).unwrap_or_else(|| fallback.to_string())
}

/// Maps imported item rows, including entry ids and the starred entry reference.
fn map_items(raw: &serde_json::Value, version: u8, errors: &mut Vec<String>, now_iso: &str) -> Vec<Item> {
    let Some(rows) = raw.as_array() else {
        errors.push("`items` is not an array, skipped.".to_string());
        return Vec::new();
    };
    let mut used_ids: HashSet<String> = HashSet::new();
    let mut mapped: Vec<Item> = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let Some(obj) = row.as_object() else {
            errors.push(format!("items[{index}] is not an object, skipped."));
            continue;
        };
        let raw_id = trimmed(field(obj, "id"));
        let item_id = if raw_id.is_empty() { Uuid::new_v4().to_string() } else { raw_id };
        if !used_ids.insert(item_id.clone()) {
            errors.push(format!("items[{index}] duplicate id \"{item_id}\", skipped duplicate."));
            continue;
        }

        let tags = obj
            .get("tags")
            .and_then(serde_json::Value::as_array)
            .map(|arr| arr.iter().filter_map(serde_json::Value::as_str).map(str::to_string).collect::<Vec<_>>())
            .unwrap_or_default();

        // v1 rows carry no entry ids (minted); v2 ids are used as-is, empty → minted.
        let mut info_entries: Vec<InfoEntry> = Vec::new();
        if let Some(entries) = obj.get("infoEntries").and_then(serde_json::Value::as_array) {
            for entry in entries.iter().filter_map(serde_json::Value::as_object) {
                let label = trimmed(field(entry, "label"));
                let value = trimmed(field(entry, "value"));
                if label.is_empty() || value.is_empty() {
                    continue;
                }
                let id = match version {
                    1 => Uuid::new_v4().to_string(),
                    _ => {
                        let raw_entry_id = trimmed(field(entry, "id"));
                        if raw_entry_id.is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            raw_entry_id
                        }
                    }
                };
                info_entries.push(InfoEntry { id, label, value });
            }
        }

        let mut date_time_entries: Vec<DateTimeEntry> = Vec::new();
        if let Some(entries) = obj.get("dateTimeEntries").and_then(serde_json::Value::as_array) {
            for entry in entries.iter().filter_map(serde_json::Value::as_object) {
                let label = trimmed(field(entry, "label"));
                if label.is_empty() {
                    continue;
                }
                let Some(value) = entry.get("value").and_then(serde_json::Value::as_f64) else {
                    continue;
                };
                if !value.is_finite() || value < i64::MIN as f64 || value > i64::MAX as f64 {
                    continue;
                }
                date_time_entries.push(DateTimeEntry { label, value: value.floor() as i64 });
            }
        }

        // v1: the starred label resolves to the first matching entry's id (a
        // one-time approximation, db-design §10.3); v2: the star id is used
        // as-is, validated against the surviving entries.
        let main_info_entry_id = match version {
            1 => {
                let star_field = trimmed(field(obj, "mainInfoField"));
                if star_field.is_empty() {
                    None
                } else {
                    info_entries.iter().find(|entry| entry.label == star_field).map(|entry| entry.id.clone())
                }
            }
            _ => {
                let star_id = trimmed(field(obj, "mainInfoEntryId"));
                if star_id.is_empty() {
                    None
                } else {
                    info_entries.iter().any(|entry| entry.id == star_id).then_some(star_id)
                }
            }
        };

        mapped.push(Item {
            id: item_id,
            main_info_entry_id,
            tags: normalize_tags(&tags),
            info_entries,
            date_time_entries,
            created_at: to_iso_or_default(obj.get("createdAt"), now_iso),
            updated_at: to_iso_or_default(obj.get("updatedAt"), now_iso),
        });
    }
    mapped
}

/// TS `mapTimers`.
fn map_timers(raw: &serde_json::Value, errors: &mut Vec<String>, now_iso: &str) -> Vec<Timer> {
    let Some(rows) = raw.as_array() else {
        errors.push("`timers` is not an array, skipped.".to_string());
        return Vec::new();
    };
    let mut used_ids: HashSet<String> = HashSet::new();
    let mut mapped: Vec<Timer> = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let Some(obj) = row.as_object() else {
            errors.push(format!("timers[{index}] is not an object, skipped."));
            continue;
        };
        let raw_id = trimmed(field(obj, "id"));
        let timer_id = if raw_id.is_empty() { Uuid::new_v4().to_string() } else { raw_id };
        if !used_ids.insert(timer_id.clone()) {
            errors.push(format!("timers[{index}] duplicate id \"{timer_id}\", skipped duplicate."));
            continue;
        }

        let description = trimmed(field(obj, "description"));
        let name = trimmed(field(obj, "name"));
        // TS: `name || description.slice(0, 48) || 'Timer'`.
        let name = if name.is_empty() {
            let fallback: String = description.chars().take(48).collect();
            if fallback.is_empty() {
                "Timer".to_string()
            } else {
                fallback
            }
        } else {
            name
        };

        let schedule = match obj.get("schedule") {
            Some(serde_json::Value::Object(schedule)) => {
                let every = schedule.get("every").and_then(serde_json::Value::as_f64).filter(|value| value.is_finite());
                let unit = schedule.get("unit").and_then(serde_json::Value::as_str).and_then(TimerIntervalUnit::parse);
                match (every, unit) {
                    (Some(every), Some(unit)) if every > 0.0 => Some(TimerSchedule { every: every.floor() as i64, unit }),
                    _ => {
                        errors.push(format!("timers[{index}] has invalid schedule, schedule removed."));
                        None
                    }
                }
            }
            _ => None,
        };

        mapped.push(Timer {
            id: timer_id,
            name,
            base_at: to_iso_or_default(obj.get("baseAt"), now_iso),
            description,
            is_active: obj.get("isActive").and_then(serde_json::Value::as_bool).unwrap_or(true),
            schedule,
            created_at: to_iso_or_default(obj.get("createdAt"), now_iso),
            updated_at: to_iso_or_default(obj.get("updatedAt"), now_iso),
        });
    }
    mapped
}

/// TS `mapItemLinks`.
fn map_item_links(raw: &serde_json::Value, errors: &mut Vec<String>, now_iso: &str) -> Vec<ItemLink> {
    let Some(rows) = raw.as_array() else {
        errors.push("`itemLinks` is not an array, skipped.".to_string());
        return Vec::new();
    };
    let mut mapped: Vec<ItemLink> = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let Some(obj) = row.as_object() else {
            errors.push(format!("itemLinks[{index}] is not an object, skipped."));
            continue;
        };
        let item_id = trimmed(field(obj, "itemId"));
        let target_id = trimmed(field(obj, "targetId"));
        if item_id.is_empty() || target_id.is_empty() {
            errors.push(format!("itemLinks[{index}] missing itemId or targetId, removed."));
            continue;
        }
        let raw_type = trimmed(field(obj, "type"));
        mapped.push(ItemLink {
            id: {
                let raw_id = trimmed(field(obj, "id"));
                if raw_id.is_empty() {
                    Uuid::new_v4().to_string()
                } else {
                    raw_id
                }
            },
            item_id,
            target_id,
            r#type: if raw_type.is_empty() { "related".to_string() } else { raw_type },
            created_at: to_iso_or_default(obj.get("createdAt"), now_iso),
            updated_at: to_iso_or_default(obj.get("updatedAt"), now_iso),
        });
    }
    mapped
}

/// TS `mapItemTimerLinks`.
fn map_item_timer_links(raw: &serde_json::Value, errors: &mut Vec<String>, now_iso: &str) -> Vec<ItemTimerLink> {
    let Some(rows) = raw.as_array() else {
        errors.push("`itemTimerLinks` is not an array, skipped.".to_string());
        return Vec::new();
    };
    const EPOCH_ISO: &str = "1970-01-01T00:00:00.000Z";
    let mut mapped: Vec<ItemTimerLink> = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let Some(obj) = row.as_object() else {
            errors.push(format!("itemTimerLinks[{index}] is not an object, skipped."));
            continue;
        };
        let item_id = trimmed(field(obj, "itemId"));
        let timer_id = trimmed(field(obj, "timerId"));
        if item_id.is_empty() || timer_id.is_empty() {
            errors.push(format!("itemTimerLinks[{index}] missing itemId or timerId, removed."));
            continue;
        }
        mapped.push(ItemTimerLink {
            id: {
                let raw_id = trimmed(field(obj, "id"));
                if raw_id.is_empty() {
                    Uuid::new_v4().to_string()
                } else {
                    raw_id
                }
            },
            item_id,
            timer_id,
            last_checked_at: to_iso_or_default(obj.get("lastCheckedAt"), EPOCH_ISO),
            created_at: to_iso_or_default(obj.get("createdAt"), now_iso),
            updated_at: to_iso_or_default(obj.get("updatedAt"), now_iso),
        });
    }
    mapped
}

/// TS `validateLinks`: FK checks, self-reference and duplicate removal, first
/// occurrence wins. Check order (and thus the reported error) matches the TS.
fn validate_links(
    items: &[Item],
    timers: &[Timer],
    item_links: Vec<ItemLink>,
    item_timer_links: Vec<ItemTimerLink>,
    errors: &mut Vec<String>,
) -> (Vec<ItemLink>, Vec<ItemTimerLink>) {
    let item_ids: HashSet<&str> = items.iter().map(|item| item.id.as_str()).collect();
    let timer_ids: HashSet<&str> = timers.iter().map(|timer| timer.id.as_str()).collect();

    let mut valid_item_links: Vec<ItemLink> = Vec::new();
    let mut seen_item_link_keys: HashSet<String> = HashSet::new();
    for link in item_links {
        if !item_ids.contains(link.item_id.as_str()) {
            errors.push(format!("itemLink \"{}\" removed: item \"{}\" does not exist.", link.id, link.item_id));
            continue;
        }
        if !item_ids.contains(link.target_id.as_str()) {
            errors.push(format!("itemLink \"{}\" removed: target \"{}\" does not exist.", link.id, link.target_id));
            continue;
        }
        if link.item_id == link.target_id {
            errors.push(format!("itemLink \"{}\" removed: self-reference is not allowed.", link.id));
            continue;
        }
        let key = format!("{}::{}::{}", link.item_id, link.target_id, link.r#type);
        if !seen_item_link_keys.insert(key) {
            errors.push(format!("itemLink \"{}\" removed: duplicate relationship.", link.id));
            continue;
        }
        valid_item_links.push(link);
    }

    let mut valid_timer_links: Vec<ItemTimerLink> = Vec::new();
    let mut seen_timer_link_keys: HashSet<String> = HashSet::new();
    for link in item_timer_links {
        if !item_ids.contains(link.item_id.as_str()) {
            errors.push(format!("itemTimerLink \"{}\" removed: item \"{}\" does not exist.", link.id, link.item_id));
            continue;
        }
        if !timer_ids.contains(link.timer_id.as_str()) {
            errors.push(format!("itemTimerLink \"{}\" removed: timer \"{}\" does not exist.", link.id, link.timer_id));
            continue;
        }
        let key = format!("{}::{}", link.item_id, link.timer_id);
        if !seen_timer_link_keys.insert(key) {
            errors.push(format!("itemTimerLink \"{}\" removed: duplicate timer link.", link.id));
            continue;
        }
        valid_timer_links.push(link);
    }

    (valid_item_links, valid_timer_links)
}

/// TS `decodeImportPayload` + `validateImportV1Payload`, extended to format v2.
/// `now` replaces the TS `new Date()` fallback clock (deterministic tests).
pub fn parse_import_file(raw_json: &str, now: DateTime<Utc>) -> std::result::Result<ImportData, ImportError> {
    let parsed: serde_json::Value = serde_json::from_str(raw_json).map_err(|error| ImportError::Parse(error.to_string()))?;
    let obj = match parsed.as_object() {
        Some(obj) => obj,
        None => return Err(ImportError::Parse("Payload root must be an object.".to_string())),
    };

    // TS: `String(metadata.version) === '1'` — numeric 1/2 coerce the same way.
    let version = match obj.get("metadata").and_then(serde_json::Value::as_object).and_then(|metadata| metadata.get("version")) {
        Some(serde_json::Value::String(text)) if text == "1" => 1,
        Some(serde_json::Value::String(text)) if text == "2" => 2,
        Some(serde_json::Value::Number(number)) if number.as_i64() == Some(1) => 1,
        Some(serde_json::Value::Number(number)) if number.as_i64() == Some(2) => 2,
        _ => return Err(ImportError::UnsupportedVersion),
    };

    let now_iso = now.to_rfc3339_opts(SecondsFormat::Millis, true);
    let mut errors: Vec<String> = Vec::new();
    let items = map_items(field(obj, "items"), version, &mut errors, &now_iso);
    let timers = map_timers(field(obj, "timers"), &mut errors, &now_iso);
    let item_links = map_item_links(field(obj, "itemLinks"), &mut errors, &now_iso);
    let item_timer_links = map_item_timer_links(field(obj, "itemTimerLinks"), &mut errors, &now_iso);
    let (item_links, item_timer_links) = validate_links(&items, &timers, item_links, item_timer_links, &mut errors);

    Ok(ImportData { source_version: version.to_string(), items, timers, item_links, item_timer_links, warnings: errors })
}

/// The data part hashed into the export checksum (TS `exportData`), serialized
/// exactly like JS `JSON.stringify`: compact, struct field order.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportDataPart<'a> {
    items: &'a [Item],
    timers: &'a [Timer],
    item_timer_links: &'a [ItemTimerLink],
    item_links: &'a [ItemLink],
}

/// The exported document (format v2).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportPayload<'a> {
    metadata: ExportMetadata,
    items: &'a [Item],
    timers: &'a [Timer],
    item_timer_links: &'a [ItemTimerLink],
    item_links: &'a [ItemLink],
}

#[derive(Serialize)]
struct ExportMetadata {
    version: String,
    date: String,
    checksum: String,
}

/// Format v2 metadata and data part; the checksum is SHA-256 hex of the compact
/// data-part JSON.
pub fn export_file(data: &DbData, now: DateTime<Utc>) -> ExportedFile {
    let data_part = ExportDataPart { items: &data.items, timers: &data.timers, item_timer_links: &data.item_timer_links, item_links: &data.item_links };
    let data_json = serde_json::to_string(&data_part).expect("export data serializes");
    let checksum: String = Sha256::digest(data_json.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect();
    let date = now.to_rfc3339_opts(SecondsFormat::Millis, true);
    let payload = ExportPayload {
        metadata: ExportMetadata { version: "2".to_string(), date: date.clone(), checksum },
        items: &data.items,
        timers: &data.timers,
        item_timer_links: &data.item_timer_links,
        item_links: &data.item_links,
    };
    let json = serde_json::to_string(&payload).expect("export payload serializes");
    // TS: `timestamp.replace(/[:.]/g, '-')`.
    let dashed: String = date.chars().map(|ch| if ch == ':' || ch == '.' { '-' } else { ch }).collect();
    let filename = format!("items-export-{dashed}.json");
    ExportedFile { json, filename }
}

/// TS `createDatabaseSnapshot`: the pre-import backup payload (gzip+base64 with
/// a plain fallback) plus row counts.
fn create_backup_payload(data: &DbData, source_version: &str, created_at: &str) -> DatabaseSnapshot {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct BackupPayload<'a> {
        metadata: BackupMetadata,
        items: &'a [Item],
        timers: &'a [Timer],
        item_links: &'a [ItemLink],
        item_timer_links: &'a [ItemTimerLink],
    }

    #[derive(Serialize)]
    struct BackupMetadata {
        version: String,
        date: String,
        source: String,
    }

    let payload_json = serde_json::to_string(&BackupPayload {
        metadata: BackupMetadata { version: source_version.to_string(), date: created_at.to_string(), source: "pre-import-backup".to_string() },
        items: &data.items,
        timers: &data.timers,
        item_links: &data.item_links,
        item_timer_links: &data.item_timer_links,
    })
    .expect("backup payload serializes");

    let (encoding, payload) = match gzip_base64(payload_json.as_bytes()) {
        Ok(encoded) => (SnapshotEncoding::GzipBase64, encoded),
        Err(_) => (SnapshotEncoding::Plain, payload_json),
    };

    DatabaseSnapshot {
        id: Uuid::new_v4().to_string(),
        created_at: created_at.to_string(),
        source_version: source_version.to_string(),
        encoding,
        payload,
        item_count: data.items.len() as i64,
        timer_count: data.timers.len() as i64,
        item_link_count: data.item_links.len() as i64,
        item_timer_link_count: data.item_timer_links.len() as i64,
    }
}

fn gzip_base64(bytes: &[u8]) -> std::result::Result<String, std::io::Error> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    use std::io::Write as _;
    encoder.write_all(bytes)?;
    Ok(BASE64.encode(encoder.finish()?))
}

impl AppState {
    /// Parse and validate, back up existing data (when present), then replace.
    /// The checksum is not verified. A backup failure aborts the import —
    /// never wipe data without its backup (deliberate divergence from the TS
    /// catch-and-continue).
    pub fn import_snapshot(&mut self, raw_json: &str) -> Result<ImportSummary> {
        let parsed = parse_import_file(raw_json, Utc::now()).map_err(StateError::Import)?;

        if !self.data.items.is_empty() || !self.data.timers.is_empty() {
            let snapshot = create_backup_payload(&self.data, &parsed.source_version, &crate::state::AppState::now_iso());
            self.db.insert_snapshot(&snapshot)?;
        }

        self.db.replace_all(&DbData {
            items: parsed.items.clone(),
            timers: parsed.timers.clone(),
            item_links: parsed.item_links.clone(),
            item_timer_links: parsed.item_timer_links.clone(),
            snapshots: Vec::new(),
        })?;
        self.reload()?;

        Ok(ImportSummary {
            items: parsed.items.len(),
            timers: parsed.timers.len(),
            item_links: parsed.item_links.len(),
            item_timer_links: parsed.item_timer_links.len(),
            warnings: parsed.warnings,
        })
    }

    /// TS `handleExport` over the loaded state.
    pub fn export_snapshot(&self) -> ExportedFile {
        export_file(&self.data, Utc::now())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW_ISO: &str = "2026-08-16T12:00:00.000Z";

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(NOW_ISO).expect("valid now").with_timezone(&Utc)
    }

    fn sample_data() -> DbData {
        DbData {
            items: vec![Item {
                id: "i1".to_string(),
                main_info_entry_id: Some("e1".to_string()),
                tags: vec!["work".to_string()],
                info_entries: vec![InfoEntry { id: "e1".to_string(), label: "title".to_string(), value: "A".to_string() }],
                date_time_entries: vec![DateTimeEntry { label: "due".to_string(), value: 1750000000000 }],
                created_at: "2026-01-01T00:00:00.000Z".to_string(),
                updated_at: "2026-01-02T00:00:00.000Z".to_string(),
            }],
            timers: vec![Timer {
                id: "t1".to_string(),
                name: "Rent".to_string(),
                base_at: "2026-08-20T00:00:00.000Z".to_string(),
                description: "pay rent".to_string(),
                is_active: true,
                schedule: Some(TimerSchedule { every: 1, unit: TimerIntervalUnit::Days }),
                created_at: "2026-01-01T00:00:00.000Z".to_string(),
                updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            }],
            item_links: vec![ItemLink {
                id: "l1".to_string(),
                item_id: "i1".to_string(),
                target_id: "i2".to_string(),
                r#type: "related".to_string(),
                created_at: "2026-01-01T00:00:00.000Z".to_string(),
                updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            }],
            item_timer_links: vec![ItemTimerLink {
                id: "tl1".to_string(),
                item_id: "i1".to_string(),
                timer_id: "t1".to_string(),
                last_checked_at: "2026-08-01T00:00:00.000Z".to_string(),
                created_at: "2026-01-01T00:00:00.000Z".to_string(),
                updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            }],
            snapshots: Vec::new(),
        }
    }

    #[test]
    fn export_file_shape_and_checksum() {
        let data = sample_data();
        let exported = export_file(&data, now());

        assert_eq!(exported.filename, "items-export-2026-08-16T12-00-00-000Z.json");

        let doc: serde_json::Value = serde_json::from_str(&exported.json).expect("valid json");
        assert_eq!(doc["metadata"]["version"], "2");
        assert_eq!(doc["metadata"]["date"], NOW_ISO);

        // Checksum = SHA-256 of the data-part bytes exactly as written in the file.
        // The document starts with the metadata object; its first colon terminates the key.
        let value_start = exported.json.find(':').expect("first colon") + 1;
        let metadata_close = exported.json[value_start..].find('}').expect("metadata closes") + value_start;
        // In the file the data keys are embedded without braces (JS object spread);
        // the checksum covers the standalone serialization, so restore them.
        let data_part = &exported.json[metadata_close + 2..exported.json.len() - 1]; // skip "}," and the trailing "}"
        assert_eq!(data_part.as_bytes()[0], b'"');
        assert_eq!(&data_part[1..6], "items");
        let standalone = format!("{{{data_part}}}");
        let expected: String = Sha256::digest(standalone.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(doc["metadata"]["checksum"], expected);

        // v2 shape: items carry the star by entry id; entries carry ids.
        assert_eq!(doc["items"][0]["mainInfoEntryId"], "e1");
        assert_eq!(doc["items"][0]["infoEntries"][0]["id"], "e1");
        assert!(doc["items"][0].get("mainInfoField").is_none());

        // Key order in the file matches the TS payload (the parsed Map does not preserve order).
        let positions: Vec<usize> =
            ["metadata", "items", "timers", "itemTimerLinks", "itemLinks"].iter().map(|key| exported.json.find(format!("\"{key}\":").as_str()).expect("key present")).collect();
        assert!(positions.windows(2).all(|pair| pair[0] < pair[1]), "top-level key order: {positions:?}");
    }

    #[test]
    fn backup_payload_gzip_roundtrip_and_counts() {
        let data = sample_data();
        let snapshot = create_backup_payload(&data, "1", NOW_ISO);

        assert_eq!(snapshot.encoding, SnapshotEncoding::GzipBase64);
        assert_eq!((snapshot.item_count, snapshot.timer_count, snapshot.item_link_count, snapshot.item_timer_link_count), (1, 1, 1, 1));
        assert_eq!(snapshot.source_version, "1");

        let bytes = BASE64.decode(&snapshot.payload).expect("base64");
        use flate2::read::GzDecoder;
        use std::io::Read as _;
        let mut decompressed = Vec::new();
        GzDecoder::new(&bytes[..]).read_to_end(&mut decompressed).expect("gunzip");
        let doc: serde_json::Value = serde_json::from_slice(&decompressed).expect("valid json");
        assert_eq!(doc["metadata"]["source"], "pre-import-backup");
        assert_eq!(doc["metadata"]["version"], "1");
        assert_eq!(doc["metadata"]["date"], NOW_ISO);
        assert_eq!(doc["items"][0]["id"], "i1");
    }

    #[test]
    fn import_snapshot_backs_up_then_replaces() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut state = AppState::open(dir.path().join("test.db")).expect("open");
        state
            .create_item(&crate::state::CreateItemInput {
                item: crate::normalize::ItemCreateInput { tags: vec!["keep".to_string()], info_entries: Vec::new(), date_time_entries: Vec::new(), main_info_entry_id: None },
                relationships: Vec::new(),
            })
            .expect("seed item");
        assert_eq!(state.data.items.len(), 1);

        let raw = r#"{"metadata":{"version":"2","date":"2026-08-15T00:00:00.000Z"},"items":[{"id":"fresh","tags":[],"infoEntries":[],"dateTimeEntries":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}],"timers":[],"itemLinks":[],"itemTimerLinks":[]}"#;
        let summary = state.import_snapshot(raw).expect("import");

        assert_eq!(summary.items, 1);
        assert_eq!(state.data.items.len(), 1);
        assert_eq!(state.data.items[0].id, "fresh", "replace_all must wipe the old data");
        assert_eq!(state.db.load_all().expect("load").snapshots.len(), 1, "pre-import backup required when data existed");

        let snapshot = &state.db.load_all().expect("load").snapshots[0];
        assert_eq!(snapshot.source_version, "2");
        let bytes = BASE64.decode(&snapshot.payload).expect("base64");
        use flate2::read::GzDecoder;
        use std::io::Read as _;
        let mut decompressed = Vec::new();
        GzDecoder::new(&bytes[..]).read_to_end(&mut decompressed).expect("gunzip");
        let doc: serde_json::Value = serde_json::from_slice(&decompressed).expect("valid json");
        assert_eq!(doc["items"][0]["tags"][0], "keep", "backup must hold the pre-import data");
    }

    #[test]
    fn import_snapshot_without_existing_data_creates_no_backup() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut state = AppState::open(dir.path().join("test.db")).expect("open");

        let raw = r#"{"metadata":{"version":"1"},"items":[],"timers":[],"itemLinks":[],"itemTimerLinks":[]}"#;
        let summary = state.import_snapshot(raw).expect("import");
        assert_eq!(summary.items, 0);
        assert!(state.db.load_all().expect("load").snapshots.is_empty());
    }

    #[test]
    fn import_rejects_unsupported_versions() {
        let rejected = parse_import_file(r#"{"metadata":{"version":"3"},"items":[]}"#, now());
        assert!(matches!(rejected, Err(ImportError::UnsupportedVersion)));
        let missing = parse_import_file(r#"{"items":[]}"#, now());
        assert!(matches!(missing, Err(ImportError::UnsupportedVersion)));
        let parsed = parse_import_file("not json", now());
        assert!(matches!(parsed, Err(ImportError::Parse(_))));
    }

    #[test]
    fn date_only_inputs_parse_as_utc_midnight() {
        assert_eq!(to_iso_or_default(Some(&serde_json::json!("2026-01-01")), NOW_ISO), "2026-01-01T00:00:00.000Z");
        assert_eq!(to_iso_or_default(Some(&serde_json::json!("2026-01-01T05:30:00+02:00")), NOW_ISO), "2026-01-01T03:30:00.000Z");
        assert_eq!(to_iso_or_default(Some(&serde_json::json!("garbage")), NOW_ISO), NOW_ISO);
        assert_eq!(to_iso_or_default(None, NOW_ISO), NOW_ISO);
    }
}
