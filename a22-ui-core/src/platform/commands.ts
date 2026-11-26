import type { TimerVisualState } from '../models/item/timerLogic'
import type {
	Item,
	ItemInput,
	ItemLink,
	ItemTimerLink,
	ItemTimerLinkInput,
	ItemTimerLinkUpdateInput,
	ItemUpdateInput,
	Tag,
	Timer,
	TimerInput,
	TimerUpdateInput,
} from '../models/item/types'
import { invoke } from './tauri'

/** `db_load_all` result — the single round-trip that replaced the previous 7 parallel storage reads. */
export type LoadAll = {
	items: Array<Item>
	timers: Array<Timer>
	itemLinks: Array<ItemLink>
	itemTimerLinks: Array<ItemTimerLink>
	tags: Array<Tag>
	infoLabelHints: Array<string>
	relationshipTypeHints: Array<string>
}

/** Raw engine status without label text (labels stay in the TS view model). */
export type TimerEngineStatus = {
	visualState: TimerVisualState
	/** Unix milliseconds; absent when not applicable. */
	nextRunAt?: number
	/** Unix milliseconds; absent when not applicable. */
	lastRunAt?: number
}

/** `export_snapshot` result — full file content plus the download name. */
export type ExportedFile = {
	json: string
	filename: string
}

/** `import_snapshot` result — imported counts plus per-row warnings. */
export type ImportSummary = {
	items: number
	timers: number
	itemLinks: number
	itemTimerLinks: number
	warnings: Array<string>
}

export const dbLoadAll = (): Promise<LoadAll> => invoke('db_load_all')

export const itemsCreate = (input: ItemInput): Promise<Item> => invoke('items_create', { input })

export const itemsUpdate = (id: string, input: ItemUpdateInput): Promise<Item> => invoke('items_update', { id, input })

export const itemsDelete = (id: string): Promise<void> => invoke('items_delete', { id })

export const timersCreate = (input: TimerInput): Promise<Timer> => invoke('timers_create', { input })

export const timersUpdate = (id: string, input: TimerUpdateInput): Promise<Timer> => invoke('timers_update', { id, input })

export const timersDelete = (id: string): Promise<void> => invoke('timers_delete', { id })

export const itemTimerLinksCreate = (input: ItemTimerLinkInput): Promise<ItemTimerLink> => invoke('item_timer_links_create', { input })

export const itemTimerLinksUpdate = (id: string, input: ItemTimerLinkUpdateInput): Promise<ItemTimerLink> => invoke('item_timer_links_update', { id, input })

export const itemTimerLinksDelete = (id: string): Promise<void> => invoke('item_timer_links_delete', { id })

/** `null` when the link or its timer is missing; Rust treats this as a no-op. */
export const itemTimerLinkCycle = (linkId: string, nowIso?: string): Promise<ItemTimerLink | null> => invoke('item_timer_link_cycle', { linkId, nowIso })

export const itemsFilter = (query: string, tags: Array<Tag>): Promise<Array<Item>> => invoke('items_filter', { query, tags })

/** Raw engine status per item-timer link id. */
export const timersStatuses = (nowIso?: string): Promise<Record<string, TimerEngineStatus>> => invoke('timers_statuses', { nowIso })

export const exportSnapshot = (): Promise<ExportedFile> => invoke('export_snapshot')

export const importSnapshot = (rawJson: string): Promise<ImportSummary> => invoke('import_snapshot', { rawJson })
