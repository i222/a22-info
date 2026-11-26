//! Domain types shared by the persistence layer and the domain logic.
//!
//! Field names serialize as camelCase so the JSON wire format matches the
//! TypeScript side (`a22-ui-core`) exactly — see `docs/db-design.md` §5 for the
//! row ↔ JSON round-trip mapping this module implements.

use serde::{Deserialize, Serialize};

/// One ordered info entry of an item. Has identity: the item's star references it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoEntry {
    pub id: String,
    pub label: String,
    pub value: String,
}

/// One ordered date-time entry of an item (no identity — nothing references it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateTimeEntry {
    pub label: String,
    /// Unix timestamp in milliseconds.
    pub value: i64,
}

/// An item — a contact-like record with free-form fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    /// Id of the starred info entry; `None` when no entry is starred.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_info_entry_id: Option<String>,
    /// Order preserved from the domain array (display order).
    pub tags: Vec<String>,
    /// Order preserved from the domain array (display order).
    pub info_entries: Vec<InfoEntry>,
    /// Order preserved from the domain array (display order).
    pub date_time_entries: Vec<DateTimeEntry>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// ISO-8601 UTC.
    pub updated_at: String,
}

/// Repeat unit of a timer schedule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerIntervalUnit {
    Hours,
    Days,
    Weeks,
    Months,
    Years,
}

impl TimerIntervalUnit {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Hours => "hours",
            Self::Days => "days",
            Self::Weeks => "weeks",
            Self::Months => "months",
            Self::Years => "years",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "hours" => Some(Self::Hours),
            "days" => Some(Self::Days),
            "weeks" => Some(Self::Weeks),
            "months" => Some(Self::Months),
            "years" => Some(Self::Years),
            _ => None,
        }
    }
}

/// A repeating schedule: `every` × `unit`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSchedule {
    pub every: i64,
    pub unit: TimerIntervalUnit,
}

/// A one-time or periodic check-in timer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timer {
    pub id: String,
    pub name: String,
    /// ISO-8601 UTC; a 00:00:00 time part means date-only.
    pub base_at: String,
    pub description: String,
    pub is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<TimerSchedule>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// ISO-8601 UTC.
    pub updated_at: String,
}

/// A typed directed relationship between two items.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemLink {
    pub id: String,
    pub item_id: String,
    pub target_id: String,
    /// Relationship type string.
    pub r#type: String,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// ISO-8601 UTC.
    pub updated_at: String,
}

/// The link between an item and a timer; carries the per-item check state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTimerLink {
    pub id: String,
    pub item_id: String,
    pub timer_id: String,
    /// ISO-8601 UTC.
    pub last_checked_at: String,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// ISO-8601 UTC.
    pub updated_at: String,
}

/// Encoding of a snapshot payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotEncoding {
    GzipBase64,
    Plain,
}

impl SnapshotEncoding {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::GzipBase64 => "gzip-base64",
            Self::Plain => "plain",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "gzip-base64" => Some(Self::GzipBase64),
            "plain" => Some(Self::Plain),
            _ => None,
        }
    }
}

/// A pre-import backup of the whole database (opaque payload).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSnapshot {
    pub id: String,
    /// ISO-8601 UTC.
    pub created_at: String,
    pub source_version: String,
    pub encoding: SnapshotEncoding,
    /// Base64(gzip(JSON)) or plain JSON — opaque to the storage layer.
    pub payload: String,
    pub item_count: i64,
    pub timer_count: i64,
    pub item_link_count: i64,
    pub item_timer_link_count: i64,
}

/// The full dataset as loaded into / persisted from the database.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbData {
    pub items: Vec<Item>,
    pub timers: Vec<Timer>,
    pub item_links: Vec<ItemLink>,
    pub item_timer_links: Vec<ItemTimerLink>,
    pub snapshots: Vec<DatabaseSnapshot>,
}
