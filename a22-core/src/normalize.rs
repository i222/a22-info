//! Item input normalization. Info entries carry ids and the star is a hard
//! reference to an entry (`docs/db-design.md` §10).
//!
//! The update input uses an explicit tri-state instead of clearing the star on
//! every partial update — absent = keep,
//! `null` = clear, string = set — with re-validation whenever entries are
//! replaced. The editor always sends full form state, so UI behavior is unchanged.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::types::{DateTimeEntry, InfoEntry};

pub const ITEM_TAGS_DEFAULTS: &[&str] = &["email", "social_media", "serbia", "russia", "finance", "contact", "utilities"];
pub const INFO_LABEL_DEFAULTS: &[&str] = &["title", "fat", "description"];
pub const RELATIONSHIP_TYPE_DEFAULTS: &[&str] = &["related", "recovery_info", "recovery_info_primary", "contact", "link"];

/// One info-entry row as submitted by the editor; `id` is optional and minted
/// when absent or malformed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoEntryInput {
    #[serde(default)]
    pub id: Option<String>,
    pub label: String,
    pub value: String,
}

/// One date-time entry row as submitted; non-finite values are dropped.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateTimeEntryInput {
    pub label: String,
    #[serde(default)]
    pub value: Option<f64>,
}

/// Star update tri-state: absent in the input = keep, `null` = clear, string = set.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum StarUpdate {
    #[default]
    Keep,
    Clear,
    Set(String),
}

impl<'de> Deserialize<'de> for StarUpdate {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Option::<String>::deserialize(deserializer)?;
        Ok(match value {
            Some(id) => StarUpdate::Set(id),
            None => StarUpdate::Clear,
        })
    }
}

impl Serialize for StarUpdate {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            StarUpdate::Set(id) => serializer.serialize_str(id),
            // `Keep` and `Clear` are indistinguishable in JSON form; the
            // distinction is input-side. Used only for test value-walking.
            StarUpdate::Keep | StarUpdate::Clear => serializer.serialize_none(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCreateInput {
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub info_entries: Vec<InfoEntryInput>,
    #[serde(default)]
    pub date_time_entries: Vec<DateTimeEntryInput>,
    #[serde(default)]
    pub main_info_entry_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemUpdateInput {
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub info_entries: Option<Vec<InfoEntryInput>>,
    #[serde(default)]
    pub date_time_entries: Option<Vec<DateTimeEntryInput>>,
    /// Absent = keep the current star; `null` = clear it.
    #[serde(default)]
    pub main_info_entry_id: StarUpdate,
}

/// Normalized create payload with reconciled ids and a validated star.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCreatePayload {
    pub tags: Vec<String>,
    pub info_entries: Vec<InfoEntry>,
    pub date_time_entries: Vec<DateTimeEntry>,
    /// `None` when no surviving entry is starred.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_info_entry_id: Option<String>,
}

/// Normalized update payload; a field is present only when the input carried it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemUpdatePayload {
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub info_entries: Option<Vec<InfoEntry>>,
    #[serde(default)]
    pub date_time_entries: Option<Vec<DateTimeEntry>>,
    /// `Keep` when the input neither set nor cleared the star.
    #[serde(default)]
    pub main_info_entry_id: StarUpdate,
}

/// Normalize a full item-create payload (port of TS `createItemPayload`).
pub fn normalize_item_create(input: &ItemCreateInput) -> ItemCreatePayload {
    let info_entries = reconcile_info_entries(&input.info_entries, None);
    let date_time_entries = normalize_date_time_entries(&input.date_time_entries);
    let main_info_entry_id = resolve_star(input.main_info_entry_id.as_deref(), &entry_ids(&info_entries));
    ItemCreatePayload { tags: normalize_tags(&input.tags), info_entries, date_time_entries, main_info_entry_id }
}

/// Normalize a partial item-update payload (port of TS `createItemUpdatePayload`).
///
/// `known_entry_ids` are the item's current entry ids; `current_star` is its
/// current star. When entries are replaced the star is always re-resolved
/// against the surviving set (a removed starred entry clears the star, §10.2).
pub fn normalize_item_update(input: &ItemUpdateInput, known_entry_ids: &[String], current_star: Option<&str>) -> ItemUpdatePayload {
    let info_entries = input.info_entries.as_ref().map(|rows| reconcile_info_entries(rows, Some(known_entry_ids)));
    let date_time_entries = input.date_time_entries.as_ref().map(|rows| normalize_date_time_entries(rows));
    let main_info_entry_id = match &info_entries {
        Some(entries) => update_star(&input.main_info_entry_id, current_star, &entry_ids(entries)).force_explicit(),
        None => update_star(&input.main_info_entry_id, None, known_entry_ids),
    };
    ItemUpdatePayload { tags: input.tags.as_ref().map(|tags| normalize_tags(tags)), info_entries, date_time_entries, main_info_entry_id }
}

impl StarUpdate {
    /// Replacing entries always yields an explicit resolution (no `Keep`).
    fn force_explicit(self) -> Self {
        match self {
            StarUpdate::Keep => StarUpdate::Clear,
            other => other,
        }
    }
}

fn update_star(input_star: &StarUpdate, current_star: Option<&str>, pool: &[String]) -> StarUpdate {
    let requested = match input_star {
        StarUpdate::Set(id) => Some(id.trim().to_string()),
        StarUpdate::Clear => Some(String::new()),
        StarUpdate::Keep => current_star.map(str::to_owned),
    };
    match requested {
        None => StarUpdate::Keep,
        Some(id) if id.is_empty() => StarUpdate::Clear,
        Some(id) if pool.iter().any(|known| known == &id) => StarUpdate::Set(id),
        Some(_) => StarUpdate::Clear,
    }
}

pub(crate) fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(tags.len());
    for tag in tags {
        let normalized = tag.trim().to_lowercase();
        if normalized.is_empty() || out.contains(&normalized) {
            continue;
        }
        out.push(normalized);
    }
    out
}

