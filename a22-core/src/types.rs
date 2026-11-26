//! Domain types for `a22-core`.
//!
//! The canonical definitions live in `a22-db::types` (single definition shared
//! by `a22-core` and `a22-app`, camelCase JSON per `docs/db-design.md` §5); this
//! module re-exports them so core code has one import site.

pub use a22_db::{DatabaseSnapshot, DateTimeEntry, DbData, InfoEntry, Item, ItemLink, ItemTimerLink, SnapshotEncoding, Timer, TimerIntervalUnit, TimerSchedule};
