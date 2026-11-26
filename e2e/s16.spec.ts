// End-to-end verification of the Tauri command surface and the frontend.
//
// Stack: real Rust command surface (HTTP bridge over a22-core + a22-db) + real
// Vite frontend + real Zustand store + MUI in system Chrome. Faked: IPC
// transport (shim, e2e/shim.js) and OS webview windows (Playwright pages).
// Each step asserts both the DOM and the SQLite rows behind it.
import { chromium, expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type AppContext, closeAppContext, createAppContext } from './appContext'
import { invoke } from './bridge'
import { dbCount, dbQuery } from './db'

type LoadAll = {
	items: Array<{ id: string; mainInfoEntryId: string | null; tags: string[]; infoEntries: Array<{ id: string; label: string; value: string }> }>
	timers: Array<{ id: string; name: string }>
	itemLinks: Array<{ id: string; itemId: string; targetId: string; type: string }>
	itemTimerLinks: Array<{ id: string; itemId: string; timerId: string; lastCheckedAt: string }>
}

let browser: Browser
let app: AppContext

const itemRows = (page: Page) => page.locator('li:has([aria-label="Delete item"])')
const rowPrimaryTexts = async (page: Page): Promise<string[]> => {
	const texts = await page.locator('li:has([aria-label="Delete item"]) .MuiListItemText-primary').allInnerTexts()
	return texts.map((text) => text.trim()).filter((text) => text.length > 0)
}

// UI mutations commit asynchronously through the Rust bridge; after a click
// without a following DOM wait, poll the DB instead of racing the write.
const dbExpect = (sql: string, expected: string) =>
	expect
		.poll(async () => await dbQuery(sql), { timeout: 20_000 })
		.toBe(expected)
const dbWaitNonEmpty = (sql: string) =>
	expect
		.poll(async () => (await dbQuery(sql)).length > 0, { timeout: 20_000 })
		.toBe(true)

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
	browser = await chromium.launch({ headless: true, channel: 'chrome' })
	app = await createAppContext(browser)
})

test.afterAll(async () => {
	if (app) {
		await closeAppContext(app)
	}
	if (browser) {
		await browser.close()
	}
})

async function openItemEditor(value: string, mode: 'view' | 'edit'): Promise<void> {
	const row = itemRows(app.page).filter({ hasText: value })
	await row.click()
	if (mode === 'edit') {
		await app.page.getByRole('button', { name: 'Edit', exact: true }).click()
	}
}

async function addInfoEntry(label: string, value: string): Promise<void> {
	await app.page.getByRole('button', { name: 'Add entry', exact: true }).click()
	const stars = app.page.locator('[aria-label="Set main info entry"]')
	const row = stars.nth((await stars.count()) - 1).locator('xpath=..')
	const labelInput = row.getByLabel('Label')
	await labelInput.click()
	await labelInput.pressSequentially(label)
	await row.getByLabel('Value').fill(value)
}

async function starEntry(index: number): Promise<void> {
	await app.page.locator('[aria-label="Set main info entry"]').nth(index).click()
}

test('1. fresh start: empty dataset, schema v1 in a22.db', async () => {
	await expect(app.page.getByText('No items found.')).toBeVisible()
	expect(await dbQuery(`SELECT value FROM meta WHERE key = 'schema_version'`)).toBe('1')
	for (const table of ['items', 'timers', 'item_links', 'item_timer_links', 'snapshots']) {
		expect(await dbCount(table), `table ${table} must be empty`).toBe(0)
	}
	const loaded = await invoke<LoadAll>('db_load_all')
	expect(loaded.items).toHaveLength(0)
})

