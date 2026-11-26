//! Schema v1 and the forward-only migration runner (`docs/db-design.md` §3, §6).

use rusqlite::Connection;

use crate::error::{DbError, Result};

/// The newest schema version this code knows how to apply.
pub const SCHEMA_VERSION: i64 = 1;

/// v1 DDL from `docs/db-design.md` §3. The `meta` table itself is bootstrapped
/// by [`migrate`] (idempotently) before the version is read, so it is not
/// re-created here.
const MIGRATION_V1: &str = r#"
CREATE TABLE items (
  id                 TEXT PRIMARY KEY,
  main_info_entry_id TEXT REFERENCES item_info_entries(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE item_tags (
  item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag      TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (item_id, position),
  UNIQUE (item_id, tag)
);

CREATE TABLE item_info_entries (
  id       TEXT PRIMARY KEY,
  item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  value    TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (item_id, position)
);

CREATE TABLE item_date_time_entries (
  item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  value    INTEGER NOT NULL CHECK (value >= 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (item_id, position)
);

CREATE TABLE timers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  base_at        TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  is_active      INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  schedule_every INTEGER CHECK (schedule_every IS NULL OR schedule_every > 0),
  schedule_unit  TEXT CHECK (schedule_unit IS NULL OR schedule_unit IN ('hours', 'days', 'weeks', 'months', 'years')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  CHECK ((schedule_every IS NULL) = (schedule_unit IS NULL))
);

CREATE TABLE item_links (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  target_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (item_id, target_id, type),
  CHECK (item_id <> target_id)
);

CREATE TABLE item_timer_links (
  id              TEXT PRIMARY KEY,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  timer_id        TEXT NOT NULL REFERENCES timers(id) ON DELETE CASCADE,
  last_checked_at TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (item_id, timer_id)
);

CREATE TABLE snapshots (
  id                    TEXT PRIMARY KEY,
  created_at            TEXT NOT NULL,
  source_version        TEXT NOT NULL,
  encoding              TEXT NOT NULL CHECK (encoding IN ('gzip-base64', 'plain')),
  payload               TEXT NOT NULL,
  item_count            INTEGER NOT NULL CHECK (item_count >= 0),
  timer_count           INTEGER NOT NULL CHECK (timer_count >= 0),
  item_link_count       INTEGER NOT NULL CHECK (item_link_count >= 0),
  item_timer_link_count INTEGER NOT NULL CHECK (item_timer_link_count >= 0)
);

CREATE INDEX idx_items_updated_at       ON items (updated_at);
CREATE INDEX idx_items_created_at       ON items (created_at);
CREATE INDEX idx_item_tags_tag          ON item_tags (tag);
CREATE INDEX idx_item_links_target      ON item_links (target_id);
CREATE INDEX idx_item_timer_links_timer ON item_timer_links (timer_id);
CREATE INDEX idx_snapshots_created_at   ON snapshots (created_at);

INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1');
"#;

/// Applies pending migrations to an already-open connection. Forward-only: a
/// database newer than [`SCHEMA_VERSION`] is refused, never downgraded.
pub fn migrate(conn: &mut Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);")?;
    let current = read_version(conn)?;
    if current > SCHEMA_VERSION {
        return Err(DbError::Migration(format!("database schema version {current} is newer than the supported version {SCHEMA_VERSION}; refusing to open")));
    }
    let mut version = current;
    while version < SCHEMA_VERSION {
        version += 1;
        let sql = match version {
            1 => MIGRATION_V1,
            _ => unreachable!("migration loop is bounded by SCHEMA_VERSION"),
        };
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.commit()?;
    }
    Ok(())
}

fn read_version(conn: &Connection) -> Result<i64> {
    let raw: Option<String> = conn.query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |row| row.get(0)).ok();
    Ok(raw.and_then(|value| value.parse().ok()).unwrap_or(0))
}
