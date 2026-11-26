//! The SQLite store: open/migrate, load, and entity-level persistence ops
//! (`docs/db-design.md` §6). All row ↔ domain mapping follows the round-trip
//! table in §5.
//!
//! FK-safe write ordering: `items.main_info_entry_id` references
//! `item_info_entries(id)` while entries reference back to `items`, so item
//! writes insert/refresh the item row first (star unset), replace the child
//! rows, and only then point the star at an entry that exists.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, Connection};

use crate::error::{DbError, Result};
use crate::schema;
use crate::types::{DatabaseSnapshot, DateTimeEntry, DbData, InfoEntry, Item, ItemLink, ItemTimerLink, SnapshotEncoding, Timer, TimerIntervalUnit, TimerSchedule};

/// A single-connection handle to the a22 database. Mutating ops take `&mut self`
/// (rusqlite transactions require it); keep the store behind the app's state
/// mutex (see `a22-app`).
/// Raw timer row before schedule-pair validation.
struct TimerRow {
    id: String,
    name: String,
    base_at: String,
    description: String,
    is_active: i64,
    schedule_every: Option<i64>,
    schedule_unit: Option<String>,
    created_at: String,
    updated_at: String,
}

/// Raw snapshot row before encoding validation.
struct SnapshotRow {
    id: String,
    created_at: String,
    source_version: String,
    encoding: String,
    payload: String,
    item_count: i64,
    timer_count: i64,
    item_link_count: i64,
    item_timer_link_count: i64,
}

#[derive(Debug)]
pub struct Store {
    conn: Connection,
}