test('2. create item A: tags, info entries + star, datetime entry', async () => {
	await app.page.getByRole('button', { name: 'Add', exact: true }).click()

	const tagsInput = app.page.getByRole('combobox', { name: 'Tags', exact: true })
	await tagsInput.click()
	await tagsInput.pressSequentially('work')
	await app.page.keyboard.press('Enter')
	await tagsInput.pressSequentially('home')
	await app.page.keyboard.press('Enter')

	await addInfoEntry('Title', 'Item Alpha')
	await starEntry(0)
	await addInfoEntry('Note', 'alpha note')

	await app.page.getByRole('button', { name: 'Add DT field', exact: true }).click()
	const dtRow = app.page.locator('input[type="datetime-local"]').first().locator('xpath=ancestor::div[contains(@class,"MuiStack-root")][1]')
	await dtRow.locator('input[type="datetime-local"]').fill('2026-08-20T17:00')
	await dtRow.getByLabel('Label').fill('Due')

	await app.page.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(itemRows(app.page).filter({ hasText: 'Item Alpha' })).toBeVisible()

	await dbExpect(`SELECT COUNT(*) FROM items`, '1')
	const alphaId = await dbQuery(`SELECT id FROM items LIMIT 1`)
	await dbExpect(`SELECT tag FROM item_tags WHERE item_id = '${alphaId}' ORDER BY position`, 'work\nhome')
	await dbExpect(`SELECT COUNT(*) FROM item_info_entries`, '2')
	const starSql = `SELECT main_info_entry_id FROM items WHERE id = '${alphaId}'`
	const starredEntryId = await dbWaitNonEmpty(starSql).then(() => dbQuery(starSql))
	await dbExpect(`SELECT label || '=' || value FROM item_info_entries WHERE id = '${starredEntryId}'`, 'Title=Item Alpha')
	await dbExpect(`SELECT label FROM item_date_time_entries WHERE item_id = '${alphaId}'`, 'Due')
})

test('3. create items B and C', async () => {
	for (const [value, tag] of [['Item Beta', 'work'], ['Item Gamma', 'temp']] as const) {
		await app.page.getByRole('button', { name: 'Add', exact: true }).click()
		const tagsInput = app.page.getByRole('combobox', { name: 'Tags', exact: true })
		await tagsInput.click()
		await tagsInput.pressSequentially(tag)
		await app.page.keyboard.press('Enter')
		await addInfoEntry('Title', value)
		await starEntry(0)
		await app.page.getByRole('button', { name: 'Save', exact: true }).click()
		await expect(itemRows(app.page).filter({ hasText: value })).toBeVisible()
	}
	await dbExpect(`SELECT COUNT(*) FROM items`, '3')
})

test('4. edit item A: value changes, tag added, star preserved by id', async () => {
	const alphaId = await dbQuery(`SELECT id FROM items ORDER BY created_at LIMIT 1`)
	const starBefore = await dbQuery(`SELECT main_info_entry_id FROM items WHERE id = '${alphaId}'`)

	await openItemEditor('Item Alpha', 'edit')
	const titleRow = app.page.locator('[aria-label="Set main info entry"]').first().locator('xpath=..')
	await titleRow.getByLabel('Value').fill('Item Alpha v2')
	const tagsInput = app.page.getByRole('combobox', { name: 'Tags', exact: true })
	await tagsInput.click()
	await tagsInput.pressSequentially('urgent')
	await app.page.keyboard.press('Enter')
	await app.page.getByRole('button', { name: 'Save', exact: true }).click()

	await expect(itemRows(app.page).filter({ hasText: 'Item Alpha v2' })).toBeVisible()
	await dbExpect(`SELECT main_info_entry_id FROM items WHERE id = '${alphaId}'`, starBefore)
	await dbExpect(`SELECT value FROM item_info_entries WHERE id = '${starBefore}'`, 'Item Alpha v2')
	await dbExpect(`SELECT tag FROM item_tags WHERE item_id = '${alphaId}' ORDER BY position`, 'work\nhome\nurgent')
	await dbExpect(`SELECT updated_at > created_at FROM items WHERE id = '${alphaId}'`, '1')
})

