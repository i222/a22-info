import { createItemPayload } from '@/models/item/helpers'
import type { Item, ItemLink, ItemTimerLink, Timer, TimerIntervalUnit } from '@/models/item/types'
import { executeDatabaseImport, type ImportData } from './import'

const IMPORT_LOG_PREFIX = '[ImportV1]'
const DEFAULT_TIMER_NAME = 'Timer'
const DEFAULT_RELATIONSHIP_TYPE = 'related'
const TIMER_UNITS: Array<TimerIntervalUnit> = ['hours', 'days', 'weeks', 'months', 'years']

type ImportV1Payload = {
	metadata?: {
		version?: unknown
		date?: unknown
		checksum?: unknown
	}
	items?: unknown
	timers?: unknown
	itemLinks?: unknown
	itemTimerLinks?: unknown
}

type ImportV1ValidationResult = {
	items: Array<Item>
	timers: Array<Timer>
	itemLinks: Array<ItemLink>
	itemTimerLinks: Array<ItemTimerLink>
	errors: Array<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function toTrimmedString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function toIsoOrDefault(value: unknown, fallbackIso: string): string {
	const raw = toTrimmedString(value)
	if (!raw) {
		return fallbackIso
	}
	const parsed = new Date(raw)
	return Number.isNaN(parsed.getTime()) ? fallbackIso : parsed.toISOString()
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value
	}
	return null
}

function isTimerUnit(value: unknown): value is TimerIntervalUnit {
	return typeof value === 'string' && TIMER_UNITS.includes(value as TimerIntervalUnit)
}

function decodeImportPayload(rawPayload: string): ImportV1Payload {
	try {
		const parsed: unknown = JSON.parse(rawPayload)
		if (!isRecord(parsed)) {
			throw new Error('Payload root must be an object.')
		}
		return parsed as ImportV1Payload
	} catch (error) {
		throw new Error(`Failed to parse import file: ${error instanceof Error ? error.message : String(error)}`)
	}
}

function mapItems(rawItems: unknown, errors: Array<string>): Array<Item> {
	if (!Array.isArray(rawItems)) {
		errors.push('`items` is not an array, skipped.')
		return []
	}
	const nowIso = new Date().toISOString()
	const usedIds = new Set<string>()
	const mapped: Array<Item> = []
	for (const [index, raw] of rawItems.entries()) {
		if (!isRecord(raw)) {
			errors.push(`items[${index}] is not an object, skipped.`)
			continue
		}
		const itemId = toTrimmedString(raw.id) || crypto.randomUUID()
		if (usedIds.has(itemId)) {
			errors.push(`items[${index}] duplicate id "${itemId}", skipped duplicate.`)
			continue
		}
		usedIds.add(itemId)
		const mappedPayload = createItemPayload({
			mainInfoField: toTrimmedString(raw.mainInfoField) || undefined,
			tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
			infoEntries: Array.isArray(raw.infoEntries)
				? raw.infoEntries
					.filter((entry): entry is { label: string; value: string } => isRecord(entry))
					.map((entry) => ({
						label: toTrimmedString(entry.label),
						value: toTrimmedString(entry.value),
					}))
				: [],
			dateTimeEntries: Array.isArray(raw.dateTimeEntries)
				? raw.dateTimeEntries
					.filter((entry): entry is { label: string; value: number } => isRecord(entry))
					.map((entry) => ({
						label: toTrimmedString(entry.label),
						value: typeof entry.value === 'number' ? entry.value : Number.NaN,
					}))
				: [],
		})
		mapped.push({
			id: itemId,
			mainInfoField: mappedPayload.mainInfoField,
			tags: mappedPayload.tags,
			infoEntries: mappedPayload.infoEntries,
			dateTimeEntries: mappedPayload.dateTimeEntries,
			createdAt: toIsoOrDefault(raw.createdAt, nowIso),
			updatedAt: toIsoOrDefault(raw.updatedAt, nowIso),
		})
	}
	return mapped
}

