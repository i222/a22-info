import { indexedDbItemLinkService } from '@/lib/item/indexeddb/IndexedDbItemLinkService'
import { indexedDbItemService } from '@/lib/item/indexeddb/IndexedDbItemService'
import { indexedDbItemTimerLinkService } from '@/lib/item/indexeddb/IndexedDbItemTimerLinkService'
import { indexedDbTimerService } from '@/lib/item/indexeddb/IndexedDbTimerService'
import { getItemDisplayValue, hasAllTags } from '@/models/item/helpers'
import { getTimerCycleNextCheckedAt } from '@/models/item/timerLogic'
import type {
	Item,
	ItemInput,
	ItemLink,
	ItemTimerLink,
	ItemTimerLinkInput,
	ItemTimerLinkUpdateInput,
	ItemUpdateInput,
	Timer,
	TimerInput,
	TimerUpdateInput,
} from '@/models/item/types'
import { create } from 'zustand'

const _b = '[Store]'
const _dc: typeof console.log = (...arg) => console.log(_b, ...arg)

interface ItemStoreState {
	items: Array<Item>
	timers: Array<Timer>
	itemTimerLinks: Array<ItemTimerLink>
	itemLinks: Array<ItemLink>
	tags: Array<string>
	infoLabelHints: Array<string>
	relationshipTypeHints: Array<string>
	selectedTags: Array<string>
	searchQuery: string
	selectedItemId: string | null
	isLoading: boolean
	error: string | null
	load: () => Promise<void>
	createItem: (input: ItemInput) => Promise<void>
	updateItem: (id: string, input: ItemUpdateInput) => Promise<void>
	deleteItem: (id: string) => Promise<void>
	createTimer: (input: TimerInput) => Promise<Timer>
	updateTimer: (id: string, input: TimerUpdateInput) => Promise<void>
	deleteTimer: (id: string) => Promise<void>
	createItemTimerLink: (input: ItemTimerLinkInput) => Promise<void>
	updateItemTimerLink: (id: string, input: ItemTimerLinkUpdateInput) => Promise<void>
	deleteItemTimerLink: (id: string) => Promise<void>
	cycleItemTimerLink: (id: string, nowIso?: string) => Promise<void>
	setSelectedTags: (tags: Array<string>) => void
	setSearchQuery: (query: string) => void
	setSelectedItemId: (id: string | null) => void
}

function matchesItemSearch(
	item: Item,
	timersById: Map<string, Timer>,
	itemTimerLinks: Array<ItemTimerLink>,
	itemLinks: Array<ItemLink>,
	itemById: Map<string, Item>,
	rawSearchQuery: string,
): boolean {
	const searchQuery = rawSearchQuery.trim().toLowerCase()
	if (searchQuery.length === 0) {
		return true
	}

	const itemTimerValues = itemTimerLinks
		.filter((link) => link.itemId === item.id)
		.flatMap((link) => {
			const timer = timersById.get(link.timerId)
			if (!timer) {
				return []
			}
			return [timer.name, timer.baseAt, timer.description, timer.isActive ? 'active' : 'inactive', link.lastCheckedAt]
		})

	const itemLinkValues = itemLinks
		.filter((link) => link.itemId === item.id)
		.flatMap((link) => {
			const target = itemById.get(link.targetId)
			const targetName = target ? getItemDisplayValue(target) : ''
			return [link.type, link.targetId, targetName]
		})

	const searchableValues: Array<string> = [
		item.id,
		item.mainInfoField ?? '',
		item.createdAt,
		item.updatedAt,
		...item.infoEntries.flatMap((entry) => [entry.label, entry.value]),
		...item.dateTimeEntries.flatMap((field) => [field.label, String(field.value)]),
		...itemLinkValues,
		...itemTimerValues,
	]

	return searchableValues.some((value) => value.toLowerCase().includes(searchQuery))
}

