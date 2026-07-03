import { uniq } from 'lodash-es'
import type { DateTimeEntry, InfoEntry, Item, ItemInput, ItemUpdateInput } from './types'

function sanitizeText(value: string): string {
	return value.trim()
}

function normalizeTags(tags: Array<string>): Array<string> {
	return uniq(tags.map((tag) => sanitizeText(tag).toLowerCase()).filter(Boolean))
}

function normalizeInfoEntries(infoEntries: Array<{ label: string; value: string }>): ItemInput['infoEntries'] {
	return infoEntries
		.map((entry) => ({
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

function normalizeMainInfoField(mainInfoField: string | undefined, infoEntries: ItemInput['infoEntries']): string | undefined {
	if (typeof mainInfoField !== 'string') {
		return undefined
	}
	const normalized = sanitizeText(mainInfoField)
	if (normalized.length === 0) {
		return undefined
	}
	return infoEntries.some((entry) => entry.label === normalized) ? normalized : undefined
}

export function createItemPayload(input: ItemInput): ItemInput {
	const infoEntries = normalizeInfoEntries(input.infoEntries)
	return {
		...input,
		tags: normalizeTags(input.tags),
		infoEntries,
		dateTimeEntries: normalizeDateTimeEntries(input.dateTimeEntries),
		mainInfoField: normalizeMainInfoField(input.mainInfoField, infoEntries),
	}
}

export function createItemUpdatePayload(input: ItemUpdateInput): ItemUpdateInput {
	const normalized: ItemUpdateInput = { ...input }
	if (input.tags) {
		normalized.tags = normalizeTags(input.tags)
	}
	if (input.infoEntries) {
		normalized.infoEntries = normalizeInfoEntries(input.infoEntries)
	}
	if (typeof input.mainInfoField === 'string' || input.mainInfoField === undefined) {
		normalized.mainInfoField = input.mainInfoField ? sanitizeText(input.mainInfoField) || undefined : undefined
	}
	if (input.dateTimeEntries) {
		normalized.dateTimeEntries = normalizeDateTimeEntries(input.dateTimeEntries)
	}
	if (normalized.infoEntries) {
		normalized.mainInfoField = normalizeMainInfoField(normalized.mainInfoField, normalized.infoEntries)
	}
	return normalized
}

export function hasAllTags(item: Item, selectedTags: Array<string>): boolean {
	if (selectedTags.length === 0) {
		return true
	}
	return selectedTags.every((tag) => item.tags.includes(tag))
}

function resolveDisplayInfoEntry(item: Item): InfoEntry | undefined {
	const mainEntry = item.mainInfoField ? item.infoEntries.find((entry) => entry.label === item.mainInfoField) : undefined
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
