# A22 project instructions

These instructions apply to the whole repository.

## Priority legend

- `P0`: strict must-follow requirement;
- `P1`: important default;
- `P2`: best-effort guidance.

## P0 version-control and progress rules

- Git is read-only for the LLM. Do not run commands that alter repository state, including `git commit`, `git push`, `git checkout`, `git reset`, or `git stash`. Version-control operations are reserved for the human developer.
- After every implemented plan step, immediately update the active plan with the current status, observed result, verification performed, and any blocker.
- Keep concise feature-focused change summaries in `docs/changes.md`, newest first. Include technical details only when crucial, omit minor changes, and do not include code snippets.
- Record every recurring implementation failure in `docs/issues/`.
- Record deferred cleanup and known technical debt in `docs/tech-debt.md`.

## Project scope

- A22 is a desktop application built with Tauri 2, React, Material UI, TypeScript, Rust, and SQLite.
- The legacy reference project outside this repository is read-only. Use it only as a behavioral or data-contract reference; never edit it and do not make the current repository depend on its presence.
- All new source code, tests, documentation, and plans belong to this repository.
- Reply to the user in the user's language. Keep code comments, API documentation, and files under `docs/` in English.
- Preserve existing behavior and user-facing text during parity work. Do not silently redesign or translate the UI.

## Architecture

The runtime data flow is:

`a22-ui-mui` → `a22-ui-core/src/platform` → Tauri IPC → `a22-app` commands → `a22-core` → `a22-db`

- `a22-db` owns SQLite schema, migrations, persistence operations, and shared Rust data types. It must remain independent from Tauri and frontend code.
- `a22-core` owns domain normalization, timer behavior, search/filtering, state operations, import/export, and snapshot handling. It must remain independent from Tauri, React, and browser APIs.
- `a22-app` is the Tauri shell. It owns application startup, the managed `AppState`, command wrappers, capabilities, and Tauri plugin wiring. It must not contain domain rules.
- `a22-ui-core` is the framework-agnostic TypeScript layer: wire types, display helpers, Zustand state, and the typed Tauri command boundary. It must not import MUI or render React components.
- `a22-ui-mui` owns React presentation, Material UI components, pages, dialogs, reports, and user interaction state. It must call Rust through `a22-ui-core`, not through ad-hoc IPC in individual components.
- `a22-core/examples/http_invoke_bridge.rs` is a development-only loopback bridge for Playwright E2E tests. It is not a production service or a public network API.
- Do not access SQLite or perform blocking filesystem/database work from a React render function. Keep OS/Tauri APIs behind the existing platform boundary or Rust command boundary.
- Keep Tauri capabilities least-privileged and remove plugin initialization or permissions that have no current use.
- Keep multi-table mutations consistent. If an operation is not transactionally atomic, do not claim that it is; record the gap in `docs/tech-debt.md` before changing its semantics.
- Keep domain and database errors typed until the Tauri boundary. Converting an error to a Tauri-serializable message at that boundary is acceptable because the current command surface uses `Result<T, String>`.

## Data and compatibility

- The current external data contract accepts JSON v1 imports and exports JSON v2.
- JSON v2 binds the starred field to an info-entry id and includes the existing checksum convention. Do not change import/export structure or checksum semantics without explicit user approval.
- SQLite uses forward-only migrations, foreign keys, ordered child collections, and persistent snapshots. Do not drop, overwrite, or silently clear timers, timer links, or snapshots.
- Backward compatibility with old SQLite databases and unrelated legacy import variants is out of scope unless explicitly approved.
- Do not add compatibility migrations or legacy import paths without documenting the decision and acceptance criteria.
- Use a new or temporary database profile for development and destructive tests. Never open or modify an old application's live database.
- Keep `Cargo.lock` and `package-lock.json` committed. Do not commit a user's database, export, snapshot, or other private data.

## Platform baseline

- The observed development baseline is macOS Ventura/Darwin 22.x, Rust `1.97.1`, Node.js `22.23.2`, npm `10.9.8`, Tauri `2.11.x`, and the versions resolved by the committed lockfiles.
- Treat this as the currently verified local baseline, not a promise of support for untested macOS, Rust, Node, Tauri, or WebView versions.
- Verify Xcode and Command Line Tools separately before claiming release support or testing native packaging.
- Do not introduce GPUI, Tauri alternatives, webviews outside the selected Tauri architecture, or a second frontend stack without explicit user approval.

## UI and accessibility

- Give interactive controls stable labels, keyboard behavior, focus handling, and useful test hooks.
- Preserve the existing report-window behavior, including separate Tauri webviews, Back/Close controls, and print behavior.
- Keep new user-facing strings consistent with the existing UI language and document any localization work separately; do not introduce a second localization system incidentally.
- Keep filesystem import/export, clipboard, dialogs, and future printing integrations behind an explicit platform or command boundary.

## Safety and change discipline

- Never commit secrets, credentials, tokens, generated private data, or a user's database.
- Ask before substantial, destructive, risky, or materially ambiguous changes.
- Change only files relevant to the requested task. Avoid unrelated cleanup or refactoring.
- Prefer the standard library or well-supported dependencies. Justify every new dependency in the relevant documentation.
- Do not mechanically copy external UI code when implementing new behavior; preserve acceptance criteria using the repository's existing architecture.
- Do not change public data contracts, file formats, database migration semantics, or user-facing behavior without explicit approval.

## Documentation and plans

- Keep architecture decisions, data-contract findings, parity requirements, verification results, and deferred work in `docs/`.
- Store implementation plans in `docs/plans/`; new plan filenames must end in `_plan.md`.
- Keep plans actionable: scope, files, invariants, implementation steps, expected observable results, verification, acceptance criteria, and rollback notes.
- Keep unit, integration, golden-vector, end-to-end, manual macOS, and release verification as separate plan steps.
- Before adding a new test group, ask the user to confirm implementation or explicitly defer that group. Do not silently replace a deferred test group with an assumption.
- Update the relevant plan and verification record after every approved implementation phase.

## Quality gates

For Rust changes, run:

```bash
cargo fmt --check
cargo check --workspace --all-targets
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
```

For frontend and integration changes, run:

```bash
npm run build
npm run lint
npm run test:e2e
```

The E2E suite requires installed npm dependencies, a Chrome channel, and the system `sqlite3` command. Native Tauri verification remains a separate manual step covering windows, dialogs, file import/export, printing, focus, persistence, and restart behavior.

Use `cargo-deny` only after the dependency set is stable. Optional later tools include `cargo-nextest`, `cargo-llvm-cov`, and Markdown linting.
