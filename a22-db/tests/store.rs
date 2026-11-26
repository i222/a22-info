//! Integration tests for the SQLite store and its schema invariants.

use std::path::PathBuf;

use a22_db::{
    DatabaseSnapshot, DateTimeEntry, DbData, DbError, InfoEntry, Item, ItemLink, ItemTimerLink, SnapshotEncoding, Store, Timer, TimerIntervalUnit, TimerSchedule, SCHEMA_VERSION,
};

fn entry(id: &str, label: &str, value: &str) -> InfoEntry {
    InfoEntry { id: id.to_string(), label: label.to_string(), value: value.to_string() }
}

/// Rich fixture: duplicate labels on purpose, starred entry, schedule pair,
/// links in both directions, a timer link and a snapshot.
fn fixture() -> DbData {
    let item_a = Item {
        id: "item-a".to_string(),
        main_info_entry_id: Some("entry-a2".to_string()),
        tags: vec!["contact".to_string(), "serbia".to_string()],
        info_entries: vec![
            entry("entry-a1", "description", "first description"),
            entry("entry-a2", "description", "second description (starred)"),
            entry("entry-a3", "email", "a@example.com"),
        ],
        date_time_entries: vec![DateTimeEntry { label: "meeting".to_string(), value: 1_750_000_000_000 }],
        created_at: "2026-08-01T10:00:00.000Z".to_string(),
        updated_at: "2026-08-02T11:30:00.000Z".to_string(),
    };
    let item_b = Item {
        id: "item-b".to_string(),
        main_info_entry_id: None,
        tags: vec!["finance".to_string()],
        info_entries: vec![entry("entry-b1", "title", "Invoice 42")],
        date_time_entries: vec![],
        created_at: "2026-08-03T09:00:00.000Z".to_string(),
        updated_at: "2026-08-03T09:00:00.000Z".to_string(),
    };
    let timer_1 = Timer {
        id: "timer-1".to_string(),
        name: "Pay rent".to_string(),
        base_at: "2026-08-20T00:00:00.000Z".to_string(),
        description: "monthly rent payment".to_string(),
        is_active: true,
        schedule: Some(TimerSchedule { every: 1, unit: TimerIntervalUnit::Months }),
        created_at: "2026-08-01T10:05:00.000Z".to_string(),
        updated_at: "2026-08-01T10:05:00.000Z".to_string(),
    };
    let timer_2 = Timer {
        id: "timer-2".to_string(),
        name: "One-off reminder".to_string(),
        base_at: "2026-09-01T15:30:00.000Z".to_string(),
        description: String::new(),
        is_active: false,
        schedule: None,
        created_at: "2026-08-04T12:00:00.000Z".to_string(),
        updated_at: "2026-08-04T12:00:00.000Z".to_string(),
    };
    let item_links = vec![
        ItemLink {
            id: "link-ab".to_string(),
            item_id: "item-a".to_string(),
            target_id: "item-b".to_string(),
            r#type: "related".to_string(),
            created_at: "2026-08-05T08:00:00.000Z".to_string(),
            updated_at: "2026-08-05T08:00:00.000Z".to_string(),
        },
        ItemLink {
            id: "link-ba".to_string(),
            item_id: "item-b".to_string(),
            target_id: "item-a".to_string(),
            r#type: "contact".to_string(),
            created_at: "2026-08-05T08:01:00.000Z".to_string(),
            updated_at: "2026-08-05T08:01:00.000Z".to_string(),
        },
    ];
    let item_timer_links = vec![ItemTimerLink {
        id: "itl-1".to_string(),
        item_id: "item-a".to_string(),
        timer_id: "timer-1".to_string(),
        last_checked_at: "2026-08-15T08:00:00.000Z".to_string(),
        created_at: "2026-08-01T10:06:00.000Z".to_string(),
        updated_at: "2026-08-15T08:00:00.000Z".to_string(),
    }];
    let snapshots = vec![DatabaseSnapshot {
        id: "snap-1".to_string(),
        created_at: "2026-08-10T00:00:00.000Z".to_string(),
        source_version: "1".to_string(),
        encoding: SnapshotEncoding::GzipBase64,
        payload: "H4sIAAAAAAAAA".to_string(),
        item_count: 2,
        timer_count: 2,
        item_link_count: 2,
        item_timer_link_count: 1,
    }];
    DbData { items: vec![item_a, item_b], timers: vec![timer_1, timer_2], item_links, item_timer_links, snapshots }
}