function mapTimers(rawTimers: unknown, errors: Array<string>): Array<Timer> {
	if (!Array.isArray(rawTimers)) {
		errors.push('`timers` is not an array, skipped.')
		return []
	}
	const nowIso = new Date().toISOString()
	const usedIds = new Set<string>()
	const mapped: Array<Timer> = []
	for (const [index, raw] of rawTimers.entries()) {
		if (!isRecord(raw)) {
			errors.push(`timers[${index}] is not an object, skipped.`)
			continue
		}
		const timerId = toTrimmedString(raw.id) || crypto.randomUUID()
		if (usedIds.has(timerId)) {
			errors.push(`timers[${index}] duplicate id "${timerId}", skipped duplicate.`)
			continue
		}
		usedIds.add(timerId)
		const description = toTrimmedString(raw.description)
		const name = toTrimmedString(raw.name) || description.slice(0, 48) || DEFAULT_TIMER_NAME
		let schedule: Timer['schedule']
		if (isRecord(raw.schedule)) {
			const every = toFiniteNumber(raw.schedule.every)
			const unit = raw.schedule.unit
			if (every !== null && every > 0 && isTimerUnit(unit)) {
				schedule = { every: Math.floor(every), unit }
			} else {
				errors.push(`timers[${index}] has invalid schedule, schedule removed.`)
			}
		}
		mapped.push({
			id: timerId,
			name,
			baseAt: toIsoOrDefault(raw.baseAt, nowIso),
			description,
			isActive: typeof raw.isActive === 'boolean' ? raw.isActive : true,
			schedule,
			createdAt: toIsoOrDefault(raw.createdAt, nowIso),
			updatedAt: toIsoOrDefault(raw.updatedAt, nowIso),
		})
	}
	return mapped
}

function mapItemLinks(rawItemLinks: unknown, errors: Array<string>): Array<ItemLink> {
	if (!Array.isArray(rawItemLinks)) {
		errors.push('`itemLinks` is not an array, skipped.')
		return []
	}
	const nowIso = new Date().toISOString()
	const mapped: Array<ItemLink> = []
	for (const [index, raw] of rawItemLinks.entries()) {
		if (!isRecord(raw)) {
			errors.push(`itemLinks[${index}] is not an object, skipped.`)
			continue
		}
		const itemId = toTrimmedString(raw.itemId)
		const targetId = toTrimmedString(raw.targetId)
		if (!itemId || !targetId) {
			errors.push(`itemLinks[${index}] missing itemId or targetId, removed.`)
			continue
		}
		mapped.push({
			id: toTrimmedString(raw.id) || crypto.randomUUID(),
			itemId,
			targetId,
			type: toTrimmedString(raw.type) || DEFAULT_RELATIONSHIP_TYPE,
			createdAt: toIsoOrDefault(raw.createdAt, nowIso),
			updatedAt: toIsoOrDefault(raw.updatedAt, nowIso),
		})
	}
	return mapped
}

function mapItemTimerLinks(rawLinks: unknown, errors: Array<string>): Array<ItemTimerLink> {
	if (!Array.isArray(rawLinks)) {
		errors.push('`itemTimerLinks` is not an array, skipped.')
		return []
	}
	const nowIso = new Date().toISOString()
	const mapped: Array<ItemTimerLink> = []
	for (const [index, raw] of rawLinks.entries()) {
		if (!isRecord(raw)) {
			errors.push(`itemTimerLinks[${index}] is not an object, skipped.`)
			continue
		}
		const itemId = toTrimmedString(raw.itemId)
		const timerId = toTrimmedString(raw.timerId)
		if (!itemId || !timerId) {
			errors.push(`itemTimerLinks[${index}] missing itemId or timerId, removed.`)
			continue
		}
		mapped.push({
			id: toTrimmedString(raw.id) || crypto.randomUUID(),
			itemId,
			timerId,
			lastCheckedAt: toIsoOrDefault(raw.lastCheckedAt, new Date(0).toISOString()),
			createdAt: toIsoOrDefault(raw.createdAt, nowIso),
			updatedAt: toIsoOrDefault(raw.updatedAt, nowIso),
		})
	}
	return mapped
}

