//! Editor hint lists — port of `IndexedDbItemService.listTags` / `listInfoLabels` /
//! `listRelationshipTypes`: defaults ∪ values observed in the data, empty values
//! dropped, deduped and sorted (TS `sortBy(uniq(...))`).

use crate::normalize::{INFO_LABEL_DEFAULTS, ITEM_TAGS_DEFAULTS, RELATIONSHIP_TYPE_DEFAULTS};
use crate::types::{Item, ItemLink};

pub fn tag_hints(items: &[Item]) -> Vec<String> {
    union_sorted(ITEM_TAGS_DEFAULTS, items.iter().flat_map(|item| item.tags.iter()))
}

pub fn info_label_hints(items: &[Item]) -> Vec<String> {
    union_sorted(INFO_LABEL_DEFAULTS, items.iter().flat_map(|item| item.info_entries.iter()).map(|entry| &entry.label))
}

pub fn relationship_type_hints(links: &[ItemLink]) -> Vec<String> {
    union_sorted(RELATIONSHIP_TYPE_DEFAULTS, links.iter().map(|link| &link.r#type))
}

fn union_sorted<S>(defaults: &[&str], observed: impl Iterator<Item = S>) -> Vec<String>
where
    S: AsRef<str>,
{
    let mut values: Vec<String> = defaults.iter().copied().map(str::to_string).chain(observed.map(|value| value.as_ref().to_string())).filter(|value| !value.is_empty()).collect();
    values.sort();
    values.dedup();
    values
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{InfoEntry, ItemLink};

    fn item(tags: &[&str], labels: &[&str]) -> Item {
        Item {
            id: "item-x".to_string(),
            main_info_entry_id: None,
            tags: tags.iter().copied().map(str::to_string).collect(),
            info_entries: labels.iter().enumerate().map(|(i, label)| InfoEntry { id: format!("e{i}"), label: (*label).to_string(), value: "v".to_string() }).collect(),
            date_time_entries: vec![],
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
        }
    }

    fn link(r#type: &str) -> ItemLink {
        ItemLink {
            id: "link-x".to_string(),
            item_id: "a".to_string(),
            target_id: "b".to_string(),
            r#type: r#type.to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
        }
    }

    #[test]
    fn empty_data_yields_sorted_defaults() {
        assert_eq!(tag_hints(&[]), vec!["contact", "email", "finance", "russia", "serbia", "social_media", "utilities"]);
        assert_eq!(info_label_hints(&[]), vec!["description", "fat", "title"]);
        assert_eq!(relationship_type_hints(&[]), vec!["contact", "link", "recovery_info", "recovery_info_primary", "related"]);
    }

    #[test]
    fn union_dedupe_and_sort() {
        let items = vec![item(&["serbia", "Urgent"], &["title", "Website"])];
        assert_eq!(tag_hints(&items), vec!["Urgent", "contact", "email", "finance", "russia", "serbia", "social_media", "utilities"]);
        assert_eq!(info_label_hints(&items), vec!["Website", "description", "fat", "title"]);
    }

    #[test]
    fn case_is_preserved_and_empty_values_dropped() {
        let items = vec![item(&["Serbia", ""], &[""])];
        assert_eq!(tag_hints(&items), vec!["Serbia", "contact", "email", "finance", "russia", "serbia", "social_media", "utilities"]);
        assert_eq!(info_label_hints(&items), vec!["description", "fat", "title"]);
    }

    #[test]
    fn relationship_types_union() {
        let links = vec![link("related"), link("mentor")];
        assert_eq!(relationship_type_hints(&links), vec!["contact", "link", "mentor", "recovery_info", "recovery_info_primary", "related"]);
    }
}
