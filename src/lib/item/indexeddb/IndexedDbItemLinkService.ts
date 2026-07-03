import type { ItemLinkService } from '@/lib/item/ItemLinkService'
import type { ItemLink, ItemLinkInput, ItemLinkUpdateInput } from '@/models/item/types'
import { itemDb } from './db'

export class IndexedDbItemLinkService implements ItemLinkService {
	private async dedupeLinks(links: Array<ItemLink>): Promise<Array<ItemLink>> {
		const byPair = new Map<string, ItemLink>()
		const duplicates: Array<ItemLink> = []
		for (const link of links) {
			const key = `${link.itemId}::${link.targetId}::${link.type}`
			const existing = byPair.get(key)
			if (!existing) {
				byPair.set(key, link)
				continue
			}
			const keep = existing.updatedAt >= link.updatedAt ? existing : link
			const drop = keep.id === existing.id ? link : existing
			byPair.set(key, keep)
			duplicates.push(drop)
		}
		if (duplicates.length > 0) {
			await Promise.all(duplicates.map((link) => itemDb.itemLinks.delete(link.id)))
		}
		return Array.from(byPair.values())
	}

	async list(): Promise<Array<ItemLink>> {
		const links = await itemDb.itemLinks.toArray()
		return this.dedupeLinks(links)
	}

	async listByItemId(itemId: string): Promise<Array<ItemLink>> {
		return itemDb.itemLinks.where('itemId').equals(itemId).toArray()
	}

	async create(input: ItemLinkInput): Promise<ItemLink> {
		const existing = await itemDb.itemLinks
			.where('itemId')
			.equals(input.itemId)
			.filter((link) => link.targetId === input.targetId && link.type === input.type)
			.first()
		if (existing) {
			return existing
		}
		const now = new Date().toISOString()
		const link: ItemLink = {
			...input,
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now,
		}
		await itemDb.itemLinks.put(link)
		return link
	}

	async update(id: string, input: ItemLinkUpdateInput): Promise<ItemLink> {
		const previous = await itemDb.itemLinks.get(id)
		if (!previous) {
			throw new Error(`ItemLink ${id} not found`)
		}
		const updated: ItemLink = {
			...previous,
			...input,
			id,
			itemId: previous.itemId,
			targetId: previous.targetId,
			createdAt: previous.createdAt,
			updatedAt: new Date().toISOString(),
		}
		await itemDb.itemLinks.put(updated)
		return updated
	}

	async remove(id: string): Promise<void> {
		await itemDb.itemLinks.delete(id)
	}

	async removeByItemId(itemId: string): Promise<void> {
		await itemDb.transaction('rw', itemDb.itemLinks, async () => {
			const links = await itemDb.itemLinks
				.filter((link) => link.itemId === itemId || link.targetId === itemId)
				.toArray()
			await Promise.all(links.map((link) => itemDb.itemLinks.delete(link.id)))
		})
	}
}

export const indexedDbItemLinkService = new IndexedDbItemLinkService()