function validateLinks(
	items: Array<Item>,
	timers: Array<Timer>,
	itemLinks: Array<ItemLink>,
	itemTimerLinks: Array<ItemTimerLink>,
	errors: Array<string>,
): Pick<ImportV1ValidationResult, 'itemLinks' | 'itemTimerLinks'> {
	const itemIds = new Set(items.map((item) => item.id))
	const timerIds = new Set(timers.map((timer) => timer.id))
	const validItemLinks: Array<ItemLink> = []
	const validTimerLinks: Array<ItemTimerLink> = []
	const itemLinkKeys = new Set<string>()
	const timerLinkKeys = new Set<string>()

	for (const link of itemLinks) {
		if (!itemIds.has(link.itemId)) {
			errors.push(`itemLink "${link.id}" removed: item "${link.itemId}" does not exist.`)
			continue
		}
		if (!itemIds.has(link.targetId)) {
			errors.push(`itemLink "${link.id}" removed: target "${link.targetId}" does not exist.`)
			continue
		}
		if (link.itemId === link.targetId) {
			errors.push(`itemLink "${link.id}" removed: self-reference is not allowed.`)
			continue
		}
		const dedupeKey = `${link.itemId}::${link.targetId}::${link.type}`
		if (itemLinkKeys.has(dedupeKey)) {
			errors.push(`itemLink "${link.id}" removed: duplicate relationship.`)
			continue
		}
		itemLinkKeys.add(dedupeKey)
		validItemLinks.push(link)
	}

	for (const link of itemTimerLinks) {
		if (!itemIds.has(link.itemId)) {
			errors.push(`itemTimerLink "${link.id}" removed: item "${link.itemId}" does not exist.`)
			continue
		}
		if (!timerIds.has(link.timerId)) {
			errors.push(`itemTimerLink "${link.id}" removed: timer "${link.timerId}" does not exist.`)
			continue
		}
		const dedupeKey = `${link.itemId}::${link.timerId}`
		if (timerLinkKeys.has(dedupeKey)) {
			errors.push(`itemTimerLink "${link.id}" removed: duplicate timer link.`)
			continue
		}
		timerLinkKeys.add(dedupeKey)
		validTimerLinks.push(link)
	}

	return { itemLinks: validItemLinks, itemTimerLinks: validTimerLinks }
}

function validateImportV1Payload(payload: ImportV1Payload): ImportV1ValidationResult {
	const errors: Array<string> = []
	if (!payload.metadata || String(payload.metadata.version) !== '1') {
		throw new Error('Unsupported import format. Expected metadata.version="1".')
	}
	const items = mapItems(payload.items, errors)
	const timers = mapTimers(payload.timers, errors)
	const mappedItemLinks = mapItemLinks(payload.itemLinks, errors)
	const mappedTimerLinks = mapItemTimerLinks(payload.itemTimerLinks, errors)
	const validatedLinks = validateLinks(items, timers, mappedItemLinks, mappedTimerLinks, errors)
	return {
		items,
		timers,
		itemLinks: validatedLinks.itemLinks,
		itemTimerLinks: validatedLinks.itemTimerLinks,
		errors,
	}
}

export async function importV1SnapshotFromJson(rawJson: string): Promise<void> {
	const payload = decodeImportPayload(rawJson)
	const mapped = validateImportV1Payload(payload)

	if (mapped.errors.length > 0) {
		for (const message of mapped.errors) {
			console.error(IMPORT_LOG_PREFIX, message)
		}
	}

	const importData: ImportData = {
		items: mapped.items,
		timers: mapped.timers,
		itemLinks: mapped.itemLinks,
		itemTimerLinks: mapped.itemTimerLinks,
		sourceVersion: '1',
	}

	await executeDatabaseImport(importData)
}