fn open_temp() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Store::open(dir.path().join("a22.db")).expect("open");
    (dir, store)
}

#[test]
fn fresh_open_creates_schema_v1() {
    let (dir, store) = open_temp();
    assert!(store.load_all().expect("load on empty db").snapshots.is_empty());
    let path: PathBuf = dir.path().join("a22.db");
    let conn_tables: Vec<String> = {
        use rusqlite::Connection;
        let conn = Connection::open(&path).unwrap();
        let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").unwrap();
        stmt.query_map([], |row| row.get::<_, String>(0)).unwrap().collect::<Result<_, _>>().unwrap()
    };
    for table in ["items", "item_tags", "item_info_entries", "item_date_time_entries", "timers", "item_links", "item_timer_links", "snapshots", "meta"] {
        assert!(conn_tables.iter().any(|name| name == table), "missing table {table}");
    }
    drop(store);
    // Re-open: migrations are idempotent.
    let _again = Store::open(&path).expect("re-open");
}

#[test]
fn replace_all_load_all_round_trip_is_lossless() {
    let (_dir, mut store) = open_temp();
    let mut data = fixture();
    // Snapshots are not part of replace_all (backups must survive imports) — seed one separately.
    let snapshot = data.snapshots.pop().expect("fixture snapshot");
    store.insert_snapshot(&snapshot).expect("insert snapshot");
    store.replace_all(&data).expect("replace_all");
    let mut expected = data;
    expected.snapshots = vec![snapshot];
    assert_eq!(store.load_all().expect("load"), expected);
}

#[test]
fn entity_upsert_and_delete_round_trips() {
    let (_dir, mut store) = open_temp();
    let mut data = fixture();
    let snapshot = data.snapshots.pop().expect("fixture snapshot");
    store.replace_all(&data).expect("seed");
    store.insert_snapshot(&snapshot).expect("insert snapshot");
    data.snapshots.push(snapshot);

    // Upsert a new item with children and a star.
    let new_item = Item {
        id: "item-c".to_string(),
        main_info_entry_id: Some("entry-c1".to_string()),
        tags: vec!["russia".to_string()],
        info_entries: vec![entry("entry-c1", "title", "New contact")],
        date_time_entries: vec![],
        created_at: "2026-08-10T00:00:00.000Z".to_string(),
        updated_at: "2026-08-10T00:00:00.000Z".to_string(),
    };
    store.upsert_item(&new_item).expect("upsert item");
    let new_timer = Timer {
        id: "timer-3".to_string(),
        name: "t3".to_string(),
        base_at: "2026-10-01T09:00:00.000Z".to_string(),
        description: String::new(),
        is_active: true,
        schedule: None,
        created_at: "2026-08-10T00:01:00.000Z".to_string(),
        updated_at: "2026-08-10T00:01:00.000Z".to_string(),
    };
    store.upsert_timer(&new_timer).expect("upsert timer");
    let new_link = ItemLink {
        id: "link-cb".to_string(),
        item_id: "item-c".to_string(),
        target_id: "item-b".to_string(),
        r#type: "related".to_string(),
        created_at: "2026-08-10T00:02:00.000Z".to_string(),
        updated_at: "2026-08-10T00:02:00.000Z".to_string(),
    };
    store.upsert_item_link(&new_link).expect("upsert link");
    let new_itl = ItemTimerLink {
        id: "itl-2".to_string(),
        item_id: "item-c".to_string(),
        timer_id: "timer-3".to_string(),
        last_checked_at: "1970-01-01T00:00:00.000Z".to_string(),
        created_at: "2026-08-10T00:03:00.000Z".to_string(),
        updated_at: "2026-08-10T00:03:00.000Z".to_string(),
    };
    store.upsert_item_timer_link(&new_itl).expect("upsert itl");

    data.items.push(new_item.clone());
    data.timers.push(new_timer.clone());
    data.item_links.push(new_link.clone());
    data.item_timer_links.push(new_itl.clone());
    assert_eq!(store.load_all().expect("load"), data);

    // Targeted deletes.
    store.delete_item_link("link-cb").expect("del link");
    store.delete_item_timer_link("itl-2").expect("del itl");
    data.item_links.pop();
    data.item_timer_links.pop();
    assert_eq!(store.load_all().expect("load"), data);

    // delete_timer cascades to its timer links.
    store.delete_timer("timer-3").expect("del timer");
    data.timers.retain(|t| t.id != "timer-3");
    assert_eq!(store.load_all().expect("load"), data);

    // delete_item cascades: children, both link directions, timer links (Q1).
    store.delete_item("item-a").expect("del item");
    data.items.retain(|i| i.id != "item-a");
    data.item_links.retain(|l| l.item_id != "item-a" && l.target_id != "item-a");
    data.item_timer_links.retain(|l| l.item_id != "item-a");
    assert_eq!(store.load_all().expect("load"), data);
}

