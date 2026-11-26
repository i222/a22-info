//! `a22-core` — Tauri-independent domain and application logic.
//!
//! The crate provides normalization, timer calculations, search/filtering,
//! state operations, and import/export for the Tauri command layer. Golden
//! vectors under `tests/golden/` pin compatibility-sensitive behavior.

pub mod hints;
pub mod import_export;
pub mod normalize;
pub mod search;
pub mod state;
pub mod timer;
pub mod types;
