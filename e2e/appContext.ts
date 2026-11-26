// Fake-webview harness: one Playwright context stands in for the Tauri app.
// The main page is the "main" window; report webviews are extra pages of the
// same context (shared origin → shared localStorage, as in the real app),
// opened at /?a22e2e_webview=<label> so the shim's metadata matches what a
// real WebviewWindow(label, ...) would expose.
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AppContext {
	browser: Browser
	context: BrowserContext
	page: Page
	/** Open report webviews by label (report-basic / report-relationships). */
	windows: Map<string, Page>
}

const here = path.dirname(fileURLToPath(import.meta.url))

export async function createAppContext(browser: Browser): Promise<AppContext> {
	const context = await browser.newContext({ acceptDownloads: true })
	const shimSource = readFileSync(path.join(here, 'shim.js'), 'utf8')
	await context.addInitScript(shimSource)

	const windows = new Map<string, Page>()
	await context.exposeBinding('a22e2e', async (_source, op: string, payload?: unknown) => {
		switch (op) {
			case 'listWindows':
				return ['main', ...windows.keys()]
			case 'openWebview': {
				const label = String((payload as { label?: string })?.label ?? '')
				const existing = windows.get(label)
				if (existing) {
					await existing.bringToFront()
					return null
				}
				const page = await context.newPage()
				await page.goto(`/?a22e2e_webview=${encodeURIComponent(label)}`)
				windows.set(label, page)
				return null
			}
			case 'closeWindow': {
				const label = String(payload ?? '')
				const target = windows.get(label)
				if (target) {
					await target.close()
					windows.delete(label)
				}
				return null
			}
			case 'focusWindow': {
				const label = String(payload ?? '')
				const target = windows.get(label)
				if (target) {
					await target.bringToFront()
				}
				return null
			}
			default:
				throw new Error(`unknown a22e2e op: ${op}`)
		}
	})

	const page = await context.newPage()
	await page.goto('/')
	return { browser, context, page, windows }
}

export async function closeAppContext(app: AppContext): Promise<void> {
	await app.context.close()
}