test('5. search + AND tag filter + sort by updated/created', async () => {
	const search = app.page.getByLabel('Search')
	await search.fill('Alpha')
	await expect(itemRows(app.page)).toHaveCount(1)
	await expect(itemRows(app.page).first()).toContainText('Item Alpha v2')
	await app.page.locator('[aria-label="Clear search"]').click()
	await expect(itemRows(app.page)).toHaveCount(3)

	const tagFilter = app.page.getByRole('combobox', { name: 'Quick filter by tags', exact: true })
	await tagFilter.click()
	await tagFilter.pressSequentially('work')
	await app.page.getByRole('listbox').getByText('work', { exact: true }).click()
	await expect(itemRows(app.page)).toHaveCount(2)
	await tagFilter.click()
	await tagFilter.pressSequentially('urgent')
	await app.page.getByRole('listbox').getByText('urgent', { exact: true }).click()
	await expect(itemRows(app.page)).toHaveCount(1)
	await expect(itemRows(app.page).first()).toContainText('Item Alpha v2')
	// AND semantics: drop one of the two selected tags (chip click) → back to 2 items.
	const filterChips = tagFilter.locator('xpath=..')
	await app.page.keyboard.press('Escape')
	await filterChips.getByRole('button', { name: 'urgent', exact: true }).locator('.MuiChip-deleteIcon').click()
	await expect(itemRows(app.page)).toHaveCount(2)
	// Clear the last selected tag via the filter's Clear button → all 3 items.
	await app.page.keyboard.press('Escape')
	await app.page.getByRole('button', { name: 'Clear', exact: true }).click()
	await expect(itemRows(app.page)).toHaveCount(3)

	// updatedAt desc (A edited last): A, C, B. createdAt desc: C, B, A.
	expect(await rowPrimaryTexts(app.page)).toEqual(['Item Alpha v2', 'Item Gamma', 'Item Beta'])
	await app.page.locator('[aria-label="Sorted by: Updated"]').click()
	expect(await rowPrimaryTexts(app.page)).toEqual(['Item Gamma', 'Item Beta', 'Item Alpha v2'])
})

test('6. timers: one-time past → red → check → green (done); DB lastCheckedAt updated', async () => {
	await app.page.locator('[aria-label="Open timers"]').click()
	await expect(app.page.getByRole('heading', { name: 'Timers' })).toBeVisible()

	// T1: one-time, base in the past.
	const dialog = app.page.locator('.MuiDialog-root')
	await app.page.getByRole('button', { name: 'Add timer', exact: true }).click()
	await dialog.getByLabel('Name').fill('OneTime Past')
	await dialog.locator('input[type="date"]').fill('2026-08-10')
	await dialog.getByLabel('Description').fill('past one-time')
	await dialog.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(dialog).toBeHidden()

	// T2: periodic hourly, base today (midnight → next run within the hour).
	const now = new Date()
	const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
	await app.page.getByRole('button', { name: 'Add timer', exact: true }).click()
	await dialog.getByLabel('Name').fill('Hourly')
	await dialog.locator('input[type="date"]').fill(localDate)
	await dialog.getByLabel('Description').fill('hourly run')
	await dialog.getByText('Periodic schedule', { exact: true }).click()
	await dialog.getByLabel('Unit').click()
	await app.page.getByRole('listbox').getByText('Hours', { exact: true }).click()
	await dialog.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(dialog).toBeHidden()

	expect(await dbCount('timers')).toBe(2)
	const t1 = await dbQuery(`SELECT id FROM timers WHERE name = 'OneTime Past'`)
	const t2 = await dbQuery(`SELECT id FROM timers WHERE name = 'Hourly'`)
	expect(await dbQuery(`SELECT (schedule_every IS NULL) || '|' || (schedule_unit IS NULL) FROM timers WHERE id = '${t1}'`)).toBe('1|1')
	expect(await dbQuery(`SELECT schedule_every || '|' || schedule_unit FROM timers WHERE id = '${t2}'`)).toBe('1|hours')

	// Link T1 to item A from the editor.
	await app.page.getByRole('button', { name: 'Back to items' }).click()
	await openItemEditor('Item Alpha v2', 'edit')
	const linkSelect = app.page.getByRole('combobox', { name: 'Link existing timer', exact: true })
	await linkSelect.click()
	await linkSelect.pressSequentially('OneTime Past')
	await app.page.getByRole('listbox').getByText('OneTime Past', { exact: true }).click()
	await app.page.getByRole('button', { name: 'Link', exact: true }).click()
	const alphaId = await dbQuery(`SELECT id FROM items ORDER BY created_at LIMIT 1`)
	const link1Sql = `SELECT id FROM item_timer_links WHERE item_id = '${alphaId}' AND timer_id = '${t1}'`
	await dbWaitNonEmpty(link1Sql)
	const linkId = await dbQuery(link1Sql)
	await dbExpect(`SELECT last_checked_at FROM item_timer_links WHERE id = '${linkId}'`, '1970-01-01T00:00:00.000Z')

	// Engine status via the bridge: overdue one-time → red.
	const statuses = await invoke<Record<string, { visualState: string; nextRunAt?: number; lastRunAt?: number }>>('timers_statuses')
	expect(statuses[linkId].visualState).toBe('red')

	// UI: ItemView (item details) shows the overdue label; check flips to green (done).
	await itemRows(app.page).filter({ hasText: 'Item Alpha v2' }).click()
	const timerText = app.page.getByText(/OneTime Past • /)
	await expect(timerText).toContainText(/late /)
	await timerText.locator('xpath=..').locator('[aria-label="check timer"]').click()
	await expect(timerText).toContainText('(done)')
	const afterCheck = await invoke<Record<string, { visualState: string; lastRunAt?: number }>>('timers_statuses')
	expect(afterCheck[linkId].visualState).toBe('green')
	expect(typeof afterCheck[linkId].lastRunAt).toBe('number')
	const newLastChecked = await dbQuery(`SELECT last_checked_at FROM item_timer_links WHERE id = '${linkId}'`)
	expect(newLastChecked.startsWith('1970')).toBe(false)
})

