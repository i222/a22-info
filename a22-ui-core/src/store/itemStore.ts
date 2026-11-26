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
} from 'src/ui-core/models/item/types'
import * as commands from 'src/ui-core/platform/commands'
import type { TimerEngineStatus } from 'src/ui-core/platform/commands'
import { isTauri } from 'src/ui-core/platform/tauri'
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
	filteredItems: Array<Item>
	timerStatuses: Record<string, TimerEngineStatus>
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

// Stale `items_filter` responses are dropped by generation number: a new
// dataset load or query/tag change invalidates any in-flight result.
let filterGeneration = 0
// One store-owned 30 s `timers_statuses` ticker; components do not keep their
// own `now` state or intervals.
let statusIntervalId: ReturnType<typeof setInterval> | null = null

export const useItemStore = create<ItemStoreState>((set, get) => {
	async function refreshFilteredItems(): Promise<void> {
		const generation = ++filterGeneration
		try {
			const { searchQuery, selectedTags } = get()
			const filtered = await commands.itemsFilter(searchQuery, selectedTags)
			if (generation === filterGeneration) {
				set({ filteredItems: filtered })
			}
		} catch (error) {
			if (generation === filterGeneration) {
				set({ error: 'Failed to filter items.' })
				_dc('filter:error', error)
			}
		}
	}

	return {
		items: [],
		timers: [],
		itemTimerLinks: [],
		itemLinks: [],
		tags: [],
		infoLabelHints: [],
		relationshipTypeHints: [],
		filteredItems: [],
		timerStatuses: {},
		selectedTags: [],
		searchQuery: '',
		selectedItemId: null,
		isLoading: false,
		error: null,
		async load() {
			_dc('load:start')
			ensureStatusTicker()
			set({ isLoading: true, error: null })
			try {
				const dataset = await commands.dbLoadAll()
				set({
					items: dataset.items,
					timers: dataset.timers,
					itemTimerLinks: dataset.itemTimerLinks,
					itemLinks: dataset.itemLinks,
					tags: dataset.tags,
					infoLabelHints: dataset.infoLabelHints,
					relationshipTypeHints: dataset.relationshipTypeHints,
					isLoading: false,
				})
				await refreshFilteredItems()
				await refreshTimerStatuses()
				_dc('load:success', { items: dataset.items })
			} catch (error) {
				set({ isLoading: false, error: 'Failed to load items.' })
				_dc('load:error', error)
			}
		},
		async createItem(input) {
			_dc('create:start')
			await commands.itemsCreate(input)
			await get().load()
		},
		async updateItem(id, input) {
			_dc('update:start', id)
			await commands.itemsUpdate(id, input)
			await get().load()
		},
		async deleteItem(id) {
			_dc('delete:start', id)
			await commands.itemsDelete(id)
			const currentSelectedId = get().selectedItemId
			await get().load()
			if (currentSelectedId === id) {
				set({ selectedItemId: null })
			}
		},
		async createTimer(input) {
			const created = await commands.timersCreate(input)
			await get().load()
			return created
		},
		async updateTimer(id, input) {
			// An explicitly absent schedule (key present, value undefined) clears
			// it; the JSON wire needs `null` for that.
			const payload: TimerUpdateInput = { ...input }
			if ('schedule' in input && input.schedule === undefined) {
				payload.schedule = null
			}
			await commands.timersUpdate(id, payload)
			await get().load()
		},
		async deleteTimer(id) {
			await commands.timersDelete(id)
			await get().load()
		},
		async createItemTimerLink(input) {
			await commands.itemTimerLinksCreate(input)
			await get().load()
		},
		async updateItemTimerLink(id, input) {
			await commands.itemTimerLinksUpdate(id, input)
			await get().load()
		},
		async deleteItemTimerLink(id) {
			await commands.itemTimerLinksDelete(id)
			await get().load()
		},
		async cycleItemTimerLink(id, nowIso) {
			await commands.itemTimerLinkCycle(id, nowIso)
			await get().load()
		},
		setSelectedTags(tags) {
			set({ selectedTags: tags })
			void refreshFilteredItems()
		},
		setSearchQuery(searchQuery) {
			set({ searchQuery })
			void refreshFilteredItems()
		},
		setSelectedItemId(id) {
			set({ selectedItemId: id })
		},
	}
})

// Refreshes `timerStatuses` from Rust; a failed tick keeps the last good
// statuses (the next tick or any mutation-triggered load retries).
async function refreshTimerStatuses(): Promise<void> {
	try {
		const statuses = await commands.timersStatuses()
		useItemStore.setState({ timerStatuses: statuses })
	} catch (error) {
		_dc('statuses:error', error)
	}
}

function ensureStatusTicker(): void {
	if (statusIntervalId !== null || !isTauri()) return
	statusIntervalId = setInterval(() => {
		void refreshTimerStatuses()
	}, 30 * 1000)
}

export function useFilteredItems(): Array<Item> {
	return useItemStore((state) => state.filteredItems)
}
