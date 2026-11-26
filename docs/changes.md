# Changes

## 2026-11-26 — README screenshots

- Added the items workspace and printable base-report screenshots to the README
  with captions and portable relative Markdown links.

## 2026-11-26 — Application icon

- Replaced the Tauri desktop, iOS, Android, and Windows icon assets with the
  new A22 vector design.
- Kept `a22-app/icons/icon.svg` as the canonical source and removed an unused
  legacy raster icon.

## 2026-11-26 — Project status and public README

- Marked this repository as a frozen Rust/Tauri research prototype.
- Linked the actively developed Rust successor, A22R, and the baseline React
  release at tag `v2026.01.00`.
- Reorganized the README for both application users and developers.

## 2026-11-26 — Repository baseline cleanup

- Aligned repository guidance with the current Tauri, React/MUI, TypeScript, Rust,
  and SQLite architecture.
- Removed unused Tauri plugins and confirmed-unused dependencies.
- Added ignore rules for frontend build metadata, test output, and local databases.
- Consolidated the architecture and SQLite contract documentation around the current
  implementation.
- Added the MIT license file and synchronized the workspace lockfiles.
