# Technical Debt

## Current items

- Item updates that replace outgoing relationships use several persistence
  operations and are not one database transaction. A partial failure could leave
  the item and its relationships out of sync; preserve this limitation until a
  transactional mutation API is designed.
- Pre-import snapshots are written to SQLite but there is no restore UI.
- Import accepts the checksum field but intentionally does not verify it.
- Native Tauri/macOS verification of windows, printing, focus, file import/export,
  persistence, and restart behavior still needs a manual run.
- The Playwright E2E suite was attempted, but the installed Chrome process
  aborted during launch (`SIGABRT`; cleanup also returned `EPERM`). The suite
  needs a working local/CI Chrome environment before it can be used as a
  passing gate.
- Frontend lint reports five existing React warnings: two array-index key warnings
  and hook-dependency warnings in the report components. They were not changed as
  part of repository cleanup.
- `npm install` reported two high-severity audit advisories. No automatic audit fix
  was applied; dependency impact should be reviewed separately.

## Rules for new debt

Record new deferred cleanup here with the user-visible or data-integrity impact,
the reason it is deferred, and the verification required before closing it.
