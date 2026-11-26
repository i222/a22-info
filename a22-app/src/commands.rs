//! Tauri command surface: thin wrappers over the `a22-core` state operations.
//! Each command locks the managed `Mutex<AppState>`, calls the operation, and
//! maps errors to a user-facing string. This is internal IPC.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use a22_core::import_export::{ExportedFile, ImportSummary};
use a22_core::state::{AppState, CreateItemInput, CreateItemTimerLinkInput, CreateTimerInput, StateError, UpdateItemInput, UpdateItemTimerLinkInput, UpdateTimerInput};
use a22_core::timer::TimerStatus;
use a22_core::types::{Item, ItemLink, ItemTimerLink, Timer};

/// `db_load_all` result — the single round-trip replacing the 7 parallel Dexie reads.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAll {
    pub items: Vec<Item>,
    pub timers: Vec<Timer>,
    pub item_links: Vec<ItemLink>,
    pub item_timer_links: Vec<ItemTimerLink>,
    pub tags: Vec<String>,
    pub info_label_hints: Vec<String>,
    pub relationship_type_hints: Vec<String>,
}

type CommandResult<T> = Result<T, String>;

/// Lock the managed state and run an op; poison and domain errors become strings.
fn with_state<R>(state: &Mutex<AppState>, f: impl FnOnce(&mut AppState) -> Result<R, StateError>) -> CommandResult<R> {
    let mut guard = state.lock().map_err(|poisoned| poisoned.to_string())?;
    f(&mut guard).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn db_load_all(state: State<'_, Mutex<AppState>>) -> CommandResult<LoadAll> {
    with_state(&state, |app| {
        let hints = app.hints();
        Ok(LoadAll {
            items: app.data.items.clone(),
            timers: app.data.timers.clone(),
            item_links: app.data.item_links.clone(),
            item_timer_links: app.data.item_timer_links.clone(),
            tags: hints.tags,
            info_label_hints: hints.info_labels,
            relationship_type_hints: hints.relationship_types,
        })
    })
}

#[tauri::command]
pub fn items_create(state: State<'_, Mutex<AppState>>, input: CreateItemInput) -> CommandResult<Item> {
    with_state(&state, |app| app.create_item(&input))
}

#[tauri::command]
pub fn items_update(state: State<'_, Mutex<AppState>>, id: String, input: UpdateItemInput) -> CommandResult<Item> {
    with_state(&state, |app| app.update_item(&id, &input))
}

#[tauri::command]
pub fn items_delete(state: State<'_, Mutex<AppState>>, id: String) -> CommandResult<()> {
    with_state(&state, |app| app.delete_item(&id))
}

#[tauri::command]
pub fn timers_create(state: State<'_, Mutex<AppState>>, input: CreateTimerInput) -> CommandResult<Timer> {
    with_state(&state, |app| app.create_timer(&input))
}

#[tauri::command]
pub fn timers_update(state: State<'_, Mutex<AppState>>, id: String, input: UpdateTimerInput) -> CommandResult<Timer> {
    with_state(&state, |app| app.update_timer(&id, &input))
}

#[tauri::command]
pub fn timers_delete(state: State<'_, Mutex<AppState>>, id: String) -> CommandResult<()> {
    with_state(&state, |app| app.delete_timer(&id))
}

#[tauri::command]
pub fn item_timer_links_create(state: State<'_, Mutex<AppState>>, input: CreateItemTimerLinkInput) -> CommandResult<ItemTimerLink> {
    with_state(&state, |app| app.create_item_timer_link(&input))
}

#[tauri::command]
pub fn item_timer_links_update(state: State<'_, Mutex<AppState>>, id: String, input: UpdateItemTimerLinkInput) -> CommandResult<ItemTimerLink> {
    with_state(&state, |app| app.update_item_timer_link(&id, &input))
}

#[tauri::command]
pub fn item_timer_links_delete(state: State<'_, Mutex<AppState>>, id: String) -> CommandResult<()> {
    with_state(&state, |app| app.delete_item_timer_link(&id))
}

/// `item_timer_link_cycle`: `null` when the link or its timer is missing (TS no-op).
#[tauri::command]
pub fn item_timer_link_cycle(state: State<'_, Mutex<AppState>>, link_id: String, now_iso: Option<String>) -> CommandResult<Option<ItemTimerLink>> {
    with_state(&state, |app| app.cycle_link(&link_id, now_iso.as_deref()))
}

#[tauri::command]
pub fn items_filter(state: State<'_, Mutex<AppState>>, query: String, tags: Vec<String>) -> CommandResult<Vec<Item>> {
    with_state(&state, |app| Ok(app.filter(&query, &tags)))
}

/// `timers_statuses`: raw engine status per link id; labels stay in the TS view model.
#[tauri::command]
pub fn timers_statuses(state: State<'_, Mutex<AppState>>, now_iso: Option<String>) -> CommandResult<HashMap<String, TimerStatus>> {
    with_state(&state, |app| Ok(app.statuses(now_iso.as_deref()).into_iter().map(|status| (status.link_id, status.status)).collect()))
}

#[tauri::command]
pub fn export_snapshot(state: State<'_, Mutex<AppState>>) -> CommandResult<ExportedFile> {
    with_state(&state, |app| Ok(app.export_snapshot()))
}

#[tauri::command]
pub fn import_snapshot(state: State<'_, Mutex<AppState>>, raw_json: String) -> CommandResult<ImportSummary> {
    with_state(&state, |app| app.import_snapshot(&raw_json))
}

#[cfg(test)]
mod tests {
    //! Wire-shape checks for the IPC contract used by the typed client.

    use super::*;

    #[test]
    fn command_inputs_accept_camel_case_js_payloads() {
        let input: CreateItemInput = serde_json::from_str(
            r#"{"tags":[" Work "],"infoEntries":[{"label":"title","value":"A"}],"dateTimeEntries":[],"mainInfoEntryId":null,"relationships":[{"targetId":"i2","type":"related"}]}"#,
        )
        .expect("create item input");
        assert_eq!(input.item.tags, vec![" Work ".to_string()]);
        assert_eq!(input.relationships.len(), 1);
        assert_eq!(input.relationships[0].r#type, "related");

        let absent: UpdateItemInput = serde_json::from_str(r#"{"tags":["a"]}"#).expect("update without relationships");
        assert!(absent.relationships.is_none());

        let empty: UpdateItemInput = serde_json::from_str(r#"{"relationships":[]}"#).expect("empty relationships");
        assert_eq!(empty.relationships, Some(Vec::new()));

        let timer: CreateTimerInput =
            serde_json::from_str(r#"{"name":"Rent","baseAt":"2026-08-20T00:00:00.000Z","description":"","isActive":true,"schedule":{"every":1,"unit":"days"}}"#)
                .expect("create timer input");
        assert_eq!(timer.schedule.expect("schedule").every, 1);

        let cleared: UpdateTimerInput = serde_json::from_str(r#"{"schedule":null}"#).expect("clear schedule");
        assert_eq!(cleared.schedule, a22_core::state::ScheduleUpdate::Clear);

        let kept: UpdateTimerInput = serde_json::from_str(r#"{"name":"x"}"#).expect("absent schedule keeps");
        assert_eq!(kept.schedule, a22_core::state::ScheduleUpdate::Keep);

        let link: CreateItemTimerLinkInput = serde_json::from_str(r#"{"itemId":"i1","timerId":"t1","lastCheckedAt":"2026-01-01T00:00:00.000Z"}"#).expect("create link input");
        assert_eq!(link.item_id, "i1");
    }

    #[test]
    fn command_outputs_serialize_camel_case() {
        let load_all = LoadAll {
            items: Vec::new(),
            timers: Vec::new(),
            item_links: Vec::new(),
            item_timer_links: Vec::new(),
            tags: vec!["a".to_string()],
            info_label_hints: Vec::new(),
            relationship_type_hints: Vec::new(),
        };
        let value = serde_json::to_value(&load_all).expect("serialize");
        for key in ["items", "timers", "itemLinks", "itemTimerLinks", "tags", "infoLabelHints", "relationshipTypeHints"] {
            assert!(value.get(key).is_some(), "missing key {key}");
        }

        let summary = ImportSummary { items: 1, timers: 2, item_links: 3, item_timer_links: 4, warnings: vec!["w".to_string()] };
        let value = serde_json::to_value(&summary).expect("serialize");
        for key in ["items", "timers", "itemLinks", "itemTimerLinks", "warnings"] {
            assert!(value.get(key).is_some(), "missing key {key}");
        }

        let exported = ExportedFile { json: "{}".to_string(), filename: "items-export-x.json".to_string() };
        let value = serde_json::to_value(&exported).expect("serialize");
        assert_eq!(value["json"], "{}");
        assert_eq!(value["filename"], "items-export-x.json");
    }
}
