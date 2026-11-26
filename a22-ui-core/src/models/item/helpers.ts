import { uniq } from 'lodash-es'
import type { DateTimeEntry, InfoEntry, Item, ItemInput } from './types'

function sanitizeText(value: string): string {
	return value.trim()
}

function normalizeTags(tags: Array<string>): Array<string> {
	return uniq(tags.map((tag) => sanitizeText(tag).toLowerCase()).filter(Boolean))
}

function normalizeInfoEntries(infoEntries: Array<InfoEntry>): ItemInput['infoEntries'] {
	return infoEntries
		.map((entry) => ({
			id: entry.id,
			label: sanitizeText(entry.label),
			value: sanitizeText(entry.value),
		}))
		.filter((entry) => entry.label.length > 0 && entry.value.length > 0)
}

function normalizeDateTimeEntries(dateTimeEntries: Array<DateTimeEntry> | undefined): ItemInput['dateTimeEntries'] {
	if (!dateTimeEntries) {
		return []
	}
	return dateTimeEntries
		.map((field) => ({
			label: sanitizeText(field.label),
			value: Number.isFinite(field.value) ? Math.floor(field.value) : Number.NaN,
		}))
		.filter((field) => field.label.length > 0 && Number.isFinite(field.value))
}

// Tri-state star normalization: `null` = explicit clear, absent stays absent,
// empty or non-matching id = clear (the editor always submits full form state).
function normalizeMainInfoEntryId(mainInfoEntryId: string | null | undefined, infoEntries: ItemInput['infoEntries']): string | null | undefined {
	if (mainInfoEntryId === null) {
		return null
	}
	if (typeof mainInfoEntryId !== 'string') {
		return undefined
	}
	const normalized = sanitizeText(mainInfoEntryId)
	if (normalized.length === 0) {
		return null
	}
	return infoEntries.some((entry) => entry.id === normalized) ? normalized : null
}

export function createItemPayload(input: ItemInput): ItemInput {
	const infoEntries = normalizeInfoEntries(input.infoEntries)
	return {
		...input,
		tags: normalizeTags(input.tags),
		infoEntries,
		dateTimeEntries: normalizeDateTimeEntries(input.dateTimeEntries),
		mainInfoEntryId: normalizeMainInfoEntryId(input.mainInfoEntryId, infoEntries),
	}
}

function resolveDisplayInfoEntry(item: Item): InfoEntry | undefined {
	const mainEntry = item.mainInfoEntryId ? item.infoEntries.find((entry) => entry.id === item.mainInfoEntryId) : undefined
	if (mainEntry) {
		return mainEntry
	}
	const titleEntry = item.infoEntries.find((entry) => entry.label.toLowerCase() === 'title')
	if (titleEntry) {
		return titleEntry
	}
	return item.infoEntries[0]
}

export function getItemDisplayTitle(item: Item): string {
	const displayEntry = resolveDisplayInfoEntry(item)
	if (!displayEntry) {
		return '-'
	}
	return `${displayEntry.label}: ${displayEntry.value}`
}

export function getItemDisplayValue(item: Item): string {
	const displayEntry = resolveDisplayInfoEntry(item)
	return displayEntry?.value ?? '-'
}

export { formatTimerBaseAt } from './timerLogic'

export function hasAllTags(item: Item, selectedTags: Array<string>): boolean {
	if (selectedTags.length === 0) {
		return true
	}
	return selectedTags.every((tag) => item.tags.includes(tag))
}
