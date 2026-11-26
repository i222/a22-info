# SQLite Database Design (`a22-db`)

This document is the current persistence contract for A22. SQLite is used through
`rusqlite` with bundled SQLite. Data is carried over through the supported JSON
import/export flow; there is no in-place migration from another storage engine.
The `a22-db` crate implements this schema and the application layers depend on it.

The contract is derived from the current domain types in
`a22-ui-core/src/models/item/types.ts` and the Rust mirror in `a22-db/src/types.rs`.

## 1. Design principles

1. **Lossless round-trip with the v1 JSON format.** Every domain object must map to rows
   and back without losing or reordering data — export/import compatibility is a hard
   requirement (it is also the official data carry-over path).
2. **Normalize where the domain is relational.** 1:N collections and M:N links become
   real tables with foreign keys; invariants the app already guarantees become SQL
   constraints, so illegal states are unrepresentable.
3. **Identity only where the domain references it.** Tags and date-time entries have no
   identity in the domain → keyed by `(item_id, position)`, where `position` preserves
   array order. Info entries **do** get ids (UUIDv4), because the item's starred field now
   points at a specific entry — see §10.
4. **1:1 optional sub-entities stay as columns.** `Timer.schedule` is a nullable column
   pair on `timers`, not a separate table (fixed shape, no identity, no queries against it).
5. **Opaque payloads stay opaque.** Snapshot payloads are base64 strings — one TEXT
   column, no structure inside.
6. **Timestamps are TEXT ISO-8601 UTC** (`2026-08-15T12:34:56.789Z`, i.e. JS
   `toISOString()` output). Rationale: exact round-trip with existing JSON data, no
   timezone conversion at the boundary, and lexicographic order == chronological order for
   this fixed format. (Alternative considered: INTEGER unix-ms — rejected because it
   forces conversion at every boundary and still stores the same precision.)
7. **IDs are TEXT UUIDv4**, app-generated (Rust `uuid v4`), never autoincrement — the JSON
   format carries ids, so the DB must accept them as-is.
8. **Booleans are INTEGER 0/1** with `CHECK IN (0, 1)` (SQLite has no bool type; rusqlite
   maps `bool` ↔ 0/1).
9. **Forward-only versioned migrations**, tracked in `meta.schema_version`, each applied in
   a transaction.

## 2. Domain model → schema analysis

| TS type | Shape | Decision | Rationale |
|---|---|---|---|
| `Item` (scalar fields) | entity with id | table `items` | root aggregate |
| `Item.tags: Tag[]` | ordered 1:N, no element identity | table `item_tags(item_id, tag, position)` | order is display order (normalization does not sort tags); `position` preserves it; no surrogate ids (principle 3) |
| `Item.infoEntries: InfoEntry[]` | ordered 1:N, **elements have identity** because the star points at an entry | table `item_info_entries(id, item_id, label, value, position)` | order matters for display and for the "first entry" fallback in `resolveDisplayInfoEntry`; duplicate labels are legal (normalization only drops empty ones) → no unique constraint on `label`; `id` = UUIDv4, stable across edits (§10) |
| `Item.dateTimeEntries: DateTimeEntry[]` | ordered 1:N, no element identity | table `item_date_time_entries(item_id, label, value INTEGER, position)` | same as info entries; `value` is Unix ms → native INTEGER (app floors it during normalization, so JSON number ↔ INTEGER is exact) |
| `Item.mainInfoEntryId?: string` (replaces `mainInfoField`) | **id of the starred entry** | nullable column on `items` with a **hard FK** to `item_info_entries(id)`, `ON DELETE SET NULL` | entries have ids, so the star is a real foreign key: deleting the starred entry auto-clears the star; Rust normalization still validates (unknown id → NULL) as defense in depth |
| `Timer` (scalar fields) | entity with id | table `timers` | — |
| `Timer.schedule?: TimerSchedule` | 1:1 optional, fixed shape `{ every: number, unit: enum }` | nullable column pair `schedule_every INTEGER`, `schedule_unit TEXT` on `timers` | principle 4; pair invariant enforced by CHECK (both set or both NULL) |
| `ItemLink` (relationships) | M:N self-referential link with id + type | table `item_links` | identity key in the app is `(itemId, targetId, type)` (idempotent create + dedupe keeps newest) → enforced as UNIQUE; self-links are dropped on import → `CHECK (item_id <> target_id)` |
| `ItemTimerLink` | link with id, per-item `lastCheckedAt` | table `item_timer_links` | app invariant "an item can be linked to a given timer at most once" → `UNIQUE(item_id, timer_id)` |
| `DatabaseSnapshot` | entity with opaque payload | table `snapshots` | payload = base64 (gzip or plain) → TEXT; encoding is a closed set → CHECK enum |
| schema bookkeeping | — | table `meta(key, value)` | `schema_version` row drives migrations |