test('7. timer precheck cycle: red catch-up → yellow → blue (prechecked) → cancel back', async () => {
	const t2 = await dbQuery(`SELECT id FROM timers WHERE name = 'Hourly'`)
	const betaId = await dbQuery(`SELECT id FROM items ORDER BY created_at LIMIT 1 OFFSET 1`)

	// Link Hourly to item B.
	await openItemEditor('Item Beta', 'edit')
	const linkSelect = app.page.getByRole('combobox', { name: 'Link existing timer', exact: true })
	await linkSelect.click()
	await linkSelect.pressSequentially('Hourly')
	await app.page.getByRole('listbox').getByText('Hourly', { exact: true }).click()
	await app.page.getByRole('button', { name: 'Link', exact: true }).click()

	const link2Sql = `SELECT id FROM item_timer_links WHERE item_id = '${betaId}' AND timer_id = '${t2}'`
	await dbWaitNonEmpty(link2Sql)
	const linkId = await dbQuery(link2Sql)
	// A fresh link carries lastCheckedAt = epoch while the hourly base has already
	// run, so the engine starts red (late), not precheckable.
	expect((await invoke<Record<string, { visualState: string }>>('timers_statuses'))[linkId].visualState).toBe('red')

	// Catch-up check: red → checked at the last run → yellow (soon), not blue yet.
	await itemRows(app.page).filter({ hasText: 'Item Beta' }).click()
	const hourlyText = app.page.getByText(/Hourly • /)
	await expect(hourlyText).toBeVisible()
	await expect(hourlyText).toContainText(/late /)
	await hourlyText.locator('xpath=..').locator('[aria-label="check timer"]').click()
	await expect(hourlyText).toContainText('(soon)')
	const caughtUp = await invoke<Record<string, { visualState: string }>>('timers_statuses')
	expect(caughtUp[linkId].visualState).toBe('yellow')

	// Precheck on yellow: checked at the next run → blue (prechecked).
	await hourlyText.locator('xpath=..').locator('[aria-label="check timer"]').click()
	// The (prechecked) label re-renders only after the cycle command commits.
	await expect(hourlyText).toContainText('(prechecked)')
	const mid = await invoke<Record<string, { visualState: string }>>('timers_statuses')
	expect(mid[linkId].visualState).toBe('blue')

	// Cancel precheck: back from blue.
	await hourlyText.locator('xpath=..').locator('[aria-label="cancel precheck"]').click()
	await expect(hourlyText).not.toContainText('(prechecked)')
	const after = await invoke<Record<string, { visualState: string }>>('timers_statuses')
	expect(after[linkId].visualState).not.toBe('blue')
})

