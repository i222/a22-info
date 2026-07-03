import type { Item, ItemLink, ItemTimerLink, Timer } from '@/models/item/types'
import { itemDb } from './db'
import { createDatabaseSnapshot, saveSnapshot } from './snapshots'

export type ImportData = {
	items: Array<Item>
	timers: Array<Timer>
	itemLinks: Array<ItemLink>
	itemTimerLinks: Array<ItemTimerLink>
	sourceVersion: string
}

const IMPORT_LOG_PREFIX = '[Import]'

export async function executeDatabaseImport(data: ImportData): Promise<void> {
	if (!itemDb.isOpen()) {
		await itemDb.open()
	}
	const hasSnapshotsTable = itemDb.tables.some((table) => table.name === 'snapshots')

	// 1. Create backup snapshot only if there is data
	let archiveSnapshot = null
	console.log(IMPORT_LOG_PREFIX, 'Checking existing data for backup...')
	const existingItemCount = await itemDb.items.count()
	const existingTimerCount = await itemDb.timers.count()
	console.log(IMPORT_LOG_PREFIX, `Existing data: ${existingItemCount} items, ${existingTimerCount} timers`)

	if (existingItemCount > 0 || existingTimerCount > 0) {
		try {
			console.log(IMPORT_LOG_PREFIX, 'Creating pre-import backup snapshot...')
			archiveSnapshot = await createDatabaseSnapshot(data.sourceVersion)
			console.log(IMPORT_LOG_PREFIX, 'Backup snapshot created successfully')
		} catch (error) {
			console.error(IMPORT_LOG_PREFIX, 'Failed to create pre-import backup:', error)
		}
	}

	const transactionTables = hasSnapshotsTable
		? [itemDb.items, itemDb.timers, itemDb.itemLinks, itemDb.itemTimerLinks, itemDb.snapshots]
		: [itemDb.items, itemDb.timers, itemDb.itemLinks, itemDb.itemTimerLinks]

	console.log(IMPORT_LOG_PREFIX, 'Starting transaction...')
	await itemDb.transaction('rw', transactionTables, async () => {
		// 2. Save backup if created
		if (hasSnapshotsTable && archiveSnapshot) {
			console.log(IMPORT_LOG_PREFIX, 'Saving backup snapshot to database...')
			await saveSnapshot(archiveSnapshot)
		}

		// 3. Clear existing data
		console.log(IMPORT_LOG_PREFIX, 'Clearing existing data...')
		await Promise.all([
			itemDb.items.clear(),
			itemDb.timers.clear(),
			itemDb.itemLinks.clear(),
			itemDb.itemTimerLinks.clear(),
		])

		// 4. Insert new data
		console.log(IMPORT_LOG_PREFIX, `Inserting new data: ${data.items.length} items, ${data.timers.length} timers...`)
		if (data.items.length > 0) {
			await itemDb.items.bulkPut(data.items)
		}
		if (data.timers.length > 0) {
			await itemDb.timers.bulkPut(data.timers)
		}
		if (data.itemLinks.length > 0) {
			await itemDb.itemLinks.bulkPut(data.itemLinks)
		}
		if (data.itemTimerLinks.length > 0) {
			await itemDb.itemTimerLinks.bulkPut(data.itemTimerLinks)
		}
		console.log(IMPORT_LOG_PREFIX, 'Transaction completed successfully')
	})
	console.log(IMPORT_LOG_PREFIX, 'Import procedure finished')
}