Rejected alternatives:

- **JSON blob columns** (one row per item, nested arrays as JSON text): no referential
  integrity, no constraint enforcement, any query needs JSON functions. Rejected.
- **Surrogate ids for tags/date-time entries**: would create identity that is not used by
  the domain and break the v1 round-trip mapping. Info-entry ids are retained because
  the current v2 contract explicitly references them from the starred field.
- **Separate `tags` lookup table** (`tags(tag TEXT PRIMARY KEY)` + join): tags carry no
  attributes of their own, so a lookup table adds a join without enabling anything.
  Rejected — `item_tags.tag` is the tag's only representation.
- **FTS5 virtual tables for search**: the app loads the full dataset into memory and
  searches in Rust (personal-scale data). FTS would be a later optimization if the data
  grows; not part of v1.

## 3. Schema v1 (DDL)

```sql
PRAGMA journal_mode = WAL;          -- set once at open
PRAGMA foreign_keys = ON;           -- must be set on every connection

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('schema_version', '1');

CREATE TABLE items (
  id                 TEXT PRIMARY KEY,                    -- UUIDv4
  main_info_entry_id TEXT REFERENCES item_info_entries(id) ON DELETE SET NULL,  -- starred entry; NULL = none (forward FK ref — see note after DDL)
  created_at         TEXT NOT NULL,                       -- ISO-8601 UTC
  updated_at         TEXT NOT NULL                        -- ISO-8601 UTC
);

CREATE TABLE item_tags (
  item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag      TEXT NOT NULL,                                 -- normalized: trimmed, lowercase
  position INTEGER NOT NULL CHECK (position >= 0),        -- array order in Item.tags
  PRIMARY KEY (item_id, position),
  UNIQUE (item_id, tag)                                   -- normalization already dedupes; make it unbreakable
);

CREATE TABLE item_info_entries (
  id       TEXT PRIMARY KEY,                              -- UUIDv4; stable across edits (§10)
  item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,                                 -- non-empty after normalization
  value    TEXT NOT NULL,                                 -- non-empty after normalization
  position INTEGER NOT NULL CHECK (position >= 0),        -- array order in Item.infoEntries
  UNIQUE (item_id, position)                              -- duplicate labels are legal → no unique on label
);

CREATE TABLE item_date_time_entries (
  item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,                                 -- non-empty after normalization
  value    INTEGER NOT NULL CHECK (value >= 0),           -- Unix ms (normalized: floored, finite)
  position INTEGER NOT NULL CHECK (position >= 0),        -- array order in Item.dateTimeEntries
  PRIMARY KEY (item_id, position)
);

CREATE TABLE timers (
  id             TEXT PRIMARY KEY,                        -- UUIDv4
  name           TEXT NOT NULL,
  base_at        TEXT NOT NULL,                           -- ISO-8601 UTC; time part 00:00:00 = date-only
  description    TEXT NOT NULL DEFAULT '',
  is_active      INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  schedule_every INTEGER CHECK (schedule_every IS NULL OR schedule_every > 0),
  schedule_unit  TEXT CHECK (schedule_unit IS NULL OR schedule_unit IN ('hours', 'days', 'weeks', 'months', 'years')),
  created_at     TEXT NOT NULL,                           -- ISO-8601 UTC
  updated_at     TEXT NOT NULL,                           -- ISO-8601 UTC
  CHECK ((schedule_every IS NULL) = (schedule_unit IS NULL))   -- schedule is all-or-nothing
);

CREATE TABLE item_links (
  id         TEXT PRIMARY KEY,                            -- UUIDv4
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  target_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                               -- relationship type string
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (item_id, target_id, type),                      -- app identity key (idempotent create, dedupe keeps newest)
  CHECK (item_id <> target_id)                            -- self-links are invalid (import drops them)
);

CREATE TABLE item_timer_links (
  id              TEXT PRIMARY KEY,                       -- UUIDv4
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  timer_id        TEXT NOT NULL REFERENCES timers(id) ON DELETE CASCADE,
  last_checked_at TEXT NOT NULL,                          -- ISO-8601 UTC; epoch for imported rows without it
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (item_id, timer_id)                              -- an item links to a given timer at most once
);

CREATE TABLE snapshots (
  id                     TEXT PRIMARY KEY,                -- UUIDv4
  created_at             TEXT NOT NULL,                   -- ISO-8601 UTC
  source_version         TEXT NOT NULL,                   -- e.g. '1'
  encoding               TEXT NOT NULL CHECK (encoding IN ('gzip-base64', 'plain')),
  payload                TEXT NOT NULL,                   -- base64(gzip(JSON)) or plain JSON — opaque
  item_count             INTEGER NOT NULL CHECK (item_count >= 0),
  timer_count            INTEGER NOT NULL CHECK (timer_count >= 0),
  item_link_count        INTEGER NOT NULL CHECK (item_link_count >= 0),
  item_timer_link_count  INTEGER NOT NULL CHECK (item_timer_link_count >= 0)
);

Note: `items.main_info_entry_id` forward-references `item_info_entries` — SQLite resolves
foreign keys at runtime, so this creation order is valid; both tables exist before any DML.

CREATE INDEX idx_items_updated_at          ON items (updated_at);       -- list() sorts by updatedAt desc
CREATE INDEX idx_items_created_at          ON items (created_at);       -- UI sort toggle
CREATE INDEX idx_item_tags_tag             ON item_tags (tag);          -- tag-based lookups/filters
CREATE INDEX idx_item_links_target         ON item_links (target_id);   -- "connected from" (reverse) lookups; forward is covered by the UNIQUE prefix on item_id
CREATE INDEX idx_item_timer_links_timer    ON item_timer_links (timer_id); -- per-timer status / unlink-all-on-delete; forward covered by UNIQUE prefix
CREATE INDEX idx_snapshots_created_at      ON snapshots (created_at);
```

