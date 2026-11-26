//! State operations over `a22-db`. The app keeps the full dataset in memory
//! (`data`) and persists every mutation through entity operations; each operation
//! re-reads state from the database afterwards.
//!
//! Deleting an item also removes its `item_timer_links` through the foreign-key
//! cascade. Updating an item with `relationships` present replaces only that
//! item's outgoing links; incoming links from other items survive.

use std::collections::HashMap;
use std::hash::Hash;
use std::path::Path;

use chrono::{DateTime, Local, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use a22_db::{DbData, DbError, Item, ItemLink, ItemTimerLink, Store, Timer, TimerSchedule};

use crate::hints;
use crate::normalize::{normalize_item_create, normalize_item_update, ItemCreateInput, ItemUpdateInput, StarUpdate};
use crate::search::filter_items;
use crate::timer::{self, TimerStatus};

#[derive(Debug, Error)]
pub enum StateError {
    #[error("database error: {0}")]
    Db(#[from] DbError),
    #[error("{entity} with id {id} not found")]
    NotFound { entity: &'static str, id: String },
    #[error("import error: {0}")]
    Import(#[from] crate::import_export::ImportError),
}

pub type Result<T> = std::result::Result<T, StateError>;

/// One outgoing relationship submitted with an item create/update (TS `relationships`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipInput {
    pub target_id: String,
    pub r#type: String,
}

/// Item-create payload as submitted by the editor (TS `ItemInput`): the
/// normalized fields plus optional outgoing relationships.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateItemInput {
    #[serde(flatten)]
    pub item: ItemCreateInput,
    #[serde(default)]
    pub relationships: Vec<RelationshipInput>,
}

/// Item-update payload as submitted by the editor (TS `ItemUpdateInput` +
/// `relationships`). `relationships` absent = leave links alone; present (even
/// empty) = replace the outgoing ones (Q2 fix: incoming survive).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateItemInput {
    #[serde(flatten)]
    pub item: ItemUpdateInput,
    #[serde(default)]
    pub relationships: Option<Vec<RelationshipInput>>,
}

/// Timer-create payload (TS `TimerInput`; the TS service applies no normalization).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTimerInput {
    pub name: String,
    pub base_at: String,
    #[serde(default)]
    pub description: String,
    pub is_active: bool,
    #[serde(default)]
    pub schedule: Option<TimerSchedule>,
}

/// Timer-update payload (TS `Partial<TimerInput>`; absent field = keep).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTimerInput {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub base_at: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_active: Option<bool>,
    /// Absent = keep; `null` = clear the schedule; object = set.
    #[serde(default)]
    pub schedule: ScheduleUpdate,
}

/// Tri-state timer-schedule update (the JSON wire cannot express JS `undefined`,
/// so `null` is the explicit clear — same pattern as `StarUpdate`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ScheduleUpdate {
    #[default]
    Keep,
    Clear,
    Set(TimerSchedule),
}

impl<'de> Deserialize<'de> for ScheduleUpdate {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Option::<TimerSchedule>::deserialize(deserializer)?;
        Ok(match value {
            Some(schedule) => ScheduleUpdate::Set(schedule),
            None => ScheduleUpdate::Clear,
        })
    }
}

/// Item↔timer link create payload (TS `ItemTimerLinkInput`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateItemTimerLinkInput {
    pub item_id: String,
    pub timer_id: String,
    pub last_checked_at: String,
}

/// Item↔timer link update payload (TS `Partial<Omit<ItemTimerLinkInput, 'itemId' | 'timerId'>>`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateItemTimerLinkInput {
    #[serde(default)]
    pub last_checked_at: Option<String>,
}

/// Timer status of one item↔timer link for the UI view model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    pub link_id: String,
    pub item_id: String,
    pub timer_id: String,
    pub status: TimerStatus,
}

/// Editor hint lists (the three TS `load()` hint arrays).
#[derive(Debug, Clone, Serialize)]
pub struct Hints {
    pub tags: Vec<String>,
    pub info_labels: Vec<String>,
    pub relationship_types: Vec<String>,
}

/// In-memory app state over a single SQLite connection (design doc §1).
pub struct AppState {
    pub db: Store,
    pub data: DbData,
}