/// Trim label/value, drop empty rows (order preserved), reconcile entry ids:
/// create keeps well-formed UUIDv4 ids and mints the rest; update keeps ids from
/// the item's current entries and treats foreign/absent ids as new rows.
fn reconcile_info_entries(rows: &[InfoEntryInput], known_entry_ids: Option<&[String]>) -> Vec<InfoEntry> {
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let label = row.label.trim();
        let value = row.value.trim();
        if label.is_empty() || value.is_empty() {
            continue;
        }
        let id = match known_entry_ids {
            Some(known) => match row.id.as_deref().filter(|id| known.iter().any(|known_id| known_id == id)) {
                Some(kept) => kept.to_string(),
                None => mint_entry_id(),
            },
            None => match row.id.as_deref().and_then(parse_uuid_v4) {
                Some(kept) => kept,
                None => mint_entry_id(),
            },
        };
        out.push(InfoEntry { id, label: label.to_string(), value: value.to_string() });
    }
    out
}

fn normalize_date_time_entries(rows: &[DateTimeEntryInput]) -> Vec<DateTimeEntry> {
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let label = row.label.trim();
        if label.is_empty() {
            continue;
        }
        let Some(value) = row.value else {
            continue;
        };
        if !value.is_finite() || value < i64::MIN as f64 || value > i64::MAX as f64 {
            continue;
        }
        out.push(DateTimeEntry { label: label.to_string(), value: value.floor() as i64 });
    }
    out
}

fn resolve_star(star: Option<&str>, pool: &[String]) -> Option<String> {
    let star = star?.trim();
    pool.iter().find(|id| id.as_str() == star).cloned()
}

fn entry_ids(entries: &[InfoEntry]) -> Vec<String> {
    entries.iter().map(|entry| entry.id.clone()).collect()
}

fn parse_uuid_v4(value: &str) -> Option<String> {
    let uuid = Uuid::parse_str(value).ok()?;
    (uuid.get_version() == Some(uuid::Version::Random)).then(|| value.to_string())
}

fn mint_entry_id() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn star_update_tristate_deserializes() {
        let keep: ItemUpdateInput = serde_json::from_value(json!({})).unwrap();
        assert_eq!(keep.main_info_entry_id, StarUpdate::Keep);
        let clear: ItemUpdateInput = serde_json::from_value(json!({ "mainInfoEntryId": null })).unwrap();
        assert_eq!(clear.main_info_entry_id, StarUpdate::Clear);
        let set: ItemUpdateInput = serde_json::from_value(json!({ "mainInfoEntryId": "abc" })).unwrap();
        assert_eq!(set.main_info_entry_id, StarUpdate::Set("abc".to_string()));
    }

    #[test]
    fn tags_trim_lowercase_dedupe_drop_empty() {
        let tags = vec![" Contact ".into(), "contact".into(), "".into(), "   ".into(), "SERBIA".into()];
        assert_eq!(normalize_tags(&tags), vec!["contact", "serbia"]);
    }

    #[test]
    fn dt_entries_floor_and_drop_non_finite() {
        let rows = vec![
            DateTimeEntryInput { label: "  due ".into(), value: Some(1750000000000.9) },
            DateTimeEntryInput { label: "meeting".into(), value: None },
            DateTimeEntryInput { label: "".into(), value: Some(100.0) },
        ];
        assert_eq!(normalize_date_time_entries(&rows), vec![DateTimeEntry { label: "due".to_string(), value: 1750000000000 }]);
    }

    #[test]
    fn create_star_validates_against_surviving_entries() {
        let input: ItemCreateInput = serde_json::from_value(json!({
            "infoEntries": [
                { "id": "11111111-1111-4111-8111-111111111111", "label": "title", "value": "v" },
                { "label": "", "value": "ghost" }
            ],
            "mainInfoEntryId": "22222222-2222-4222-8222-222222222222"
        }))
        .unwrap();
        let payload = normalize_item_create(&input);
        assert_eq!(payload.main_info_entry_id, None);
        assert_eq!(payload.info_entries.len(), 1);
    }

    #[test]
    fn update_star_survives_when_entry_kept_and_clears_when_removed() {
        let known = vec!["11111111-1111-4111-8111-111111111111".to_string(), "22222222-2222-4222-8222-222222222222".to_string()];
        let current_star = Some("11111111-1111-4111-8111-111111111111");

        let kept: ItemUpdateInput = serde_json::from_value(json!({
            "infoEntries": [
                { "id": "11111111-1111-4111-8111-111111111111", "label": "title", "value": "v" },
                { "id": "22222222-2222-4222-8222-222222222222", "label": "note", "value": "n" }
            ]
        }))
        .unwrap();
        assert_eq!(normalize_item_update(&kept, &known, current_star).main_info_entry_id, StarUpdate::Set("11111111-1111-4111-8111-111111111111".to_string()));

        let removed: ItemUpdateInput = serde_json::from_value(json!({
            "infoEntries": [{ "id": "22222222-2222-4222-8222-222222222222", "label": "note", "value": "n" }]
        }))
        .unwrap();
        assert_eq!(normalize_item_update(&removed, &known, current_star).main_info_entry_id, StarUpdate::Clear);
    }
}
