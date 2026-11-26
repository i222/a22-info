# A22



> **Project status: frozen research prototype.**
>
> This repository explores the practical use of Rust and Tauri for a real
> desktop application. It is not currently under active development. Active
> development continues in [A22R](https://github.com/i222/A22R), the successor
> project implemented entirely in Rust, including its GUI.

<img src="./a22-app/icons/icon.png" alt="A22 application icon" width="60" align="left" style="margin: 0 24px 12px 0;">
A22 is a desktop application for organising personal information as structured
items, timers, relationships, and printable reports. This repository captures
the Tauri-based prototype and its transition from a React application to a
Rust-backed desktop architecture.
<br clear="left">

## Project history and versions

- The first basic React application is preserved at the
  [tag `v2026.01.00`](https://github.com/i222/a22-info/tree/v2026.01.00).
- This repository contains the subsequent Tauri/Rust research prototype.
- The actively developed successor is
  [A22R](https://github.com/i222/A22R).

## What the application provides

- **Information items** — create and edit items with ordered tags, information
  fields, date/time fields, relationships, and a starred information entry.
- **Search and filtering** — search item content and filter by all selected tags.
- **Timers** — create one-time or recurring timers, link them to items, and track
  their live status with check and cancel actions.
- **Reports** — open a printable base report or an interactive relationships
  report in separate Tauri windows.
- **Data transfer** — export JSON snapshots in format v2 and import supported v1
  and v2 files. An import replaces the current data and creates a pre-import
  backup snapshot when the database already contains data.

## Screenshots

### Items and details

![A22 items workspace with search, tag filters, and selected item details](./docs/screenshots/Screenshot%202026-11-26%20at%2010.45.05.png)

*The main workspace combines the item list, search and tag filters, and the
details of the selected item.*

### Base report

![A22 printable base report in a separate window](./docs/screenshots/Screenshot%202026-11-26%20at%2010.45.46.png)

*The base report opens in a separate window and is formatted for A4 portrait
printing.*

## Try the prototype

### Prerequisites

- Node.js `20.19+` or `22.12+`, with npm.
- Stable Rust via `rustup`.
- Tauri v2 platform prerequisites. On macOS, install Xcode Command Line Tools.
- For end-to-end tests: Google Chrome and the system `sqlite3` command.

The Tauri CLI is provided by the lockfile-resolved npm dependency; a separate
`cargo install tauri-cli` is not required.

### Run from source

From the repository root:

```bash
npm install
npm run tauri dev
```

This starts Vite on `http://localhost:1420`, launches the Tauri window, and
enables frontend hot reload.

## Data and compatibility

The application database is `<app_data_dir>/a22.db`. On macOS, the default path
is:

```text
~/Library/Application Support/com.a22.app/a22.db
```

SQLite uses WAL mode, foreign keys, ordered child collections, and forward-only
migrations tracked in `meta.schema_version`. Existing SQLite databases from
other application versions are not migrated automatically. Use the supported
JSON transfer path instead:

- imports accept JSON v1 and v2;
- exports always produce JSON v2;
- v2 binds the starred field to an information-entry id and includes the existing
  SHA-256 checksum convention.

## For developers

### Architecture

```text
React + Material UI (a22-ui-mui)
        │
        ▼
Typed commands and Zustand state (a22-ui-core)
        │ Tauri IPC
        ▼
Tauri shell and command handlers (a22-app)
        │
        ▼
Rust domain and application state (a22-core)
        │
        ▼
SQLite schema and persistence (a22-db)
```

The dependency direction is intentional:

- Rust: `a22-app → a22-core → a22-db`
- Frontend: `a22-ui-mui → a22-ui-core`

The UI does not access SQLite directly. MUI components also do not call the
Tauri API directly; IPC stays behind `a22-ui-core/src/platform/`. The
development-only `a22-core/examples/http_invoke_bridge.rs` exposes the same
command operations to Playwright without using a user's application database.

### Repository layout

```text
.
├── a22-app/              # Tauri shell, commands, capabilities, and bundle resources
├── a22-core/             # Rust domain logic, state operations, import/export, and snapshots
├── a22-db/               # SQLite schema, migrations, store, and shared Rust types
├── a22-ui-core/          # TypeScript wire types, commands, helpers, and Zustand state
├── a22-ui-mui/           # React/Material UI pages, dialogs, reports, and theme
├── e2e/                  # Playwright tests and the development test bridge
├── docs/                 # Current architecture, data contract, plans, and project notes
├── Cargo.toml            # Rust workspace
└── package.json          # npm workspace and frontend commands
```

### Verification and builds

```bash
# Frontend
npm run build
npm run lint
npm run format
npx dprint check

# Rust
cargo fmt --all --check
cargo check --workspace --all-targets
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace

# End-to-end
npm run test:e2e

# Tauri bundle
npm run tauri build
```

The Playwright suite runs the real Vite frontend, Rust command implementation,
and SQLite store. It substitutes only the IPC transport and native webview
windows with local test infrastructure. Each run uses a temporary database
under `/tmp/a22-s16/` and does not touch the installed application profile.

Native Tauri behavior requires a separate manual macOS check for windows,
dialogs, file import/export, printing, focus, persistence, and restart behavior.

## Known limitations

- Pre-import backup snapshots are stored in SQLite but there is no restore UI.
- Import does not verify the export checksum.
- A v1 starred label is resolved to the first matching information entry when
  duplicate labels exist.
- Item updates that replace outgoing relationships are not currently one
  database transaction; see [`docs/tech-debt.md`](docs/tech-debt.md).

## Documentation

- [`docs/module-structure.md`](docs/module-structure.md) — current runtime flow
  and module responsibilities.
- [`docs/db-design.md`](docs/db-design.md) — SQLite schema and data contract.
- [`docs/changes.md`](docs/changes.md) — concise change history.
- [`docs/tech-debt.md`](docs/tech-debt.md) — deferred work and known risks.
- [`AGENTS.md`](AGENTS.md) — repository rules for contributors and automation.

## License

MIT. See [`LICENSE`](LICENSE).
