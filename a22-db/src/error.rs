//! Error types for the SQLite persistence layer.

use thiserror::Error;

/// Errors produced by `a22-db`.
#[derive(Debug, Error)]
pub enum DbError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// Stored data violates an expected invariant (e.g. an unknown enum value).
    /// The CHECK constraints make this unreachable through the store API; it is a
    /// defensive backstop for tampered or half-migrated files.
    #[error("stored data integrity error: {0}")]
    Integrity(String),
    #[error("migration error: {0}")]
    Migration(String),
}

pub type Result<T> = std::result::Result<T, DbError>;
