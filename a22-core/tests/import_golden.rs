//! Golden-vector tests for the supported JSON import contract.
//!
//! Each vector carries the raw file text plus the expected validated dataset
//! (or `{"rejected": true}` for unsupported formats). The harness pins the TS
//! fallback clock at 2026-08-16T12:00:00.000Z, so the parser gets it as an
//! explicit `now`. `$uuid:<n>` markers stand for minted ids (same convention
//! as `normalize.json`).

use std::fs;

use a22_core::import_export::{parse_import_file, ImportError};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use uuid::Uuid;

const NOW_ISO: &str = "2026-08-16T12:00:00.000Z";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    name: String,
    raw_json: String,
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

/// `null` and absent are equivalent for the optional fields of this data model
/// (serde deserializes both to `None`); normalize before comparing.
fn strip_nulls(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(fields) => {
            let null_keys: Vec<String> = fields.keys().filter(|key| matches!(fields.get(key.as_str()), Some(value) if value.is_null())).cloned().collect();
            for key in &null_keys {
                fields.remove(key);
            }
            for field in fields.values_mut() {
                strip_nulls(field);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items.iter_mut() {
                strip_nulls(item);
            }
        }
        _ => {}
    }
}

#[test]
fn golden_import() {
    let raw = fs::read_to_string("tests/golden/import.json").expect("read tests/golden/import.json");
    let vectors: Vec<Vector> = serde_json::from_str(&raw).expect("parse import.json");
    assert!(!vectors.is_empty());

    let now: DateTime<Utc> = DateTime::parse_from_rfc3339(NOW_ISO).expect("valid now").with_timezone(&Utc);

    for vector in &vectors {
        if vector.expected.get("rejected") == Some(&serde_json::json!(true)) {
            let parsed = parse_import_file(&vector.raw_json, now);
            assert!(matches!(parsed, Err(ImportError::UnsupportedVersion)), "vector {} must be rejected", vector.name);
            continue;
        }

        let data = parse_import_file(&vector.raw_json, now).unwrap_or_else(|error| panic!("vector {} failed to parse: {error}", vector.name));
        let actual = serde_json::json!({
            "items": data.items,
            "timers": data.timers,
            "itemLinks": data.item_links,
            "itemTimerLinks": data.item_timer_links,
            "errors": data.warnings,
        });

        let mut expected = vector.expected.clone();
        apply_actual_to_expected(&mut expected, &actual);
        strip_nulls(&mut expected);
        let mut actual = actual;
        strip_nulls(&mut actual);
        assert_eq!(expected, actual, "vector {} failed", vector.name);
    }
}