#[test]
fn child_ordering_and_duplicate_labels_are_preserved() {
    let (_dir, mut store) = open_temp();
    let item = Item {
        id: "item-x".to_string(),
        main_info_entry_id: None,
        tags: vec!["zeta".to_string(), "alpha".to_string(), "mid".to_string()], // unsorted on purpose
        info_entries: vec![entry("e1", "description", "one"), entry("e2", "description", "two"), entry("e3", "fat", "boxed")],
        date_time_entries: vec![DateTimeEntry { label: "d2".to_string(), value: 200 }, DateTimeEntry { label: "d1".to_string(), value: 100 }],
        created_at: "2026-08-01T00:00:00.000Z".to_string(),
        updated_at: "2026-08-01T00:00:00.000Z".to_string(),
    };
    store.upsert_item(&item).expect("upsert");
    let loaded = store.load_all().expect("load").items;
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].tags, vec!["zeta", "alpha", "mid"]);
    assert_eq!(loaded[0].info_entries, item.info_entries); // duplicate labels intact, in order
    assert_eq!(loaded[0].date_time_entries, item.date_time_entries);
}

#[test]
fn star_cleared_when_starred_entry_removed() {
    let (_dir, mut store) = open_temp();
    let mut item = Item {
        id: "item-s".to_string(),
        main_info_entry_id: Some("es1".to_string()),
        tags: vec![],
        info_entries: vec![entry("es1", "title", "starred"), entry("es2", "description", "other")],
        date_time_entries: vec![],
        created_at: "2026-08-01T00:00:00.000Z".to_string(),
        updated_at: "2026-08-01T00:00:00.000Z".to_string(),
    };
    store.upsert_item(&item).expect("upsert");
    assert_eq!(store.load_all().expect("load").items[0].main_info_entry_id.as_deref(), Some("es1"));

    // Save without the starred entry (and without a star) → FK SET NULL path.
    item.info_entries = vec![entry("es2", "description", "other")];
    item.main_info_entry_id = None;
    store.upsert_item(&item).expect("upsert");
    assert_eq!(store.load_all().expect("load").items[0].main_info_entry_id, None);

    // Star pointing at a missing entry is rejected (FK), not silently stored.
    item.main_info_entry_id = Some("ghost".to_string());
    let err = store.upsert_item(&item).expect_err("fk violation expected");
    assert!(matches!(err, DbError::Sqlite(_)), "expected sqlite FK error, got {err:?}");
}

#[test]
fn replace_all_is_atomic_on_fk_failure() {
    let (_dir, mut store) = open_temp();
    let mut original = fixture();
    let snapshot = original.snapshots.pop().expect("fixture snapshot");
    store.replace_all(&original).expect("seed");
    store.insert_snapshot(&snapshot).expect("insert snapshot");
    original.snapshots.push(snapshot);

    let mut corrupt = original.clone();
    corrupt.item_timer_links[0].timer_id = "missing-timer".to_string();
    let err = store.replace_all(&corrupt).expect_err("fk violation expected");
    assert!(matches!(err, DbError::Sqlite(_)), "expected sqlite FK error, got {err:?}");

    // Previous data fully intact after the failed transaction.
    assert_eq!(store.load_all().expect("load"), original);
}