test('8. relationships B→A + Q2 regression (incoming survives A resave) + outgoing replacement', async () => {
	const alphaId = await dbQuery(`SELECT id FROM items ORDER BY created_at LIMIT 1`)
	const betaId = await dbQuery(`SELECT id FROM items ORDER BY created_at LIMIT 1 OFFSET 1`)
	const gammaId = await dbQuery(`SELECT id FROM items ORDER BY created_at LIMIT 1 OFFSET 2`)

	// B → A relationship via the dialog.
	await openItemEditor('Item Beta', 'edit')
	await app.page.getByRole('button', { name: 'Add relationship' }).click()
	const relDialog = app.page.locator('.MuiDialog-root')
	await relDialog.locator('li').filter({ hasText: 'Item Alpha v2' }).click()
	await relDialog.getByRole('button', { name: 'Add selected (1)' }).click()
	await expect(relDialog).toBeHidden()
	await app.page.getByRole('button', { name: 'Save', exact: true }).click()

	await dbExpect(`SELECT COUNT(*) FROM item_links WHERE item_id = '${betaId}' AND target_id = '${alphaId}'`, '1')

	// Q2: resave A (payload always carries the relationships key) → B→A survives.
	await openItemEditor('Item Alpha v2', 'edit')
	await app.page.getByRole('button', { name: 'Save', exact: true }).click()
	await dbExpect(`SELECT COUNT(*) FROM item_links WHERE item_id = '${betaId}' AND target_id = '${alphaId}'`, '1')

	// A's outgoing replacement: add A→C → exactly B→A + A→C afterwards.
	await openItemEditor('Item Alpha v2', 'edit')
	await app.page.getByRole('button', { name: 'Add relationship' }).click()
	const relDialog2 = app.page.locator('.MuiDialog-root')
	await relDialog2.locator('li').filter({ hasText: 'Item Gamma' }).click()
	await relDialog2.getByRole('button', { name: 'Add selected (1)' }).click()
	await expect(relDialog2).toBeHidden()
	await app.page.getByRole('button', { name: 'Save', exact: true }).click()

	await expect
		.poll(async () => (await dbQuery(`SELECT item_id || '>' || target_id FROM item_links ORDER BY id`)).split('\n').sort(), { timeout: 20_000 })
		.toEqual([`${betaId}>${alphaId}`, `${alphaId}>${gammaId}`].sort())
})

test('9. Q1 regression: delete item C with a linked timer → no orphan rows', async () => {
	const t2 = await dbQuery(`SELECT id FROM timers WHERE name = 'Hourly'`)
	const betaId = await dbQuery(`SELECT id FROM items ORDER BY created_at LIMIT 1 OFFSET 1`)
	const gammaId = await dbQuery(`SELECT id FROM items ORDER BY created_at LIMIT 1 OFFSET 2`)

	await openItemEditor('Item Gamma', 'edit')
	const linkSelect = app.page.getByRole('combobox', { name: 'Link existing timer', exact: true })
	await linkSelect.click()
	await linkSelect.pressSequentially('Hourly')
	await app.page.getByRole('listbox').getByText('Hourly', { exact: true }).click()
	await app.page.getByRole('button', { name: 'Link', exact: true }).click()
	await dbExpect(`SELECT COUNT(*) FROM item_timer_links WHERE item_id = '${gammaId}'`, '1')

	// Delete C from the list (confirm dialog).
	const row = itemRows(app.page).filter({ hasText: 'Item Gamma' })
	await row.locator('[aria-label="Delete item"]').click()
	await app.page.locator('.MuiDialog-root').getByRole('button', { name: 'Delete', exact: true }).click()
	await expect(itemRows(app.page)).toHaveCount(2)

	// No orphan rows anywhere; the timer itself and B's link to it survive.
	await dbExpect(`SELECT COUNT(*) FROM items WHERE id = '${gammaId}'`, '0')
	await dbExpect(`SELECT COUNT(*) FROM item_timer_links WHERE item_id = '${gammaId}'`, '0')
	await dbExpect(`SELECT COUNT(*) FROM item_links WHERE item_id = '${gammaId}' OR target_id = '${gammaId}'`, '0')
	await dbExpect(`SELECT COUNT(*) FROM timers`, '2')
	await dbExpect(`SELECT COUNT(*) FROM item_timer_links WHERE item_id = '${betaId}' AND timer_id = '${t2}'`, '1')
})

