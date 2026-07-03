import type { ItemService } from '@/lib/item/ItemService'
import { createItemPayload, createItemUpdatePayload } from '@/models/item/helpers'
import { infoLabelDefaults, type Item, type ItemInput, itemTagsDefaults, type ItemUpdateInput, relationshipTypeDefaults } from '@/models/item/types'
import { sortBy, uniq } from 'lodash-es'
import { itemDb } from './db'
import { indexedDbItemTimerLinkService } from './IndexedDbItemTimerLinkService'
import { indexedDbTimerService } from './IndexedDbTimerService'

export class IndexedDbItemService implements ItemService {
	private normalizeStoredItem(item: Item): Item {
		const payload = createItemPayload({
			mainInfoField: item.mainInfoField,
			tags: item.tags ?? [],
			infoEntries: item.infoEntries ?? [],
			dateTimeEntries: item.dateTimeEntries ?? [],
		})
		return {
			...item,
			...payload,
		}
	}

	private async migrateLegacyTimers(items: Array<Item>): Promise<void> {
		const shouldMigrate = items.some((item) => Array.isArray((item as Item & { timers?: unknown }).timers) && (item as Item & { timers?: Array<unknown> }).timers?.length)
		if (!shouldMigrate) {
			return
		}
		for (const item of items) {
			const rawItem = item as Item & { timers?: Array<unknown> }
			const legacyTimers = (rawItem.timers ?? []) as Array<{
				id?: string
				baseAt?: string
				description?: string
				isActive?: boolean
				schedule?: { every: number; unit: 'hours' | 'days' | 'weeks' | 'months' | 'years' }
				lastCheckedAt?: string
			}>
			for (const legacyTimer of legacyTimers) {
				if (!legacyTimer.baseAt || !legacyTimer.description) {
					continue
				}
				const createdTimer = await indexedDbTimerService.create({
					name: legacyTimer.description.trim().slice(0, 48) || 'Timer',
					baseAt: legacyTimer.baseAt,
					description: legacyTimer.description,
					isActive: legacyTimer.isActive ?? true,
					schedule: legacyTimer.schedule,
				})
				await indexedDbItemTimerLinkService.create({
					itemId: item.id,
					timerId: createdTimer.id,
					lastCheckedAt: legacyTimer.lastCheckedAt ?? new Date(0).toISOString(),
				})
			}
			if (Array.isArray(rawItem.timers) && rawItem.timers.length > 0) {
				const { timers: _legacyTimers, ...nextItem } = rawItem
				await itemDb.items.put(nextItem)
			}
		}
	}

	async list(): Promise<Array<Item>> {
		const items = await itemDb.items.toArray()
		await this.migrateLegacyTimers(items)
		return sortBy(items.map((item) => this.normalizeStoredItem(item)), (item) => item.updatedAt).reverse()
	}

	async getById(id: string): Promise<Item | undefined> {
		const item = await itemDb.items.get(id)
		return item ? this.normalizeStoredItem(item) : undefined
	}

	async create(input: ItemInput): Promise<Item> {
		const normalized = createItemPayload(input)
		const now = new Date().toISOString()
		const item: Item = {
			...normalized,
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now,
		}
		await itemDb.items.put(item)
		return item
	}

	async update(id: string, input: ItemUpdateInput): Promise<Item> {
		const previous = await itemDb.items.get(id)
		if (!previous) {
			throw new Error(`Item ${id} not found`)
		}
		const normalized = createItemUpdatePayload(input)
		const updated: Item = {
			...previous,
			...normalized,
			id,
			createdAt: previous.createdAt,
			updatedAt: new Date().toISOString(),
		}
		await itemDb.items.put(updated)
		return updated
	}

	async remove(id: string): Promise<void> {
		await itemDb.items.delete(id)
	}

	async listTags(): Promise<Array<string>> {
		const items = await itemDb.items.toArray()
		return sortBy(
			uniq([...itemTagsDefaults, ...items.flatMap((item) => item.tags).filter(Boolean)]),
			(tag) => tag,
		)
	}

	async listInfoLabels(): Promise<Array<string>> {
		const items = await itemDb.items.toArray()
		return sortBy(
			uniq([...infoLabelDefaults, ...items.flatMap((item) => item.infoEntries.map((entry) => entry.label)).filter(Boolean)]),
			(label) => label,
		)
	}

	async listRelationshipTypes(): Promise<Array<string>> {
		const links = await itemDb.itemLinks.toArray()
		return sortBy(
			uniq([...relationshipTypeDefaults, ...links.map((link) => link.type).filter(Boolean)]),
			(type) => type,
		)
	}
}

export const indexedDbItemService = new IndexedDbItemService()