## 4. Invariants: app rule → DB enforcement

| App rule | Enforcement in schema v1 |
|---|---|
| Tags trimmed/lowercased/deduped, no empties | Rust normalization + `UNIQUE(item_id, tag)` |
| Info/DT entries: no empty label/value; DT value finite | Rust normalization + NOT NULL / `CHECK (value >= 0)` |
| Starred entry exists or the star is absent | **hard FK** `items.main_info_entry_id → item_info_entries(id)` with `ON DELETE SET NULL` + Rust normalization (unknown id → NULL) |
| One-time vs periodic timer (`schedule` optional) | all-or-nothing CHECK pair on `timers` |
| Relationship identity = `(itemId, targetId, type)`; duplicates collapse to newest | `UNIQUE(item_id, target_id, type)` + Rust upsert semantics |
| No self-relationships | `CHECK (item_id <> target_id)` |
| Item↔timer link at most once per pair | `UNIQUE(item_id, timer_id)` |
| Deleting an item removes its relationships and timer links (Q1 fix) | `ON DELETE CASCADE` on all child/link tables |
| Deleting a timer unlinks it from all items | `ON DELETE CASCADE` on `item_timer_links.timer_id` |
| Snapshot encoding is a closed set | CHECK enum |

Note: Q1/Q2 fixes live in the Rust state ops (which links are removed when); the DB only
guarantees referential integrity and key uniqueness.