impl AppState {
    /// Opens (creating if needed) the database at `path` and loads the dataset.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let db = Store::open(path)?;
        let mut state = Self { db, data: DbData::default() };
        state.reload()?;
        Ok(state)
    }

    /// TS `new Date().toISOString()` — millisecond-precision UTC ISO-8601.
    pub(crate) fn now_iso() -> String {
        Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
    }

    /// Re-reads the full dataset from the DB (the TS `load()`), applying the
    /// defensive list-time de-dup with physical cleanup (db-design §9).
    pub(crate) fn reload(&mut self) -> Result<()> {
        let mut data = self.db.load_all()?;
        let (item_links, dropped_item_links) =
            Self::dedupe_links(data.item_links, |link| (link.item_id.clone(), link.target_id.clone(), link.r#type.clone()), |link| &link.id, |link| &link.updated_at);
        let (item_timer_links, dropped_timer_links) =
            Self::dedupe_links(data.item_timer_links, |link| (link.item_id.clone(), link.timer_id.clone()), |link| &link.id, |link| &link.updated_at);
        for id in &dropped_item_links {
            self.db.delete_item_link(id)?;
        }
        for id in &dropped_timer_links {
            self.db.delete_item_timer_link(id)?;
        }
        data.item_links = item_links;
        data.item_timer_links = item_timer_links;
        self.data = data;
        Ok(())
    }

    /// TS service `list()` de-dup: keep the newest per key (ties → first seen),
    /// collect the dropped ids for physical removal. Output order follows the
    /// first-seen slot of each key, like the TS `Map`. No-op on clean data.
    fn dedupe_links<T, K>(links: Vec<T>, key_of: impl Fn(&T) -> K, id_of: impl Fn(&T) -> &str, updated_at_of: impl Fn(&T) -> &str) -> (Vec<T>, Vec<String>)
    where
        K: Eq + Hash,
    {
        let mut slot: HashMap<K, usize> = HashMap::new();
        let mut kept: Vec<T> = Vec::with_capacity(links.len());
        let mut dropped_ids: Vec<String> = Vec::new();
        for link in links {
            let key = key_of(&link);
            match slot.get(&key) {
                None => {
                    slot.insert(key, kept.len());
                    kept.push(link);
                }
                Some(&position) => {
                    if updated_at_of(&link) > updated_at_of(&kept[position]) {
                        dropped_ids.push(id_of(&kept[position]).to_string());
                        kept[position] = link;
                    } else {
                        dropped_ids.push(id_of(&link).to_string());
                    }
                }
            }
        }
        (kept, dropped_ids)
    }

    /// TS `createItem`: normalize, mint id + timestamps, then idempotent
    /// outgoing links.
    pub fn create_item(&mut self, input: &CreateItemInput) -> Result<Item> {
        let payload = normalize_item_create(&input.item);
        let now = Self::now_iso();
        let item = Item {
            id: Uuid::new_v4().to_string(),
            main_info_entry_id: payload.main_info_entry_id,
            tags: payload.tags,
            info_entries: payload.info_entries,
            date_time_entries: payload.date_time_entries,
            created_at: now.clone(),
            updated_at: now,
        };
        self.db.upsert_item(&item)?;
        for rel in Self::unique_relationships(&input.relationships) {
            self.create_outgoing_link(&item.id, &rel.target_id, &rel.r#type)?;
        }
        self.reload()?;
        Ok(item)
    }

    /// TS `updateItem`: merge + updatedAt bump; with `relationships` present,
    /// replace the outgoing links only (Q2 fix).
    pub fn update_item(&mut self, id: &str, input: &UpdateItemInput) -> Result<Item> {
        let Some(previous) = self.data.items.iter().find(|item| item.id == id).cloned() else {
            return Err(StateError::NotFound { entity: "item", id: id.to_string() });
        };
        let known_entry_ids: Vec<String> = previous.info_entries.iter().map(|entry| entry.id.clone()).collect();
        let payload = normalize_item_update(&input.item, &known_entry_ids, previous.main_info_entry_id.as_deref());

        let mut updated = previous;
        if let Some(tags) = payload.tags {
            updated.tags = tags;
        }
        if let Some(info_entries) = payload.info_entries {
            updated.info_entries = info_entries;
        }
        if let Some(date_time_entries) = payload.date_time_entries {
            updated.date_time_entries = date_time_entries;
        }
        match payload.main_info_entry_id {
            StarUpdate::Keep => {}
            StarUpdate::Clear => updated.main_info_entry_id = None,
            StarUpdate::Set(entry_id) => updated.main_info_entry_id = Some(entry_id),
        }
        updated.updated_at = Self::now_iso();
        self.db.upsert_item(&updated)?;

        if let Some(relationships) = &input.relationships {
            self.db.delete_item_links_outgoing(id)?;
            self.reload()?;
            for rel in Self::unique_relationships(relationships) {
                self.create_outgoing_link(id, &rel.target_id, &rel.r#type)?;
            }
        }
        self.reload()?;
        Ok(updated)
    }

    /// TS `deleteItem`: one DELETE; FK cascades remove child rows,
    /// relationships (both directions) and — Q1 fix — the item's timer links.
    pub fn delete_item(&mut self, id: &str) -> Result<()> {
        self.db.delete_item(id)?;
        self.reload()?;
        Ok(())
    }

    /// Idempotent outgoing link create (TS `itemLinkService.create`): an
    /// existing `(item_id, target_id, type)` row is returned as-is.
    fn create_outgoing_link(&mut self, item_id: &str, target_id: &str, r#type: &str) -> Result<ItemLink> {
        if let Some(existing) = self.data.item_links.iter().find(|link| link.item_id == item_id && link.target_id == target_id && link.r#type == r#type).cloned() {
            return Ok(existing);
        }
        let now = Self::now_iso();
        let link = ItemLink {
            id: Uuid::new_v4().to_string(),
            item_id: item_id.to_string(),
            target_id: target_id.to_string(),
            r#type: r#type.to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.db.upsert_item_link(&link)?;
        Ok(link)
    }

    /// Keep the first relationship per `(target_id, type)`. TS's concurrent
    /// creates could emit duplicates that the next `load()` de-dup removed; the
    /// schema's UNIQUE triple makes in-op duplicates impossible.
    fn unique_relationships(relationships: &[RelationshipInput]) -> Vec<RelationshipInput> {
        let mut out: Vec<RelationshipInput> = Vec::with_capacity(relationships.len());
        for rel in relationships {
            if !out.iter().any(|kept| kept.target_id == rel.target_id && kept.r#type == rel.r#type) {
                out.push(rel.clone());
            }
        }
        out
    }

    /// TS `createTimer` (no normalization; id + timestamps minted here).
    pub fn create_timer(&mut self, input: &CreateTimerInput) -> Result<Timer> {
        let now = Self::now_iso();
        let timer = Timer {
            id: Uuid::new_v4().to_string(),
            name: input.name.clone(),
            base_at: input.base_at.clone(),
            description: input.description.clone(),
            is_active: input.is_active,
            schedule: input.schedule,
            created_at: now.clone(),
            updated_at: now,
        };
        self.db.upsert_timer(&timer)?;
        self.reload()?;
        Ok(timer)
    }

    /// TS `updateTimer`: merge present fields, bump updatedAt.
    pub fn update_timer(&mut self, id: &str, input: &UpdateTimerInput) -> Result<Timer> {
        let Some(previous) = self.data.timers.iter().find(|timer| timer.id == id).cloned() else {
            return Err(StateError::NotFound { entity: "timer", id: id.to_string() });
        };
        let mut updated = previous;
        if let Some(name) = &input.name {
            updated.name = name.clone();
        }
        if let Some(base_at) = &input.base_at {
            updated.base_at = base_at.clone();
        }
        if let Some(description) = &input.description {
            updated.description = description.clone();
        }
        if let Some(is_active) = input.is_active {
            updated.is_active = is_active;
        }
        match &input.schedule {
            ScheduleUpdate::Keep => {}
            ScheduleUpdate::Clear => updated.schedule = None,
            ScheduleUpdate::Set(schedule) => updated.schedule = Some(*schedule),
        }
        updated.updated_at = Self::now_iso();
        self.db.upsert_timer(&updated)?;
        self.reload()?;
        Ok(updated)
    }

    /// TS `deleteTimer`; FK cascade removes the timer's item links.
    pub fn delete_timer(&mut self, id: &str) -> Result<()> {
        self.db.delete_timer(id)?;
        self.reload()?;
        Ok(())
    }

    /// Idempotent on the `(item_id, timer_id)` pair (TS `itemTimerLinkService.create`).
    pub fn create_item_timer_link(&mut self, input: &CreateItemTimerLinkInput) -> Result<ItemTimerLink> {
        if let Some(existing) = self.data.item_timer_links.iter().find(|link| link.item_id == input.item_id && link.timer_id == input.timer_id).cloned() {
            return Ok(existing);
        }
        let now = Self::now_iso();
        let link = ItemTimerLink {
            id: Uuid::new_v4().to_string(),
            item_id: input.item_id.clone(),
            timer_id: input.timer_id.clone(),
            last_checked_at: input.last_checked_at.clone(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.db.upsert_item_timer_link(&link)?;
        self.reload()?;
        Ok(link)
    }

    /// TS `updateItemTimerLink`: merge present fields, bump updatedAt.
    pub fn update_item_timer_link(&mut self, id: &str, input: &UpdateItemTimerLinkInput) -> Result<ItemTimerLink> {
        let Some(previous) = self.data.item_timer_links.iter().find(|link| link.id == id).cloned() else {
            return Err(StateError::NotFound { entity: "item timer link", id: id.to_string() });
        };
        let mut updated = previous;
        if let Some(last_checked_at) = &input.last_checked_at {
            updated.last_checked_at = last_checked_at.clone();
        }
        updated.updated_at = Self::now_iso();
        self.db.upsert_item_timer_link(&updated)?;
        self.reload()?;
        Ok(updated)
    }

    pub fn delete_item_timer_link(&mut self, id: &str) -> Result<()> {
        self.db.delete_item_timer_link(id)?;
        self.reload()?;
        Ok(())
    }

    /// TS `cycleItemTimerLink`: no-op when the link or its timer is missing.
    pub fn cycle_link(&mut self, link_id: &str, now_iso: Option<&str>) -> Result<Option<ItemTimerLink>> {
        let Some(link) = self.data.item_timer_links.iter().find(|link| link.id == link_id).cloned() else {
            return Ok(None);
        };
        let Some(timer) = self.data.timers.iter().find(|timer| timer.id == link.timer_id).cloned() else {
            return Ok(None);
        };
        let now = parse_instant(now_iso).unwrap_or_else(Utc::now).with_timezone(&Local);
        let next_checked_at = timer::cycle_next_checked_at(&timer, &link, &now);
        let mut updated = link;
        updated.last_checked_at = next_checked_at;
        updated.updated_at = Self::now_iso();
        self.db.upsert_item_timer_link(&updated)?;
        self.reload()?;
        Ok(Some(updated))
    }

    /// Filter the loaded state using the current search and tag semantics.
    pub fn filter(&self, query: &str, selected_tags: &[String]) -> Vec<Item> {
        filter_items(&self.data, query, selected_tags)
    }

    /// Timer status for every item↔timer link for the UI view model.
    pub fn statuses(&self, now_iso: Option<&str>) -> Vec<LinkStatus> {
        let now = parse_instant(now_iso).unwrap_or_else(Utc::now).with_timezone(&Local);
        self.data
            .item_timer_links
            .iter()
            .filter_map(|link| {
                let timer = self.data.timers.iter().find(|timer| timer.id == link.timer_id)?;
                Some(LinkStatus {
                    link_id: link.id.clone(),
                    item_id: link.item_id.clone(),
                    timer_id: link.timer_id.clone(),
                    status: timer::timer_status(timer, &link.last_checked_at, &now),
                })
            })
            .collect()
    }

    /// The three TS `load()` hint lists (defaults ∪ values found in data).
    pub fn hints(&self) -> Hints {
        Hints {
            tags: hints::tag_hints(&self.data.items),
            info_labels: hints::info_label_hints(&self.data.items),
            relationship_types: hints::relationship_type_hints(&self.data.item_links),
        }
    }
}

fn parse_instant(value: Option<&str>) -> Option<DateTime<Utc>> {
    value.and_then(|value| DateTime::parse_from_rfc3339(value).ok()).map(|parsed| parsed.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalize::InfoEntryInput;
    use crate::timer::VisualState;
    use std::time::Duration;

    fn temp_state() -> (tempfile::TempDir, AppState) {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = AppState::open(dir.path().join("test.db")).expect("open state");
        (dir, state)
    }

    fn item_input(tags: &[&str], entries: &[(&str, &str)]) -> ItemCreateInput {
        ItemCreateInput {
            tags: tags.iter().map(|tag| tag.to_string()).collect(),
            info_entries: entries.iter().map(|(label, value)| InfoEntryInput { id: None, label: (*label).to_string(), value: (*value).to_string() }).collect(),
            date_time_entries: Vec::new(),
            main_info_entry_id: None,
        }
    }

    fn create_item(state: &mut AppState, tags: &[&str], entries: &[(&str, &str)]) -> Item {
        state.create_item(&CreateItemInput { item: item_input(tags, entries), relationships: Vec::new() }).expect("create item")
    }

    fn no_relationships_update(item: ItemUpdateInput) -> UpdateItemInput {
        UpdateItemInput { item, relationships: None }
    }

    fn default_update_item_input() -> ItemUpdateInput {
        ItemUpdateInput { tags: None, info_entries: None, date_time_entries: None, main_info_entry_id: StarUpdate::Keep }
    }

    fn daily_timer(base_at: &str, is_active: bool) -> CreateTimerInput {
        CreateTimerInput {
            name: "t".to_string(),
            base_at: base_at.to_string(),
            description: String::new(),
            is_active,
            schedule: Some(TimerSchedule { every: 1, unit: crate::types::TimerIntervalUnit::Days }),
        }
    }

    fn link_input(item_id: &str, timer_id: &str, last_checked_at: &str) -> CreateItemTimerLinkInput {
        CreateItemTimerLinkInput { item_id: item_id.to_string(), timer_id: timer_id.to_string(), last_checked_at: last_checked_at.to_string() }
    }

    #[test]
    fn q1_delete_item_removes_its_timer_links() {
        let (dir, mut state) = temp_state();
        let item = create_item(&mut state, &[], &[]);
        let timer = state.create_timer(&daily_timer("2026-01-01T00:00:00.000Z", true)).expect("create timer");
        state.create_item_timer_link(&link_input(&item.id, &timer.id, "2026-01-01T00:00:00.000Z")).expect("create link");
        assert_eq!(state.data.item_timer_links.len(), 1);

        state.delete_item(&item.id).expect("delete item");

        assert!(state.data.items.is_empty());
        assert!(state.data.item_timer_links.is_empty(), "Q1: timer links must not orphan");
        // Verify at the DB level, not just in the in-memory copy.
        let reloaded = Store::open(dir.path().join("test.db")).expect("reopen");
        assert!(reloaded.load_all().expect("load").item_timer_links.is_empty());
    }

    #[test]
    fn q2_update_replaces_only_outgoing_links() {
        let (_dir, mut state) = temp_state();
        let a = create_item(&mut state, &[], &[("title", "a")]);
        let b = create_item(&mut state, &[], &[("title", "b")]);
        let c = create_item(&mut state, &[], &[("title", "c")]);

        // B → A.
        let mut update_b = no_relationships_update(default_update_item_input());
        update_b.relationships = Some(vec![RelationshipInput { target_id: a.id.clone(), r#type: "related".to_string() }]);
        state.update_item(&b.id, &update_b).expect("link B→A");
        assert_eq!(state.data.item_links.len(), 1);

        // A's outgoing are replaced; the incoming B→A must survive (Q2 fix).
        let mut update_a = no_relationships_update(default_update_item_input());
        update_a.relationships = Some(vec![RelationshipInput { target_id: c.id.clone(), r#type: "related".to_string() }]);
        state.update_item(&a.id, &update_a).expect("replace A's outgoing");

        let links: Vec<(String, String)> = state.data.item_links.iter().map(|link| (link.item_id.clone(), link.target_id.clone())).collect();
        assert_eq!(links, vec![(b.id.clone(), a.id.clone()), (a.id.clone(), c.id.clone())]);
    }

    #[test]
    fn create_item_normalizes_mints_and_links() {
        let (_dir, mut state) = temp_state();
        let other = create_item(&mut state, &[], &[]);

        let item = state
            .create_item(&CreateItemInput {
                item: ItemCreateInput {
                    tags: vec![" Work ".to_string(), "work".to_string(), "   ".to_string()],
                    info_entries: vec![InfoEntryInput { id: None, label: " Title ".to_string(), value: " x ".to_string() }],
                    date_time_entries: Vec::new(),
                    main_info_entry_id: None,
                },
                relationships: vec![RelationshipInput { target_id: other.id.clone(), r#type: "related".to_string() }],
            })
            .expect("create item");

        let uuid = Uuid::parse_str(&item.id).expect("uuid");
        assert_eq!(uuid.get_version(), Some(uuid::Version::Random));
        assert_eq!(item.tags, vec!["work".to_string()]);
        assert_eq!(item.info_entries, vec![crate::types::InfoEntry { id: item.info_entries[0].id.clone(), label: "Title".to_string(), value: "x".to_string() }]);
        assert_eq!(item.created_at, item.updated_at);
        assert_eq!(state.data.item_links.len(), 1);
        assert_eq!(state.data.item_links[0].target_id, other.id);
    }

    #[test]
    fn update_item_merges_bumps_and_handles_relationships_tri_state() {
        let (_dir, mut state) = temp_state();
        let item = create_item(&mut state, &["a"], &[("title", "keep-me")]);
        let other = create_item(&mut state, &[], &[]);

        // Outgoing link to be manipulated.
        let mut with_link = no_relationships_update(default_update_item_input());
        with_link.relationships = Some(vec![RelationshipInput { target_id: other.id.clone(), r#type: "related".to_string() }]);
        state.update_item(&item.id, &with_link).expect("add link");
        assert_eq!(state.data.item_links.len(), 1);

        // Absent relationships: links untouched, entry survives, updatedAt bumped.
        std::thread::sleep(Duration::from_millis(2));
        let mut tags_only = no_relationships_update(default_update_item_input());
        tags_only.item.tags = Some(vec!["b".to_string()]);
        let updated = state.update_item(&item.id, &tags_only).expect("update tags");
        assert!(updated.updated_at > item.updated_at);
        assert_eq!(updated.tags, vec!["b".to_string()]);
        assert_eq!(updated.info_entries.len(), 1);
        assert_eq!(state.data.item_links.len(), 1);

        // Present-but-empty relationships: outgoing wiped (TS truthy-empty).
        let mut empty_rels = no_relationships_update(default_update_item_input());
        empty_rels.relationships = Some(Vec::new());
        state.update_item(&item.id, &empty_rels).expect("clear links");
        assert!(state.data.item_links.is_empty());

        // Unknown item id.
        let err = state.update_item("missing", &no_relationships_update(default_update_item_input())).expect_err("not found");
        assert!(matches!(err, StateError::NotFound { entity: "item", .. }));
    }

    #[test]
    fn update_item_clears_star_when_starred_entry_removed() {
        let star_id = "11111111-1111-4111-8111-111111111111";
        let (_dir, mut state) = temp_state();
        let item = state
            .create_item(&CreateItemInput {
                item: ItemCreateInput {
                    tags: Vec::new(),
                    info_entries: vec![
                        InfoEntryInput { id: Some(star_id.to_string()), label: "a".to_string(), value: "1".to_string() },
                        InfoEntryInput { id: None, label: "b".to_string(), value: "2".to_string() },
                    ],
                    date_time_entries: Vec::new(),
                    main_info_entry_id: Some(star_id.to_string()),
                },
                relationships: Vec::new(),
            })
            .expect("create item");
        assert_eq!(item.main_info_entry_id.as_deref(), Some(star_id));

        // Replace entries keeping only the unstarred one → star cleared.
        let mut update = no_relationships_update(default_update_item_input());
        update.item.info_entries = Some(vec![InfoEntryInput { id: None, label: "b".to_string(), value: "2".to_string() }]);
        let updated = state.update_item(&item.id, &update).expect("update entries");
        assert!(updated.main_info_entry_id.is_none());
    }

    #[test]
    fn timer_crud_and_cascade() {
        let (_dir, mut state) = temp_state();
        let item = create_item(&mut state, &[], &[]);
        let timer = state.create_timer(&daily_timer("2026-01-01T00:00:00.000Z", true)).expect("create timer");
        state.create_item_timer_link(&link_input(&item.id, &timer.id, "2026-01-01T00:00:00.000Z")).expect("create link");

        let update = UpdateTimerInput {
            name: Some("renamed".to_string()),
            schedule: ScheduleUpdate::Set(TimerSchedule { every: 2, unit: crate::types::TimerIntervalUnit::Days }),
            ..Default::default()
        };
        std::thread::sleep(Duration::from_millis(2));
        let updated = state.update_timer(&timer.id, &update).expect("update timer");
        assert_eq!(updated.name, "renamed");
        assert_eq!(updated.base_at, "2026-01-01T00:00:00.000Z");
        assert_eq!(updated.schedule.expect("schedule").every, 2);
        assert!(updated.updated_at > timer.updated_at);

        state.delete_timer(&timer.id).expect("delete timer");
        assert!(state.data.timers.is_empty());
        assert!(state.data.item_timer_links.is_empty(), "timer delete must cascade to its links");

        let err = state.update_timer("missing", &UpdateTimerInput::default()).expect_err("not found");
        assert!(matches!(err, StateError::NotFound { entity: "timer", .. }));
    }

    #[test]
    fn item_timer_link_create_is_idempotent_on_pair() {
        let (_dir, mut state) = temp_state();
        let item = create_item(&mut state, &[], &[]);
        let timer = state.create_timer(&daily_timer("2026-01-01T00:00:00.000Z", true)).expect("create timer");

        let first = state.create_item_timer_link(&link_input(&item.id, &timer.id, "2026-01-01T00:00:00.000Z")).expect("first");
        let second = state.create_item_timer_link(&link_input(&item.id, &timer.id, "2026-01-02T00:00:00.000Z")).expect("second");
        assert_eq!(first.id, second.id, "existing pair must be returned as-is");
        assert_eq!(first.last_checked_at, "2026-01-01T00:00:00.000Z");
        assert_eq!(state.data.item_timer_links.len(), 1);
    }

    #[test]
    fn cycle_link_red_then_yellow_on_daily_schedule() {
        let (_dir, mut state) = temp_state();
        let item = create_item(&mut state, &[], &[]);
        let timer = state.create_timer(&daily_timer("2026-01-01T00:00:00.000Z", true)).expect("create timer");
        let link = state.create_item_timer_link(&link_input(&item.id, &timer.id, "2026-01-05T00:00:00.000Z")).expect("create link");

        let now_iso = "2026-01-07T12:00:00.000Z";
        let statuses = state.statuses(Some(now_iso));
        assert_eq!(statuses[0].status.visual_state, VisualState::Red, "checked before last run is red");

        let cycled = state.cycle_link(&link.id, Some(now_iso)).expect("cycle").expect("link exists");
        assert_eq!(cycled.last_checked_at, "2026-01-07T00:00:00.000Z", "red cycle picks the last run");

        let statuses = state.statuses(Some(now_iso));
        // Checked == last run; next run 12h away (≤ 24h warning window) → yellow.
        assert_eq!(statuses[0].status.visual_state, VisualState::Yellow);

        // Missing link or timer: no-op.
        assert!(state.cycle_link("missing", Some(now_iso)).expect("no-op").is_none());
    }

    #[test]
    fn statuses_cover_all_visual_states() {
        let (_dir, mut state) = temp_state();
        let item = create_item(&mut state, &[], &[]);
        let now_iso = "2026-01-07T12:00:00.000Z";

        // Red: daily timer, checked before the last run.
        let red_timer = state.create_timer(&daily_timer("2026-01-01T00:00:00.000Z", true)).expect("timer");
        state.create_item_timer_link(&link_input(&item.id, &red_timer.id, "2026-01-05T00:00:00.000Z")).expect("link");

        // Blue: one-shot future base prechecked at the next run.
        let blue_timer = state
            .create_timer(&CreateTimerInput { name: "b".to_string(), base_at: "2026-02-01T00:00:00.000Z".to_string(), description: String::new(), is_active: true, schedule: None })
            .expect("timer");
        state.create_item_timer_link(&link_input(&item.id, &blue_timer.id, "2026-02-01T00:00:00.000Z")).expect("link");

        // Green: one-shot past base, checked at its run (checked after it would be blue).
        let green_timer = state
            .create_timer(&CreateTimerInput { name: "g".to_string(), base_at: "2026-01-01T00:00:00.000Z".to_string(), description: String::new(), is_active: true, schedule: None })
            .expect("timer");
        state.create_item_timer_link(&link_input(&item.id, &green_timer.id, "2026-01-01T00:00:00.000Z")).expect("link");

        // Yellow: daily timer checked at the last run, next run 12h away.
        let yellow_timer = state.create_timer(&daily_timer("2026-01-01T00:00:00.000Z", true)).expect("timer");
        state.create_item_timer_link(&link_input(&item.id, &yellow_timer.id, "2026-01-07T00:00:00.000Z")).expect("link");

        // Muted: inactive timer.
        let muted_timer = state.create_timer(&daily_timer("2026-01-01T00:00:00.000Z", false)).expect("timer");
        state.create_item_timer_link(&link_input(&item.id, &muted_timer.id, "2026-01-05T00:00:00.000Z")).expect("link");

        let statuses = state.statuses(Some(now_iso));
        assert_eq!(statuses.len(), 5);
        let by_timer = |timer_id: &str| statuses.iter().find(|status| status.timer_id == timer_id).expect("status").status.visual_state;
        assert_eq!(by_timer(&red_timer.id), VisualState::Red);
        assert_eq!(by_timer(&blue_timer.id), VisualState::Blue);
        assert_eq!(by_timer(&green_timer.id), VisualState::Green);
        assert_eq!(by_timer(&yellow_timer.id), VisualState::Yellow);
        assert_eq!(by_timer(&muted_timer.id), VisualState::Muted);
    }

    #[test]
    fn filter_and_hints_over_loaded_state() {
        let (_dir, mut state) = temp_state();
        create_item(&mut state, &["work"], &[("title", "alpha")]);
        create_item(&mut state, &["home"], &[("website", "beta")]);

        let ids: Vec<String> = state.filter("alpha", &[]).into_iter().map(|item| item.id).collect();
        assert_eq!(ids.len(), 1);
        let ids: Vec<String> = state.filter("", &["home".to_string()]).into_iter().map(|item| item.id).collect();
        assert_eq!(ids.len(), 1);

        let hints = state.hints();
        assert!(hints.tags.contains(&"work".to_string()) && hints.tags.contains(&"home".to_string()));
        assert!(hints.info_labels.contains(&"website".to_string()));
        assert_eq!(
            hints.relationship_types,
            vec!["contact".to_string(), "link".to_string(), "recovery_info".to_string(), "recovery_info_primary".to_string(), "related".to_string()]
        );
    }

    #[test]
    fn dedupe_links_keeps_newest_ties_keep_first_seen() {
        let link = |id: &str, item_id: &str, updated_at: &str| ItemTimerLink {
            id: id.to_string(),
            item_id: item_id.to_string(),
            timer_id: "t".to_string(),
            last_checked_at: "2026-01-01T00:00:00.000Z".to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: updated_at.to_string(),
        };
        let links = vec![
            link("old", "i", "2026-01-02T00:00:00.000Z"),
            link("new", "i", "2026-01-04T00:00:00.000Z"),
            // Equal updatedAt to the previous row of pair (i2, t) → first seen wins.
            link("first", "i2", "2026-01-03T00:00:00.000Z"),
            link("second", "i2", "2026-01-03T00:00:00.000Z"),
        ];

        let (kept, dropped) = AppState::dedupe_links(links, |link| (link.item_id.clone(), link.timer_id.clone()), |link| &link.id, |link| &link.updated_at);

        assert_eq!(kept.iter().map(|link| link.id.as_str()).collect::<Vec<_>>(), ["new", "first"], "output keeps the first-seen slot per key");
        assert_eq!(dropped, vec!["old".to_string(), "second".to_string()]);
    }
}
