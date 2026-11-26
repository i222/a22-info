# Initial Commit Preparation Plan

Status: in progress

## Scope

Prepare the current A22 Tauri desktop application for its first complete project
commit without changing Git history. The repository contains Rust domain and
SQLite layers, a TypeScript command/store layer, a React/MUI frontend, and
Playwright integration tests.

## Steps

- [x] Align `AGENTS.md` with the current Tauri/React/MUI/TypeScript/Rust/SQLite
  architecture.
- [x] Inventory the repository and normalize the project name to `a22-info`.
- [x] Configure `.gitignore` for generated frontend output, test artifacts, and
  local databases.
- [x] Remove confirmed-unused dependencies and plugins, fix formatter coverage,
  synchronize lockfiles, and add the MIT license.
- [x] Replace historical architecture and implementation documents with current
  architecture and data-contract documentation.
- [x] Rewrite the root README as a current-state project guide.
- [x] Run the final quality gates and prepare the human-facing commit checklist.

## Invariants

- Do not commit secrets, private databases, generated build output, or test
  profiles.
- Keep `Cargo.lock`, `package-lock.json`, source code, tests, fixtures, Tauri
  capabilities, and required bundle resources.
- Do not change public JSON or SQLite contracts during repository cleanup.
- The LLM must not commit, push, reset, checkout, or stash Git state.

## Verification record

- `AGENTS.md`: rewritten and lint-clean.
- Repository inventory: completed; `HEAD` contains only the original README and
  all current project files are uncommitted.
- `.gitignore`: verified with `git check-ignore`; local build metadata and DB
  profiles are excluded; Tauri capability schemas remain versioned.
- Dependency/tooling cleanup: `cargo check --workspace --all-targets`,
  `cargo fmt --all --check`, `npx dprint check`, and `npm run lint` completed.
- README: rewritten with current architecture, setup, verification commands,
  data compatibility, limitations, and documentation links.
- Final verification: Rust format/check/clippy/tests and frontend install/build/
  lint/dprint passed; a Clippy issue in the E2E bridge was fixed and rechecked.
  Secret and stale-reference searches were clean, and generated/local outputs
  remain ignored.
- Known verification notes: frontend lint retains five existing warnings;
  `npm install` reports two high-severity audit advisories; Playwright cannot
  launch the installed Chrome in this environment (`SIGABRT`, cleanup `EPERM`);
  native Tauri/macOS smoke verification is still pending.