## 5. Row ↔ JSON round-trip mapping

Lossless both directions; this is what `load_all` / import / export rely on.

| TS field | SQL | Notes |
|---|---|---|
| `Item.id/createdAt/updatedAt` | `items.id/created_at/updated_at` | verbatim strings |
| `Item.mainInfoEntryId` | `items.main_info_entry_id` | `undefined` ↔ NULL; FK `SET NULL` when the starred entry is deleted |
| `Item.tags[i]` | `item_tags` row, `position = i` | rows read back ordered by `position` |
| `Item.infoEntries[i].id/label/value` | `item_info_entries`, `position = i` | entry ids stable across edits; v1 import generates them (§10) |
| `Item.dateTimeEntries[i].label/value` | `item_date_time_entries`, `position = i` | `value`: JSON number ↔ INTEGER (exact — normalized values are floored integers) |
| `Timer.id/name/baseAt/description/createdAt/updatedAt` | `timers.*` | verbatim strings |
| `Timer.isActive` | `timers.is_active` | `true` ↔ 1, `false` ↔ 0 |
| `Timer.schedule` | `timers.schedule_every/schedule_unit` | `undefined` ↔ both NULL; `{every, unit}` ↔ both set |
| `ItemLink.*` / `ItemTimerLink.*` / `DatabaseSnapshot.*` | same-named columns | verbatim (camelCase ↔ snake_case) |

Ordering of collections without a domain order (`itemLinks`, `itemTimerLinks`) is not
meaningful to the app (dedupe keeps newest by `updatedAt`); load order may be any stable
order — use rowid for determinism in tests.

## 6. Operations layer (`a22-db` API)

- `Store::open(path)` — create parent dir if needed, open DB, set `journal_mode=WAL` and
  `foreign_keys=ON`, run migrations.
- Migrations: forward-only list `v1 → …`; runner reads `meta.schema_version`, applies each
  pending migration in its own transaction; a version higher than the code knows → hard
  error (no downgrades).
- `load_all() -> DbData { items, timers, item_links, item_timer_links, snapshots }` —
  assembles domain structs per §5 (child rows collected and sorted by `position`).
- Per-table entity ops: `upsert_item`, `delete_item`, `upsert_timer`, `delete_timer`,
  `upsert_item_link`, `delete_item_link(s)`, `upsert_item_timer_link`,
  `delete_item_timer_link(s)` — used by incremental mutations in `a22-core`.
- `replace_all(&DbData)` — single transaction: wipe the 4 data tables, bulk-insert the
  imported dataset (the import path). Snapshots are **not** wiped (pre-import backups must
  survive imports).
- `insert_snapshot(snapshot)`.
- Errors: `thiserror` enum (`Io`, `Sqlite`, `Integrity`, `Migration`) — `Integrity`
  guards stored values that violate an expected invariant (e.g. unknown enum); unreachable
  through the store API because of the CHECK constraints.

## 7. Operational details

- File: `<app_data_dir>/a22.db` (+ `-wal`/`-shm` sidecars), identifier `com.a22.app`.
- Single connection behind the app's `Mutex<AppState>` — no concurrent writers; WAL keeps
  reads safe and crash-recovery automatic.
- Backup strategy stays at the app level (pre-import snapshots in `snapshots`); SQLite's
  online `.backup` API is available later if file-level backups are ever wanted.
- `VACUUM`/autoincrement cleanup: not needed at personal scale; deferred.

## 8. Extension notes (not in v1)

- If the dataset grows large: push search/filter into SQL (+ FTS5 over info values),
  replace load-all with paged queries — the schema already supports it (indexes on
  `updated_at`, `tag`, link endpoints).
- Per-tag metadata (colors, ordering config) would introduce the `tags` lookup table.

## 9. Operation coverage (`a22-ui-core` → schema)

All data operations in `a22-ui-core` (store + services) were checked against the current
code; each maps onto v1:

