//! Golden-vector tests for item search.
//!
//! Each vector carries the whole dataset plus `subjectId` (the item being tested)
//! and a query; the expected value is the boolean result of `matches_item_search`.
//! Vectors omit info-entry ids where search does not need entry identity, so the
//! harness deserializes into local raw shapes and converts to the domain types.

use std::fs;

use a22_core::search::{matches_item_search, SearchContext};
use a22_core::types::{DateTimeEntry, DbData, InfoEntry, Item, ItemLink, ItemTimerLink, Timer};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    name: String,
    items: Vec<RawItem>,
    #[serde(default)]
    timers: Vec<Timer>,
    #[serde(default)]
    item_links: Vec<ItemLink>,
    #[serde(default)]
    item_timer_links: Vec<ItemTimerLink>,
    subject_id: String,
    query: String,
    expected: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawItem {
    id: String,
    #[serde(default)]
    main_info_entry_id: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    info_entries: Vec<RawInfoEntry>,
    #[serde(default)]
    date_time_entries: Vec<DateTimeEntry>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawInfoEntry {
    /// Omitted by the harness where entry identity is irrelevant to search.
    #[serde(default)]
    id: String,
    label: String,
    value: String,
}

impl RawItem {
    fn into_item(self) -> Item {
        Item {
            id: self.id,
            main_info_entry_id: self.main_info_entry_id,
            tags: self.tags,
            info_entries: self.info_entries.into_iter().map(|entry| InfoEntry { id: entry.id, label: entry.label, value: entry.value }).collect(),
            date_time_entries: self.date_time_entries,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

#[test]
fn golden_search() {
    let raw = fs::read_to_string("tests/golden/search.json").expect("read tests/golden/search.json");
    let vectors: Vec<Vector> = serde_json::from_str(&raw).expect("parse search.json");
    assert!(!vectors.is_empty());

    for vector in &vectors {
        let data = DbData {
            items: vector.items.iter().cloned().map(RawItem::into_item).collect(),
            timers: vector.timers.clone(),
            item_links: vector.item_links.clone(),
            item_timer_links: vector.item_timer_links.clone(),
            snapshots: Vec::new(),
        };
        let ctx = SearchContext::new(&data);
        let subject = data.items.iter().find(|item| item.id == vector.subject_id).unwrap_or_else(|| panic!("subject {} missing in {}", vector.subject_id, vector.name));

        assert_eq!(matches_item_search(subject, &ctx, &vector.query), vector.expected, "vector {} failed", vector.name);
    }
}
