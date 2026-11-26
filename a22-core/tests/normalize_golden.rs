//! Golden-vector tests for item normalization.
//!
//! `$uuid:<n>` markers in the expected values stand for entry ids minted by the
//! implementation. Before comparing, each marker is replaced with the actual id
//! found at the same position (asserted to be a UUIDv4), and all occurrences of
//! one marker must resolve to the same actual id.

use std::fs;

use a22_core::normalize::{normalize_item_create, normalize_item_update, ItemCreateInput, ItemCreatePayload, ItemUpdateInput, ItemUpdatePayload};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    name: String,
    kind: String,
    input: serde_json::Value,
    #[serde(default)]
    known_entry_ids: Option<Vec<String>>,
    #[serde(default)]
    current_star: Option<String>,
    expected: serde_json::Value,
}

/// Replace `$uuid:<n>` markers in `expected` with the actual ids from `actual`
/// (parallel walk); same marker must always resolve to the same actual id.
fn apply_actual_to_expected(expected: &mut serde_json::Value, actual: &serde_json::Value) {
    let mut seen: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    match expected {
        serde_json::Value::String(marker) if marker.starts_with("$uuid:") => {
            let serde_json::Value::String(actual_id) = actual else { panic!("marker {marker} has no string counterpart in actual") };
            let uuid = Uuid::parse_str(actual_id).expect("actual generated id must be a UUID");
            assert_eq!(uuid.get_version(), Some(uuid::Version::Random), "actual generated id must be UUIDv4 ({actual_id})");
            match seen.get(marker) {
                Some(previous) => assert_eq!(previous, actual_id, "marker {marker} resolved to different ids"),
                None => {
                    seen.insert(marker.clone(), actual_id.clone());
                }
            }
            *expected = serde_json::Value::String(actual_id.clone());
        }
        serde_json::Value::Array(expected_items) => {
            let serde_json::Value::Array(actual_items) = actual else { panic!("expected an array but actual is not one") };
            assert_eq!(expected_items.len(), actual_items.len(), "array length mismatch");
            for (expected_item, actual_item) in expected_items.iter_mut().zip(actual_items.iter()) {
                apply_actual_to_expected(expected_item, actual_item);
            }
        }
        serde_json::Value::Object(expected_fields) => {
            let serde_json::Value::Object(actual_fields) = actual else { panic!("expected an object but actual is not one") };
            for (key, expected_value) in expected_fields.iter_mut() {
                match actual_fields.get(key) {
                    Some(actual_value) => apply_actual_to_expected(expected_value, actual_value),
                    None => assert!(expected_value.is_null(), "expected key {key} is missing from actual"),
                }
            }
        }
        _ => {}
    }
}

#[test]
fn golden_normalize() {
    let raw = fs::read_to_string("tests/golden/normalize.json").expect("read tests/golden/normalize.json");
    let vectors: Vec<Vector> = serde_json::from_str(&raw).expect("parse normalize.json");
    assert!(!vectors.is_empty());

    for vector in &vectors {
        match vector.kind.as_str() {
            "create" => {
                let input: ItemCreateInput = serde_json::from_value(vector.input.clone()).unwrap();
                let actual = normalize_item_create(&input);
                let actual_value = serde_json::to_value(&actual).unwrap();
                let mut expected = vector.expected.clone();
                apply_actual_to_expected(&mut expected, &actual_value);
                let want: ItemCreatePayload = serde_json::from_value(expected).unwrap();
                assert_eq!(actual, want, "vector {} failed", vector.name);
            }
            "update" => {
                let input: ItemUpdateInput = serde_json::from_value(vector.input.clone()).unwrap();
                let known_entry_ids = vector.known_entry_ids.clone().unwrap_or_default();
                let current_star = vector.current_star.as_deref();
                let actual = normalize_item_update(&input, &known_entry_ids, current_star);
                let actual_value = serde_json::to_value(&actual).unwrap();
                let mut expected = vector.expected.clone();
                apply_actual_to_expected(&mut expected, &actual_value);
                let want: ItemUpdatePayload = serde_json::from_value(expected).unwrap();
                assert_eq!(actual, want, "vector {} failed", vector.name);
            }
            other => panic!("unknown vector kind {other:?} in {}", vector.name),
        }
    }
}
