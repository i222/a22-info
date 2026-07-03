import type { ItemTimerLinkService } from '@/lib/item/ItemTimerLinkService'
import type { ItemTimerLink, ItemTimerLinkInput, ItemTimerLinkUpdateInput } from '@/models/item/types'
import { itemDb } from './db'

export class IndexedDbItemTimerLinkService implements ItemTimerLinkService {
	private async dedupeLinks(links: Array<ItemTimerLink>): Promise<Array<ItemTimerLink>> {
		const byPair = new Map<string, ItemTimerLink>()
		const duplicates: Array<ItemTimerLink> = []
		for (const link of links) {
			const key = `${link.itemId}::${link.timerId}`
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
			await Promise.all(duplicates.map((link) => itemDb.itemTimerLinks.delete(link.id)))
		}
		return Array.from(byPair.values())
	}

	async list(): Promise<Array<ItemTimerLink>> {
		const links = await itemDb.itemTimerLinks.toArray()
		return this.dedupeLinks(links)
	}

	async listByItemId(itemId: string): Promise<Array<ItemTimerLink>> {
		return itemDb.itemTimerLinks.where('itemId').equals(itemId).toArray()
	}

	async listByTimerId(timerId: string): Promise<Array<ItemTimerLink>> {
		return itemDb.itemTimerLinks.where('timerId').equals(timerId).toArray()
	}

	async create(input: ItemTimerLinkInput): Promise<ItemTimerLink> {
		const existing = await itemDb.itemTimerLinks
			.where('itemId')
			.equals(input.itemId)
			.filter((link) => link.timerId === input.timerId)
			.first()
		if (existing) {
			return existing
		}
		const now = new Date().toISOString()
		const link: ItemTimerLink = {
			...input,
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now,
		}
		await itemDb.itemTimerLinks.put(link)
		return link
	}

	async update(id: string, input: ItemTimerLinkUpdateInput): Promise<ItemTimerLink> {
		const previous = await itemDb.itemTimerLinks.get(id)
		if (!previous) {
			throw new Error(`ItemTimerLink ${id} not found`)
		}
		const updated: ItemTimerLink = {
			...previous,
			...input,
			id,
			itemId: previous.itemId,
			timerId: previous.timerId,
			createdAt: previous.createdAt,
			updatedAt: new Date().toISOString(),
		}
		await itemDb.itemTimerLinks.put(updated)
		return updated
	}

	async remove(id: string): Promise<void> {
		await itemDb.itemTimerLinks.delete(id)
	}

	async removeByTimerId(timerId: string): Promise<void> {
		await itemDb.transaction('rw', itemDb.itemTimerLinks, async () => {
			const links = await this.listByTimerId(timerId)
			await Promise.all(links.map((link) => itemDb.itemTimerLinks.delete(link.id)))
		})
	}
}

export const indexedDbItemTimerLinkService = new IndexedDbItemTimerLinkService()