#[test]
fn constraint_violations_are_rejected() {
    let (_dir, mut store) = open_temp();
    let mut data = fixture();
    // replace_all does not persist snapshots; nothing to seed here.
    data.snapshots.clear();
    store.replace_all(&data).expect("seed");

    // Self-link (CHECK item_id <> target_id).
    let self_link = ItemLink {
        id: "link-self".to_string(),
        item_id: "item-a".to_string(),
        target_id: "item-a".to_string(),
        r#type: "related".to_string(),
        created_at: "2026-08-11T00:00:00.000Z".to_string(),
        updated_at: "2026-08-11T00:00:00.000Z".to_string(),
    };
    assert!(store.upsert_item_link(&self_link).is_err());

    // Duplicate relationship triple (UNIQUE item_id, target_id, type).
    let dup = ItemLink {
        id: "link-dup".to_string(),
        item_id: "item-a".to_string(),
        target_id: "item-b".to_string(),
        r#type: "related".to_string(),
        created_at: "2026-08-11T00:01:00.000Z".to_string(),
        updated_at: "2026-08-11T00:01:00.000Z".to_string(),
    };
    assert!(store.upsert_item_link(&dup).is_err());

    // Orphan FK (unknown item).
    let orphan = ItemLink {
        id: "link-orphan".to_string(),
        item_id: "ghost".to_string(),
        target_id: "item-b".to_string(),
        r#type: "related".to_string(),
        created_at: "2026-08-11T00:02:00.000Z".to_string(),
        updated_at: "2026-08-11T00:02:00.000Z".to_string(),
    };
    assert!(store.upsert_item_link(&orphan).is_err());

    // Negative date-time value (CHECK value >= 0).
    let bad_dt = Item {
        id: "item-dt".to_string(),
        main_info_entry_id: None,
        tags: vec![],
        info_entries: vec![entry("edt1", "title", "x")],
        date_time_entries: vec![DateTimeEntry { label: "bad".to_string(), value: -5 }],
        created_at: "2026-08-11T00:03:00.000Z".to_string(),
        updated_at: "2026-08-11T00:03:00.000Z".to_string(),
    };
    assert!(store.upsert_item(&bad_dt).is_err());

    // Duplicate tag on one item (UNIQUE item_id, tag).
    let dup_tag = Item {
        id: "item-dt".to_string(),
        main_info_entry_id: None,
        tags: vec!["same".to_string(), "same".to_string()],
        info_entries: vec![entry("edt2", "title", "x")],
        date_time_entries: vec![],
        created_at: "2026-08-11T00:04:00.000Z".to_string(),
        updated_at: "2026-08-11T00:04:00.000Z".to_string(),
    };
    assert!(store.upsert_item(&dup_tag).is_err());

    // Nothing was written by the rejected ops.
    assert_eq!(store.load_all().expect("load"), data);
}

#[test]
fn migrations_are_idempotent_and_version_guarded() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path: PathBuf = dir.path().join("a22.db");
    Store::open(&path).expect("open");
    drop(Store::open(&path).expect("re-open"));

    // Simulate a database from the future.
    {
        use rusqlite::Connection;
        let conn = Connection::open(&path).expect("raw open");
        conn.execute("UPDATE meta SET value = '99' WHERE key = 'schema_version'", []).expect("bump version");
    }
    let err = Store::open(&path).expect_err("newer schema must be refused");
    assert!(matches!(err, DbError::Migration(_)), "expected migration error, got {err:?}");
    assert_eq!(SCHEMA_VERSION, 1);
}

#[test]
fn foreign_keys_are_enabled() {
    let (_dir, store) = open_temp();
    // A FK violation must be rejected — proves foreign_keys=ON on this connection.
    let orphan = ItemTimerLink {
        id: "itl-x".to_string(),
        item_id: "ghost".to_string(),
        timer_id: "ghost-timer".to_string(),
        last_checked_at: "1970-01-01T00:00:00.000Z".to_string(),
        created_at: "2026-08-12T00:00:00.000Z".to_string(),
        updated_at: "2026-08-12T00:00:00.000Z".to_string(),
    };
    assert!(store.upsert_item_timer_link(&orphan).is_err());
}