export const useItemStore = create<ItemStoreState>((set, get) => ({
	items: [],
	timers: [],
	itemTimerLinks: [],
	itemLinks: [],
	tags: [],
	infoLabelHints: [],
	relationshipTypeHints: [],
	selectedTags: [],
	searchQuery: '',
	selectedItemId: null,
	isLoading: false,
	error: null,
	async load() {
		_dc('load:start')
		set({ isLoading: true, error: null })
		try {
			const [items, timers, itemTimerLinks, itemLinks, tags, infoLabelHints, relationshipTypeHints] = await Promise.all([
				indexedDbItemService.list(),
				indexedDbTimerService.list(),
				indexedDbItemTimerLinkService.list(),
				indexedDbItemLinkService.list(),
				indexedDbItemService.listTags(),
				indexedDbItemService.listInfoLabels(),
				indexedDbItemService.listRelationshipTypes(),
			])
			set({ items, timers, itemTimerLinks, itemLinks, tags, infoLabelHints, relationshipTypeHints, isLoading: false })
			_dc('load:success', { items }) // , itemCount: items.length, tagCount: tags.length, infoLabelHintCount: infoLabelHints.length, relationshipTypeHintCount: relationshipTypeHints.length })
		} catch (error) {
			set({ isLoading: false, error: 'Failed to load items.' })
			_dc('load:error', error)
		}
	},
	async createItem(input) {
		_dc('create:start')
		const { relationships, ...itemInput } = input
		const created = await indexedDbItemService.create(itemInput)
		if (relationships && relationships.length > 0) {
			await Promise.all(
				relationships.map((rel) =>
					indexedDbItemLinkService.create({
						itemId: created.id,
						targetId: rel.targetId,
						type: rel.type,
					})
				),
			)
		}
		await get().load()
	},
	async updateItem(id, input) {
		_dc('update:start', id)
		const { relationships, ...itemInput } = input
		await indexedDbItemService.update(id, itemInput)
		if (relationships) {
			await indexedDbItemLinkService.removeByItemId(id)
			await Promise.all(
				relationships.map((rel) =>
					indexedDbItemLinkService.create({
						itemId: id,
						targetId: rel.targetId,
						type: rel.type,
					})
				),
			)
		}
		await get().load()
	},
	async deleteItem(id) {
		_dc('delete:start', id)
		await indexedDbItemService.remove(id)
		await indexedDbItemLinkService.removeByItemId(id)
		const currentSelectedId = get().selectedItemId
		await get().load()
		if (currentSelectedId === id) {
			set({ selectedItemId: null })
		}
	},
	async createTimer(input) {
		const created = await indexedDbTimerService.create(input)
		await get().load()
		return created
	},
	async updateTimer(id, input) {
		await indexedDbTimerService.update(id, input)
		await get().load()
	},
	async deleteTimer(id) {
		await indexedDbTimerService.remove(id)
		await indexedDbItemTimerLinkService.removeByTimerId(id)
		await get().load()
	},
	async createItemTimerLink(input) {
		await indexedDbItemTimerLinkService.create(input)
		await get().load()
	},
	async updateItemTimerLink(id, input) {
		await indexedDbItemTimerLinkService.update(id, input)
		await get().load()
	},
	async deleteItemTimerLink(id) {
		await indexedDbItemTimerLinkService.remove(id)
		await get().load()
	},
	async cycleItemTimerLink(id, nowIso) {
		const state = get()
		const link = state.itemTimerLinks.find((entry) => entry.id === id)
		if (!link) {
			return
		}
		const timer = state.timers.find((entry) => entry.id === link.timerId)
		if (!timer) {
			return
		}
		const now = nowIso ? new Date(nowIso) : new Date()
		await indexedDbItemTimerLinkService.update(id, {
			lastCheckedAt: getTimerCycleNextCheckedAt(timer, link, now),
		})
		await get().load()
	},
	setSelectedTags(tags) {
		set({ selectedTags: tags })
	},
	setSearchQuery(searchQuery) {
		set({ searchQuery })
	},
	setSelectedItemId(id) {
		set({ selectedItemId: id })
	},
}))

export function useFilteredItems(): Array<Item> {
	const items = useItemStore((state) => state.items)
	const timers = useItemStore((state) => state.timers)
	const itemTimerLinks = useItemStore((state) => state.itemTimerLinks)
	const itemLinks = useItemStore((state) => state.itemLinks)
	const selectedTags = useItemStore((state) => state.selectedTags)
	const searchQuery = useItemStore((state) => state.searchQuery)
	const timersById = new Map(timers.map((timer) => [timer.id, timer]))
	const itemById = new Map(items.map((item) => [item.id, item]))
	return items.filter((item) => hasAllTags(item, selectedTags) && matchesItemSearch(item, timersById, itemTimerLinks, itemLinks, itemById, searchQuery))
}
