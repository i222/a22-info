// Playwright configuration for the GUI verification suite.
//
// Stack under test: real Rust command surface (HTTP bridge over a22-core +
// a22-db, same ops as the Tauri commands) + real Vite frontend + real store
// and MUI components in system Chrome. The only thing faked is the IPC
// transport (window.__TAURI_INTERNALS__.invoke → HTTP) and OS-level webview
// windows (Playwright pages, see e2e/appContext.ts).
import { defineConfig } from '@playwright/test'
import { BASE_URL, BRIDGE_PORT, DB_PATH, RUN_ID } from './e2e/env'

// Pin the run id for all child processes (workers, webServer commands).
process.env.A22_E2E_RUN = RUN_ID

export default defineConfig({
	testDir: './e2e',
	timeout: 180_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [['list']],
	outputDir: `/tmp/a22-s16/pw-out-${RUN_ID}`,
	use: {
		baseURL: BASE_URL,
		headless: true,
		channel: 'chrome',
		viewport: { width: 1440, height: 900 },
	},
	webServer: [
		{
			command: 'npm run dev',
			url: `${BASE_URL}`,
			reuseExistingServer: true,
			timeout: 60_000,
		},
		{
			command: `A22_DB_PATH=${DB_PATH} A22_BRIDGE_PORT=${BRIDGE_PORT} cargo run -q -p a22-core --example http_invoke_bridge`,
			url: `http://127.0.0.1:${BRIDGE_PORT}/health`,
			reuseExistingServer: false,
			timeout: 180_000,
		},
	],
})
