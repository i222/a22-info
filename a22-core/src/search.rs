//! Search and filter over an explicit dataset.
//!
//! The separate starred-label field is not searched because the starred entry's
//! label and value are already covered by the entries loop. Display-entry
//! resolution (star → `title` → first) keys off `mainInfoEntryId`.

use std::collections::HashMap;

use crate::types::{DbData, InfoEntry, Item, ItemLink, ItemTimerLink, Timer};

/// Lookup tables for one filter pass: built once from the dataset and shared by
/// every item (TS builds the same `Map`s per list render).
pub struct SearchContext<'a> {
    timers_by_id: HashMap<&'a str, &'a Timer>,
    items_by_id: HashMap<&'a str, &'a Item>,
    item_links: &'a [ItemLink],
    item_timer_links: &'a [ItemTimerLink],
}

impl<'a> SearchContext<'a> {
    pub fn new(data: &'a DbData) -> Self {
        let timers_by_id = data.timers.iter().map(|timer| (timer.id.as_str(), timer)).collect();
        let items_by_id = data.items.iter().map(|item| (item.id.as_str(), item)).collect();
        Self { timers_by_id, items_by_id, item_links: &data.item_links, item_timer_links: &data.item_timer_links }
    }
}

/// Case-insensitive substring search over the same field set as TS
/// `matchesItemSearch`; an empty/whitespace-only query matches everything.
pub fn matches_item_search(item: &Item, ctx: &SearchContext, raw_query: &str) -> bool {
    let query = raw_query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }

    // The starred entry is already included in the info-entry fields below.
    let mut values: Vec<String> = vec![item.id.clone(), item.created_at.clone(), item.updated_at.clone()];
    for entry in &item.info_entries {
        values.push(entry.label.clone());
        values.push(entry.value.clone());
    }
    for entry in &item.date_time_entries {
        values.push(entry.label.clone());
        values.push(entry.value.to_string());
    }
    for link in ctx.item_links.iter().filter(|link| link.item_id == item.id) {
        let target_name = ctx.items_by_id.get(link.target_id.as_str()).copied().map(item_display_value).unwrap_or_default();
        values.push(link.r#type.clone());
        values.push(link.target_id.clone());
        values.push(target_name);
    }
    for link in ctx.item_timer_links.iter().filter(|link| link.item_id == item.id) {
        let Some(timer) = ctx.timers_by_id.get(link.timer_id.as_str()) else {
            continue;
        };
        values.push(timer.name.clone());
        values.push(timer.base_at.clone());
        values.push(timer.description.clone());
        values.push(if timer.is_active { "active".to_string() } else { "inactive".to_string() });
        values.push(link.last_checked_at.clone());
    }

    values.iter().any(|value| value.to_lowercase().contains(&query))
}

/// TS `hasAllTags`: an empty selection matches everything.
pub fn has_all_tags(item: &Item, selected_tags: &[String]) -> bool {
    selected_tags.iter().all(|tag| item.tags.contains(tag))
}

/// Store list filter (TS `items.filter(...)`): AND of the tag and search
/// predicates, storage order preserved.
pub fn filter_items(data: &DbData, query: &str, selected_tags: &[String]) -> Vec<Item> {
    let ctx = SearchContext::new(data);
    data.items.iter().filter(|item| has_all_tags(item, selected_tags) && matches_item_search(item, &ctx, query)).cloned().collect()
}

/// TS `resolveDisplayInfoEntry`: the starred entry (by id), else the first
/// `title`-labelled entry (case-insensitive), else the first entry.
fn resolve_display_info_entry(item: &Item) -> Option<&InfoEntry> {
    if let Some(star_id) = item.main_info_entry_id.as_deref() {
        if let Some(entry) = item.info_entries.iter().find(|entry| entry.id == star_id) {
            return Some(entry);
        }
    }
    item.info_entries.iter().find(|entry| entry.label.to_lowercase() == "title").or_else(|| item.info_entries.first())
}

/// TS `getItemDisplayValue`: the display entry's value, or '-' when the item has none.
fn item_display_value(item: &Item) -> String {
    resolve_display_info_entry(item).map(|entry| entry.value.clone()).unwrap_or_else(|| '-'.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_item(id: &str, tags: &[&str], note_value: Option<&str>) -> Item {
        Item {
            id: id.to_string(),
            main_info_entry_id: None,
            tags: tags.iter().map(|tag| tag.to_string()).collect(),
            info_entries: note_value.map(|value| vec![InfoEntry { id: format!("{id}-e1"), label: "note".to_string(), value: value.to_string() }]).unwrap_or_default(),
            date_time_entries: Vec::new(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
        }
    }

    #[test]
    fn has_all_tags_semantics() {
        let item = test_item("i1", &["a", "b"], None);
        assert!(has_all_tags(&item, &[]));
        assert!(has_all_tags(&item, &["a".to_string()]));
        assert!(has_all_tags(&item, &["a".to_string(), "b".to_string()]));
        assert!(!has_all_tags(&item, &["c".to_string()]));
    }

    #[test]
    fn filter_items_is_and_of_search_and_tags_in_storage_order() {
        let data = DbData { items: vec![test_item("x", &["t1"], Some("foo")), test_item("y", &["t2"], Some("bar")), test_item("z", &["t2"], Some("baz"))], ..Default::default() };

        let tags = vec!["t2".to_string()];
        let filtered = filter_items(&data, "b", &tags);
        let ids: Vec<&str> = filtered.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["y", "z"]);

        let filtered = filter_items(&data, "", &[]);
        let ids: Vec<&str> = filtered.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["x", "y", "z"]);

        // Search matches y and z; only y carries tag t1.
        let filtered = filter_items(&data, "b", &["t1".to_string()]);
        let ids: Vec<&str> = filtered.iter().map(|item| item.id.as_str()).collect();
        assert!(ids.is_empty());
    }

    #[test]
    fn display_value_falls_back_title_then_first() {
        let none = test_item("i0", &[], None);
        assert_eq!(item_display_value(&none), "-");

        let mut titled = test_item("i1", &[], None);
        titled.info_entries =
            vec![InfoEntry { id: "e1".into(), label: "other".into(), value: "first".into() }, InfoEntry { id: "e2".into(), label: "Title".into(), value: "titled".into() }];
        assert_eq!(item_display_value(&titled), "titled");

        let mut starred = titled.clone();
        starred.info_entries.insert(0, InfoEntry { id: "e0".into(), label: "custom".into(), value: "starred".into() });
        starred.main_info_entry_id = Some("e0".to_string());
        assert_eq!(item_display_value(&starred), "starred");

        // Dangling star id falls through to the title entry (TS: no label match → same).
        starred.main_info_entry_id = Some("missing".to_string());
        assert_eq!(item_display_value(&starred), "titled");
    }
}
