import type { DatabaseSnapshot, Item, ItemLink, ItemTimerLink, Timer } from '@/models/item/types'
import Dexie, { type EntityTable } from 'dexie'

class ItemDatabase extends Dexie {
	items!: EntityTable<Item, 'id'>
	timers!: EntityTable<Timer, 'id'>
	itemTimerLinks!: EntityTable<ItemTimerLink, 'id'>
	itemLinks!: EntityTable<ItemLink, 'id'>
	snapshots!: EntityTable<DatabaseSnapshot, 'id'>

	constructor() {
		super('item-base-db')
		this.version(1).stores({
			items: 'id, updatedAt, *tags',
			timers: 'id, updatedAt, name, isActive',
			itemTimerLinks: 'id, itemId, timerId, updatedAt',
			itemLinks: 'id, itemId, targetId, updatedAt',
			snapshots: 'id, createdAt, sourceVersion',
		})
	}
}

export const itemDb = new ItemDatabase()
