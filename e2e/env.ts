// Development-only E2E environment shared by playwright.config.ts and the specs.
import { randomUUID } from 'node:crypto'

// The config process pins A22_E2E_RUN before spawning workers, so every
// process (config, bridge webServer command, test workers) agrees on one run id.
export const RUN_ID = process.env.A22_E2E_RUN ?? `${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`
export const DB_PATH = `/tmp/a22-s16/e2e-${RUN_ID}.db`
export const VITE_PORT = 1420
export const BRIDGE_PORT = 9787
export const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`
export const BASE_URL = `http://localhost:${VITE_PORT}`