test('10. reports: separate webviews, chrome bar, no duplicates, back/close, print media', async () => {
	await app.page.locator('[aria-label="Open reports"]').click()
	await expect(app.page.getByRole('heading', { name: 'Reports' })).toBeVisible()

	// Base report opens as its own webview page with the chrome bar.
	const showButtons = app.page.getByRole('button', { name: 'Показать отчет' })
	await showButtons.first().click()
	await expect.poll(() => app.windows.get('report-basic')).toBeDefined()
	const basicReport = app.windows.get('report-basic')!
	await expect(basicReport.getByRole('button', { name: '← Back' })).toBeVisible()
	await expect(basicReport.getByRole('button', { name: 'Close ✕' })).toBeVisible()
	// The base report groups by tag; an item with several tags renders in each column.
	await expect(basicReport.getByText('Item Alpha v2').first()).toBeVisible()

	// Re-clicking focuses the existing webview — no duplicate page.
	const pagesBefore = app.context.pages().length
	await showButtons.first().click()
	await expect
		.poll(async () => app.windows.get('report-basic') === basicReport && app.context.pages().length === pagesBefore)
		.toBe(true)

	// Relationships report opens separately and renders (canvas graph + sidebar).
	await showButtons.nth(1).click()
	await expect.poll(() => app.windows.get('report-relationships')).toBeDefined()
	const relReport = app.windows.get('report-relationships')!
	await expect(relReport.getByRole('button', { name: '← Back' })).toBeVisible()
	await expect(relReport.locator('canvas')).toBeVisible()
	await expect(relReport.getByText('Item Alpha v2').first()).toBeVisible()

	// Print media hides the report chrome bar.
	expect(await basicReport.locator('.report-chrome').evaluate((el) => getComputedStyle(el).display)).not.toBe('none')
	await basicReport.emulateMedia({ media: 'print' })
	await expect.poll(async () => basicReport.locator('.report-chrome').evaluate((el) => getComputedStyle(el).display)).toBe('none')
	await basicReport.emulateMedia({ media: 'screen' })

	// ← Back closes the report; the main window is untouched (still on the in-app Reports view).
	await basicReport.getByRole('button', { name: '← Back' }).click()
	await expect.poll(() => app.windows.has('report-basic')).toBe(false)
	await expect(app.page.getByRole('heading', { name: 'Reports' })).toBeVisible()

	// ✕ Close closes without touching the main window.
	await showButtons.first().click()
	await expect.poll(() => app.windows.get('report-basic')).toBeDefined()
	await app.windows.get('report-basic')!.getByRole('button', { name: 'Close ✕' }).click()
	await expect.poll(() => app.windows.has('report-basic')).toBe(false)

	// ReportsPage has no back-to-items control; path navigation is the app's own
	// mechanism (ItemsPage.openReportsPage). Return to items for the export/import tests.
	await app.page.evaluate(() => {
		window.location.pathname = '/'
	})
	await expect(app.page.getByRole('button', { name: 'Add', exact: true })).toBeVisible()
})

test('11. export v2: filename pattern, metadata, SHA-256 checksum of the data part', async () => {
	const [download] = await Promise.all([app.page.waitForEvent('download'), app.page.click('[aria-label="Export items"]')])
	const filePath = (await download.path())!
	const text = await readFile(filePath, 'utf8')
	const file = JSON.parse(text) as {
		metadata: { version: string; date: string; checksum: string }
		items: unknown[]
		timers: unknown[]
		itemTimerLinks: unknown[]
		itemLinks: unknown[]
	}

	expect(file.metadata.version).toBe('2')
	expect(download.suggestedFilename()).toMatch(/^items-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/)
	const dataPart = JSON.stringify({ items: file.items, timers: file.timers, itemTimerLinks: file.itemTimerLinks, itemLinks: file.itemLinks })
	const digest = createHash('sha256').update(dataPart).digest('hex')
	expect(digest).toBe(file.metadata.checksum)
	expect(file.items.length).toBe(2)

	await writeFile(path.join('/tmp/a22-s16', `exported-v2-${Date.now()}.json`), text)
})