impl Store {
    /// Opens (creating if needed) the database at `path`, sets WAL mode and
    /// foreign keys, and runs pending migrations.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        schema::migrate(&mut conn)?;
        Ok(Self { conn })
    }

    /// Loads the full dataset (the app keeps it in memory — design doc §1).
    pub fn load_all(&self) -> Result<DbData> {
        let item_rows: Vec<(String, Option<String>, String, String)> =
            self.query("SELECT id, main_info_entry_id, created_at, updated_at FROM items ORDER BY rowid", |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?;

        let mut tags_by_item: HashMap<String, Vec<String>> = HashMap::new();
        for (item_id, tag) in self.query("SELECT item_id, tag FROM item_tags ORDER BY item_id, position", |row| Ok((row.get(0)?, row.get(1)?)))? {
            tags_by_item.entry(item_id).or_default().push(tag);
        }

        let mut info_by_item: HashMap<String, Vec<InfoEntry>> = HashMap::new();
        for (item_id, id, label, value) in
            self.query("SELECT item_id, id, label, value FROM item_info_entries ORDER BY item_id, position", |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
        {
            info_by_item.entry(item_id).or_default().push(InfoEntry { id, label, value });
        }

        let mut dt_by_item: HashMap<String, Vec<DateTimeEntry>> = HashMap::new();
        for (item_id, label, value) in
            self.query("SELECT item_id, label, value FROM item_date_time_entries ORDER BY item_id, position", |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        {
            dt_by_item.entry(item_id).or_default().push(DateTimeEntry { label, value });
        }

        let items = item_rows
            .into_iter()
            .map(|(id, main_info_entry_id, created_at, updated_at)| Item {
                id: id.clone(),
                main_info_entry_id,
                tags: tags_by_item.remove(&id).unwrap_or_default(),
                info_entries: info_by_item.remove(&id).unwrap_or_default(),
                date_time_entries: dt_by_item.remove(&id).unwrap_or_default(),
                created_at,
                updated_at,
            })
            .collect();

        let timer_rows =
            self.query("SELECT id, name, base_at, description, is_active, schedule_every, schedule_unit, created_at, updated_at FROM timers ORDER BY rowid", |row| {
                Ok(TimerRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    base_at: row.get(2)?,
                    description: row.get(3)?,
                    is_active: row.get(4)?,
                    schedule_every: row.get(5)?,
                    schedule_unit: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?;
        let timers = timer_rows
            .into_iter()
            .map(|row| {
                let schedule = match (row.schedule_every, row.schedule_unit) {
                    (Some(every), Some(unit)) => Some(TimerSchedule {
                        every,
                        unit: TimerIntervalUnit::parse(&unit).ok_or_else(|| DbError::Integrity(format!("timer {}: unknown schedule unit {:?}", row.id, unit)))?,
                    }),
                    (None, None) => None,
                    other => return Err(DbError::Integrity(format!("timer {}: half-set schedule columns {:?}", row.id, other))),
                };
                Ok(Timer {
                    id: row.id,
                    name: row.name,
                    base_at: row.base_at,
                    description: row.description,
                    is_active: row.is_active != 0,
                    schedule,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                })
            })
            .collect::<Result<Vec<_>>>()?;

        let item_links = self.query("SELECT id, item_id, target_id, type, created_at, updated_at FROM item_links ORDER BY rowid", |row| {
            Ok(ItemLink { id: row.get(0)?, item_id: row.get(1)?, target_id: row.get(2)?, r#type: row.get(3)?, created_at: row.get(4)?, updated_at: row.get(5)? })
        })?;

        let item_timer_links = self.query("SELECT id, item_id, timer_id, last_checked_at, created_at, updated_at FROM item_timer_links ORDER BY rowid", |row| {
            Ok(ItemTimerLink { id: row.get(0)?, item_id: row.get(1)?, timer_id: row.get(2)?, last_checked_at: row.get(3)?, created_at: row.get(4)?, updated_at: row.get(5)? })
        })?;

        let snapshot_rows = self.query(
            "SELECT id, created_at, source_version, encoding, payload, item_count, timer_count, item_link_count, item_timer_link_count FROM snapshots ORDER BY rowid",
            |row| {
                Ok(SnapshotRow {
                    id: row.get(0)?,
                    created_at: row.get(1)?,
                    source_version: row.get(2)?,
                    encoding: row.get(3)?,
                    payload: row.get(4)?,
                    item_count: row.get(5)?,
                    timer_count: row.get(6)?,
                    item_link_count: row.get(7)?,
                    item_timer_link_count: row.get(8)?,
                })
            },
        )?;
        let snapshots = snapshot_rows
            .into_iter()
            .map(|row| {
                Ok(DatabaseSnapshot {
                    id: row.id.clone(),
                    created_at: row.created_at,
                    source_version: row.source_version,
                    encoding: SnapshotEncoding::parse(&row.encoding).ok_or_else(|| DbError::Integrity(format!("snapshot {}: unknown encoding {:?}", row.id, row.encoding)))?,
                    payload: row.payload,
                    item_count: row.item_count,
                    timer_count: row.timer_count,
                    item_link_count: row.item_link_count,
                    item_timer_link_count: row.item_timer_link_count,
                })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(DbData { items, timers, item_links, item_timer_links, snapshots })
    }

    /// Inserts or replaces an item with its ordered child collections in one
    /// transaction (FK-safe ordering — see module docs).
    pub fn upsert_item(&mut self, item: &Item) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO items (id, main_info_entry_id, created_at, updated_at) VALUES (?1, NULL, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at",
            params![item.id, item.created_at, item.updated_at],
        )?;
        tx.execute("DELETE FROM item_tags WHERE item_id = ?1", params![item.id])?;
        tx.execute("DELETE FROM item_info_entries WHERE item_id = ?1", params![item.id])?;
        tx.execute("DELETE FROM item_date_time_entries WHERE item_id = ?1", params![item.id])?;
        for (position, tag) in item.tags.iter().enumerate() {
            tx.execute("INSERT INTO item_tags (item_id, tag, position) VALUES (?1, ?2, ?3)", params![item.id, tag, position as i64])?;
        }
        for (position, entry) in item.info_entries.iter().enumerate() {
            tx.execute(
                "INSERT INTO item_info_entries (id, item_id, label, value, position) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![entry.id, item.id, entry.label, entry.value, position as i64],
            )?;
        }
        for (position, entry) in item.date_time_entries.iter().enumerate() {
            tx.execute(
                "INSERT INTO item_date_time_entries (item_id, label, value, position) VALUES (?1, ?2, ?3, ?4)",
                params![item.id, entry.label, entry.value, position as i64],
            )?;
        }
        if let Some(entry_id) = &item.main_info_entry_id {
            tx.execute("UPDATE items SET main_info_entry_id = ?1 WHERE id = ?2", params![entry_id, item.id])?;
        } else {
            tx.execute("UPDATE items SET main_info_entry_id = NULL WHERE id = ?1", params![item.id])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Deletes an item; FK cascades remove its child rows, relationships (both
    /// directions) and timer links in the same statement.
    pub fn delete_item(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM items WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn upsert_timer(&self, timer: &Timer) -> Result<()> {
        let (schedule_every, schedule_unit): (Option<i64>, Option<&str>) = match timer.schedule {
            Some(schedule) => (Some(schedule.every), Some(schedule.unit.as_str())),
            None => (None, None),
        };
        self.conn.execute(
            "INSERT INTO timers (id, name, base_at, description, is_active, schedule_every, schedule_unit, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name, base_at = excluded.base_at, description = excluded.description,
               is_active = excluded.is_active, schedule_every = excluded.schedule_every,
               schedule_unit = excluded.schedule_unit, updated_at = excluded.updated_at",
            params![timer.id, timer.name, timer.base_at, timer.description, timer.is_active as i64, schedule_every, schedule_unit, timer.created_at, timer.updated_at],
        )?;
        Ok(())
    }

    /// Deletes a timer; FK cascade removes its item links.
    pub fn delete_timer(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM timers WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn upsert_item_link(&self, link: &ItemLink) -> Result<()> {
        self.conn.execute(
            "INSERT INTO item_links (id, item_id, target_id, type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               item_id = excluded.item_id, target_id = excluded.target_id,
               type = excluded.type, updated_at = excluded.updated_at",
            params![link.id, link.item_id, link.target_id, link.r#type, link.created_at, link.updated_at],
        )?;
        Ok(())
    }

    pub fn delete_item_link(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM item_links WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Removes only the outgoing links of an item (the Q2-fix semantics live in `a22-core`).
    pub fn delete_item_links_outgoing(&self, item_id: &str) -> Result<usize> {
        Ok(self.conn.execute("DELETE FROM item_links WHERE item_id = ?1", params![item_id])?)
    }

    pub fn upsert_item_timer_link(&self, link: &ItemTimerLink) -> Result<()> {
        self.conn.execute(
            "INSERT INTO item_timer_links (id, item_id, timer_id, last_checked_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               last_checked_at = excluded.last_checked_at, updated_at = excluded.updated_at",
            params![link.id, link.item_id, link.timer_id, link.last_checked_at, link.created_at, link.updated_at],
        )?;
        Ok(())
    }

    pub fn delete_item_timer_link(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM item_timer_links WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn insert_snapshot(&self, snapshot: &DatabaseSnapshot) -> Result<()> {
        self.conn.execute(
            "INSERT INTO snapshots (id, created_at, source_version, encoding, payload, item_count, timer_count, item_link_count, item_timer_link_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               created_at = excluded.created_at, source_version = excluded.source_version, encoding = excluded.encoding,
               payload = excluded.payload, item_count = excluded.item_count, timer_count = excluded.timer_count,
               item_link_count = excluded.item_link_count, item_timer_link_count = excluded.item_timer_link_count",
            params![
                snapshot.id,
                snapshot.created_at,
                snapshot.source_version,
                snapshot.encoding.as_str(),
                snapshot.payload,
                snapshot.item_count,
                snapshot.timer_count,
                snapshot.item_link_count,
                snapshot.item_timer_link_count
            ],
        )?;
        Ok(())
    }

    /// Import path: wipes the four data tables and bulk-inserts `data` in one
    /// transaction. Snapshots are intentionally not touched (pre-import backups
    /// must survive imports).
    pub fn replace_all(&mut self, data: &DbData) -> Result<()> {
        let tx = self.conn.transaction()?;
        // Wipe in FK-safe order (children first).
        tx.execute_batch(
            "DELETE FROM item_timer_links;
             DELETE FROM item_links;
             DELETE FROM item_info_entries;
             DELETE FROM item_date_time_entries;
             DELETE FROM item_tags;
             DELETE FROM timers;
             DELETE FROM items;",
        )?;
        // Insert in FK-safe order; stars are set after their entries exist.
        for item in &data.items {
            tx.execute("INSERT INTO items (id, main_info_entry_id, created_at, updated_at) VALUES (?1, NULL, ?2, ?3)", params![item.id, item.created_at, item.updated_at])?;
        }
        for item in &data.items {
            for (position, tag) in item.tags.iter().enumerate() {
                tx.execute("INSERT INTO item_tags (item_id, tag, position) VALUES (?1, ?2, ?3)", params![item.id, tag, position as i64])?;
            }
            for (position, entry) in item.info_entries.iter().enumerate() {
                tx.execute(
                    "INSERT INTO item_info_entries (id, item_id, label, value, position) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![entry.id, item.id, entry.label, entry.value, position as i64],
                )?;
            }
            for (position, entry) in item.date_time_entries.iter().enumerate() {
                tx.execute(
                    "INSERT INTO item_date_time_entries (item_id, label, value, position) VALUES (?1, ?2, ?3, ?4)",
                    params![item.id, entry.label, entry.value, position as i64],
                )?;
            }
        }
        for item in &data.items {
            if let Some(entry_id) = &item.main_info_entry_id {
                tx.execute("UPDATE items SET main_info_entry_id = ?1 WHERE id = ?2", params![entry_id, item.id])?;
            }
        }
        for timer in &data.timers {
            let (schedule_every, schedule_unit): (Option<i64>, Option<&str>) = match timer.schedule {
                Some(schedule) => (Some(schedule.every), Some(schedule.unit.as_str())),
                None => (None, None),
            };
            tx.execute(
                "INSERT INTO timers (id, name, base_at, description, is_active, schedule_every, schedule_unit, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![timer.id, timer.name, timer.base_at, timer.description, timer.is_active as i64, schedule_every, schedule_unit, timer.created_at, timer.updated_at],
            )?;
        }
        for link in &data.item_links {
            tx.execute(
                "INSERT INTO item_links (id, item_id, target_id, type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![link.id, link.item_id, link.target_id, link.r#type, link.created_at, link.updated_at],
            )?;
        }
        for link in &data.item_timer_links {
            tx.execute(
                "INSERT INTO item_timer_links (id, item_id, timer_id, last_checked_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![link.id, link.item_id, link.timer_id, link.last_checked_at, link.created_at, link.updated_at],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    fn query<T, F>(&self, sql: &str, map_row: F) -> Result<Vec<T>>
    where
        T: Send + 'static,
        F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T> + 'static,
    {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([], map_row)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}
