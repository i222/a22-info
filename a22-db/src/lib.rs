//! `a22-db` — SQLite persistence layer.
//!
//! Implements the schema from `docs/db-design.md`: normalized tables with real
//! FKs and constraints, forward-only migrations, and a lossless row ↔ domain
//! round-trip. The domain types live here so both `a22-core` (logic) and
//! `a22-app` (commands) share one definition; the TypeScript side mirrors them
//! in `a22-ui-core`.

mod error;
mod schema;
mod store;
mod types;

pub use error::{DbError, Result};
pub use schema::SCHEMA_VERSION;
pub use store::Store;
pub use types::{DatabaseSnapshot, DateTimeEntry, DbData, InfoEntry, Item, ItemLink, ItemTimerLink, SnapshotEncoding, Timer, TimerIntervalUnit, TimerSchedule};