test('12. import v2 round-trip: data replaced, pre-import backup snapshot written', async () => {
	const exports = (await readdirSync('/tmp/a22-s16')).filter((name) => name.startsWith('exported-v2-'))
	expect(exports.length).toBeGreaterThan(0)
	const exportedPath = path.join('/tmp/a22-s16', exports[exports.length - 1])

	const countsBefore = {
		items: await dbCount('items'),
		timers: await dbCount('timers'),
		links: await dbCount('item_links'),
		timerLinks: await dbCount('item_timer_links'),
	}
	await app.page.locator('input[type="file"]').setInputFiles(exportedPath)
	await expect(itemRows(app.page)).toHaveCount(countsBefore.items)

	await dbExpect(`SELECT COUNT(*) FROM items`, String(countsBefore.items))
	await dbExpect(`SELECT COUNT(*) FROM timers`, String(countsBefore.timers))
	await dbExpect(`SELECT COUNT(*) FROM item_links`, String(countsBefore.links))
	await dbExpect(`SELECT COUNT(*) FROM item_timer_links`, String(countsBefore.timerLinks))
	// Pre-import backup exists because data was present before the import.
	await dbExpect(`SELECT COUNT(*) FROM snapshots`, '1')
	const encoding = await dbQuery(`SELECT encoding FROM snapshots LIMIT 1`)
	expect(encoding).toMatch(/gzip-base64|plain/)
})

test('13. carry-over: v1 JSON import (label star → first matching entry), full replace', async () => {
	const v1 = {
		items: [
			{
				id: 'cv1',
				tags: ['carry'],
				infoEntries: [
					{ label: 'Title', value: 'Carry One' },
					{ label: 'Title', value: 'Dup Title' },
				],
				dateTimeEntries: [],
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-02T00:00:00.000Z',
				mainInfoField: 'Title',
			},
			{
				id: 'cv2',
				tags: ['carry', 'extra'],
				infoEntries: [{ label: 'Title', value: 'Carry Two' }],
				dateTimeEntries: [],
				createdAt: '2026-01-03T00:00:00.000Z',
				updatedAt: '2026-01-04T00:00:00.000Z',
			},
		],
		timers: [{ id: 'ct1', name: 'Carry Timer', baseAt: '2026-08-01T00:00:00.000Z', description: 'carried timer', isActive: true }],
		itemLinks: [{ id: 'cl1', itemId: 'cv1', targetId: 'cv2', type: 'related', createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' }],
		itemTimerLinks: [{
			id: 'ctl1',
			itemId: 'cv1',
			timerId: 'ct1',
			lastCheckedAt: '2026-08-01T00:00:00.000Z',
			createdAt: '2026-01-06T00:00:00.000Z',
			updatedAt: '2026-01-06T00:00:00.000Z',
		}],
		metadata: { version: '1', date: '2026-08-15T00:00:00.000Z', checksum: 'not-verified-by-design-q4' },
	}
	const v1Path = path.join('/tmp/a22-s16', `carryover-v1-${Date.now()}.json`)
	await writeFile(v1Path, JSON.stringify(v1))

	await app.page.locator('input[type="file"]').setInputFiles(v1Path)
	await expect(itemRows(app.page)).toHaveCount(2)
	await expect(itemRows(app.page).filter({ hasText: 'Carry One' })).toBeVisible()
	await expect(itemRows(app.page).filter({ hasText: 'Carry Two' })).toBeVisible()

	await dbExpect(`SELECT COUNT(*) FROM timers`, '1')
	await dbExpect(`SELECT COUNT(*) FROM item_timer_links`, '1')
	// Star resolved to the FIRST entry with label 'Title' (value 'Carry One').
	const cv1StarSql = `SELECT main_info_entry_id FROM items WHERE id = 'cv1'`
	await dbWaitNonEmpty(cv1StarSql)
	await dbExpect(`SELECT COUNT(*) FROM items`, '2')
	await dbExpect(`SELECT COUNT(*) FROM item_links`, '1')
	const starId = await dbQuery(cv1StarSql)
	await dbExpect(`SELECT value FROM item_info_entries WHERE id = '${starId}'`, 'Carry One')
	// Second pre-import backup accumulated.
	await dbExpect(`SELECT COUNT(*) FROM snapshots`, '2')
})

test('14. persistence: fresh web session loads the same data from a22.db', async () => {
	await closeAppContext(app)
	app = await createAppContext(browser)
	await expect(itemRows(app.page).filter({ hasText: 'Carry One' })).toBeVisible()
	await expect(itemRows(app.page)).toHaveCount(2)
	expect(await dbCount('items')).toBe(2)
})
