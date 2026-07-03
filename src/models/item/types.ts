export type Tag = string

export type InfoEntry = {
	label: string
	value: string
}

export type DateTimeEntry = {
	label: string
	value: number // Unix timestamp in milliseconds.
}

export type Relationship = {
	type: string
	targetId: string
}

export type TimerIntervalUnit = 'hours' | 'days' | 'weeks' | 'months' | 'years'

export type TimerSchedule = {
	every: number
	unit: TimerIntervalUnit
}

export type Timer = {
	id: string
	name: string
	baseAt: string
	description: string
	isActive: boolean
	schedule?: TimerSchedule
	createdAt: string
	updatedAt: string
}

export type ItemTimerLink = {
	id: string
	itemId: string
	timerId: string
	lastCheckedAt: string
	createdAt: string
	updatedAt: string
}

export type Item = {
	id: string
	mainInfoField?: string
	tags: Array<Tag>
	infoEntries: Array<InfoEntry>
	dateTimeEntries: Array<DateTimeEntry>
	createdAt: string
	updatedAt: string
}

export type ItemLink = {
	id: string
	itemId: string
	targetId: string
	type: string
	createdAt: string
	updatedAt: string
}

export type DatabaseSnapshotEncoding = 'gzip-base64' | 'plain'

export type DatabaseSnapshot = {
	id: string
	createdAt: string
	sourceVersion: string
	encoding: DatabaseSnapshotEncoding
	payload: string
	itemCount: number
	timerCount: number
	itemLinkCount: number
	itemTimerLinkCount: number
}

export type ItemLinkInput = Omit<ItemLink, 'id' | 'createdAt' | 'updatedAt'>
export type ItemLinkUpdateInput = Partial<Omit<ItemLinkInput, 'itemId' | 'targetId'>>

export type ItemInput = Omit<Item, 'id' | 'createdAt' | 'updatedAt'> & { relationships?: Array<Relationship> }
export type ItemUpdateInput = Partial<Omit<Item, 'id' | 'createdAt' | 'updatedAt'>> & { relationships?: Array<Relationship> }

export type TimerInput = Omit<Timer, 'id' | 'createdAt' | 'updatedAt'>
export type TimerUpdateInput = Partial<TimerInput>

export type ItemTimerLinkInput = Omit<ItemTimerLink, 'id' | 'createdAt' | 'updatedAt'>
export type ItemTimerLinkUpdateInput = Partial<Omit<ItemTimerLinkInput, 'itemId' | 'timerId'>>

export const itemTagsDefaults = [
	'email',
	'social_media',
	'serbia',
	'russia',
	'finance',
	'contact',
	'utilities',
] as const

export const infoLabelDefaults = [
	'title',
	'fat',
	'description',
] as const

export const relationshipTypeDefaults = [
	'related',
	'recovery_info',
	'recovery_info_primary',
	'contact',
	'link',
] as const
