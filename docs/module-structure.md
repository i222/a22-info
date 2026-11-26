# Current Module Structure

A22 is a Tauri desktop application with a React/MUI frontend and Rust domain and
persistence layers. This document describes the current repository, not the historical
porting stages.

## Runtime data flow

```text
a22-ui-mui
    │ React presentation and user interactions
    ▼
a22-ui-core/src/platform
    │ typed command client and Tauri runtime boundary
    ▼
a22-app
    │ Tauri commands and managed AppState
    ▼
a22-core
    │ domain rules, state operations, import/export
    ▼
a22-db
    │ SQLite schema, migrations, and persistence
```

The development-only `a22-core/examples/http_invoke_bridge.rs` exposes the same
application operations over loopback HTTP for Playwright. It is not part of the
production runtime or a public service.

## Repository layout

```text
.
├── a22-app/              # Tauri shell, commands, capabilities, and bundle resources
├── a22-core/             # Tauri-free Rust domain logic and application state
├── a22-db/               # SQLite schema, migrations, store, and shared Rust types
├── a22-ui-core/          # Framework-agnostic TypeScript state and command boundary
├── a22-ui-mui/           # React and Material UI presentation
├── e2e/                  # Playwright tests and the development IPC/webview shim
├── docs/                 # Current architecture, data contract, changes, and debt
├── Cargo.toml            # Rust workspace
├── package.json          # npm workspace and frontend commands
├── vite.config.ts        # Root Vite configuration and workspace aliases
└── a22-app/tauri.conf.json
```

## Module responsibilities

### `a22-db`

- Owns SQLite opening, WAL/foreign-key setup, migrations, schema constraints, and
  row-to-domain mapping.
- Provides `Store`, `DbData`, and the shared Rust domain data types.
- Has no dependency on Tauri, React, TypeScript, or presentation concerns.
- Keeps ordered child collections ordered and preserves snapshots during
  `replace_all`.

### `a22-core`

- Owns normalization, hints, timer calculations, search/filter semantics, state
  mutations, JSON import/export, and pre-import snapshots.
- Uses `a22-db` for persistence but remains independent from Tauri and browser APIs.
- Exposes pure or testable operations to the Tauri command layer.
- Contains golden-vector tests for parity-sensitive behavior and a development-only
  HTTP bridge example for E2E tests.

### `a22-app`

- Owns the Tauri application entry point, application data directory setup, and
  `Mutex<AppState>` management.
- Exposes the typed command surface from `src/commands.rs`.
- Owns Tauri capabilities in `capabilities/` and bundle configuration in
  `tauri.conf.json`.
- Does not contain item, timer, search, or import/export domain rules.

### `a22-ui-core`

- Owns TypeScript wire models, display helpers, Zustand state, and the typed
  command client.
- Keeps all direct `@tauri-apps/api` calls under `src/platform/`.
- Provides the browser-development guard used when Tauri is unavailable.
- Does not import MUI or render React components.

### `a22-ui-mui`

- Owns React pages, components, dialogs, reports, styles, and the application entry
  point.
- Depends on `a22-ui-core` through the workspace package and configured path aliases.
- Does not call Rust commands or `@tauri-apps/api` directly from presentation
  components.
- Report windows use the shared platform helper and render the report chrome only
  when running in a Tauri report webview.

### `e2e`

- Uses Playwright with a real Vite frontend, Rust command implementation, and
  SQLite database.
- Replaces only the Tauri IPC transport and native webview windows with a local
  test bridge and Playwright pages.
- Uses a temporary database path under `/tmp`; it must never use a user's live
  application database.

## Dependency rules

- Rust: `a22-app → a22-core → a22-db`.
- Frontend: `a22-ui-mui → a22-ui-core`.
- `a22-db` never depends on Tauri or frontend code.
- `a22-core` never depends on Tauri, React, or browser APIs.
- MUI presentation never imports `@tauri-apps/api`.
- New platform integrations belong behind `a22-ui-core/src/platform/` or the Rust
  Tauri command boundary.

## Resources and generated metadata

- `a22-app/icons/icon.svg` is the canonical icon source; the
  generated PNG, ICO, ICNS, iOS, Android, and Windows assets in that directory
  are used by the Tauri bundle configuration.
- `a22-app/capabilities/` contains the checked-in capability definitions.
- `a22-app/gen/schemas/` contains capability schema metadata referenced by the
  capability files and is kept versioned with them.
- `target/`, `dist/`, `node_modules/`, TypeScript build metadata, test output, and
  local database profiles are generated or machine-local and are ignored.