| Operation (ui-core) | Mapping to v1 | Notes |
|---|---|---|
| `load()` (4 lists + 3 hint lists) | `load_all` + hints computed in Rust | single round-trip |
| item/timer/link CRUD | entity upserts/deletes | normalization applied first |
| `updateItem` with `relationships` present | delete outgoing links + reinsert | Q2 fix: incoming links survive |
| `deleteItem` | one DELETE; FK cascades clean relationships both directions and (Q1 fix) its timer links | single statement |
| idempotent link create / dedupe-keep-newest on list | UNIQUE keys + upsert | after import duplicates are impossible (import drops them); the defensive list-time dedupe stays as a no-op safety net |
| `cycleItemTimerLink` | UPDATE by link id | — |
| search / AND tag filter / sort | in Rust over the loaded state (`items_filter`) | schema supports moving this into SQL later (indexes exist) |
| hints (tags / info labels / relationship types) | DISTINCT over child/link tables ∪ defaults | duplicate labels collapse naturally |
| export (v2) / import (v1 + v2) | full round-trip per §5 + §10; `replace_all` | official data carry-over path (existing JSON file = v1) |
| pre-import snapshot backup | `insert_snapshot` | opaque payload column |

**Duplicate labels are legal.** Normalization (`createItemPayload`) trims entries and drops
empty ones but never dedupes by label — an item may carry two `description` info entries
(same for `dateTimeEntries`). The schema is built for this: no UNIQUE on `label`, order
carried by `position`. Consequences:

- The star points at a specific entry by id (`mainInfoEntryId`) — unambiguous even with
  duplicate labels (§10).
- Hints use DISTINCT → duplicates collapse; search matches every entry individually;
  reports box/mark every `fat`/contact-type entry individually.
- Entry updates are whole-collection replaces (delete child rows + reinsert with fresh
  positions) — trivially correct with duplicates.
- If a future requirement is to star a *specific* entry among duplicates, that is a domain
  change needing entry ids → schema v2 decision point, not part of v1.

**Supported external formats.** Import accepts the existing v1 JSON export shape and
the current v2 export shape. No pre-migration formats or embedded `timers`-in-item
variants are supported. See §10 for the compatibility mapping.

## 10. Current wire-format rule: star bound to entry

The starred field points at a **specific info entry**, not at a label.
The current `mainInfoField` is a label string; with duplicate labels it resolves to the
first match — ambiguous. Legacy data variants do not exist (see §9).

Consequences:

1. **Entry identity.** `InfoEntry = { id, label, value }` (id = UUIDv4);
   `Item.mainInfoField` → `Item.mainInfoEntryId`. Ids are stable across edits: existing
   rows keep their ids; new rows get fresh ids (client-generated in the editor — it already
   mints form UUIDs per row — server-generated as a fallback for id-less inputs). Entries
   absent from an update payload are deleted.
2. **Hard FK.** `items.main_info_entry_id → item_info_entries(id) ON DELETE SET NULL` —
   deleting the starred entry auto-clears the star; normalization maps unknown ids to NULL.
3. **File format v2.** Export writes `metadata.version = "2"`: entries carry ids, items
   carry `mainInfoEntryId` (no `mainInfoField`). Checksum scheme unchanged (SHA-256 hex of
   the data part). Import accepts both versions:
   - **v1** (the existing JSON file): entry ids are generated (UUIDv4); `mainInfoField`
     resolves to the **first** matching entry's id — a one-time approximation, exact when
     no duplicate labels exist;
   - **v2**: ids and star used as-is (star validated against entries, else NULL).
   The current app exports v2 and accepts both v1 and v2. Older application releases
   may reject v2 files; this is an intentional one-way format evolution.
4. **Search.** `matchesItemSearch` drops the separate `mainInfoField` field — the starred
   entry's label+value are already searched via the entries loop (the old line was
   redundant: a star always referenced an existing label).
5. **Date-time entries and tags get no ids** — nothing in the domain references them; they
   stay position-keyed (principle 3).
