import type { ItemTimerLink, Timer, TimerIntervalUnit } from './types'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const YELLOW_WARNING_MS = 24 * HOUR_MS

export type TimerVisualState = 'red' | 'green' | 'blue' | 'yellow' | 'muted'

export interface TimerStatus {
	visualState: TimerVisualState
	label: string
	nextRunAt: Date | null
	lastRunAt: Date | null
}

export function toValidDate(value: string): Date | null {
	const parsed = new Date(value)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function timerHasExplicitTime(baseAt: string): boolean {
	const date = toValidDate(baseAt)
	if (!date) {
		return false
	}
	return date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0
}

export function formatTimerBaseAt(baseAt: string): string {
	const date = toValidDate(baseAt)
	if (!date) {
		return baseAt
	}
	const hasTime = timerHasExplicitTime(baseAt)
	return hasTime ? date.toLocaleString('ru-RU') : date.toLocaleDateString('ru-RU')
}

export function formatTimerShortDate(value: Date, withTime: boolean): string {
	const datePart = value.toLocaleDateString('ru-RU', {
		day: '2-digit',
		month: 'long',
	})
	if (!withTime) {
		return datePart
	}
	const timePart = value.toLocaleTimeString('ru-RU', {
		hour: '2-digit',
		minute: '2-digit',
	})
	return `${datePart} ${timePart}`
}

function addBySchedule(base: Date, every: number, unit: TimerIntervalUnit): Date {
	if (unit === 'hours') {
		return new Date(base.getTime() + every * HOUR_MS)
	}
	if (unit === 'days') {
		return new Date(base.getTime() + every * DAY_MS)
	}
	if (unit === 'weeks') {
		return new Date(base.getTime() + every * 7 * DAY_MS)
	}
	const next = new Date(base.getTime())
	if (unit === 'months') {
		next.setMonth(next.getMonth() + every)
		return next
	}
	next.setFullYear(next.getFullYear() + every)
	return next
}

export function getNextTimerRunAt(timer: Timer, now = new Date()): Date | null {
	const base = toValidDate(timer.baseAt)
	if (!base || !timer.isActive) {
		return null
	}
	if (!timer.schedule) {
		return base > now ? base : null
	}
	const every = timer.schedule.every
	if (!Number.isFinite(every) || every <= 0) {
		return null
	}
	let next = new Date(base.getTime())
	let guard = 0
	while (next <= now && guard < 10000) {
		next = addBySchedule(next, every, timer.schedule.unit)
		guard += 1
	}
	return next > now ? next : null
}

export function getLastTimerRunAt(timer: Timer, now = new Date()): Date | null {
	const base = toValidDate(timer.baseAt)
	if (!base || !timer.isActive) {
		return null
	}
	if (!timer.schedule) {
		return base <= now ? base : null
	}
	const every = timer.schedule.every
	if (!Number.isFinite(every) || every <= 0) {
		return null
	}
	let next = new Date(base.getTime())
	let guard = 0
	let previous: Date | null = null
	while (next <= now && guard < 10000) {
		previous = next
		next = addBySchedule(next, every, timer.schedule.unit)
		guard += 1
	}
	return previous
}

export function formatTimerRemaining(targetAt: Date, now = new Date(), hasTime = true): string {
	const diffMs = targetAt.getTime() - now.getTime()
	if (diffMs <= 0) {
		return 'now'
	}
	if (!hasTime) {
		return `${Math.ceil(diffMs / DAY_MS)}d`
	}
	if (diffMs >= DAY_MS) {
		return `${Math.floor(diffMs / DAY_MS)}d`
	}
	if (diffMs >= HOUR_MS) {
		return `${Math.floor(diffMs / HOUR_MS)}h`
	}
	return `${Math.max(1, Math.floor(diffMs / MINUTE_MS))}m`
}

function formatShortDuration(diffMs: number, hasTime: boolean): string {
	if (!hasTime) {
		return `${Math.ceil(diffMs / DAY_MS)}d`
	}
	if (diffMs >= DAY_MS) {
		return `${Math.floor(diffMs / DAY_MS)}d`
	}
	if (diffMs >= HOUR_MS) {
		return `${Math.floor(diffMs / HOUR_MS)}h`
	}
	return `${Math.max(1, Math.floor(diffMs / MINUTE_MS))}m`
}

export function getTimerStatus(
	timer: Timer,
	lastCheckedAt: string,
	now = new Date(),
): TimerStatus {
	if (!timer.isActive) {
		return { visualState: 'muted', label: 'inactive', nextRunAt: null, lastRunAt: null }
	}
	const base = toValidDate(timer.baseAt)
	if (!base) {
		return { visualState: 'muted', label: 'invalid date', nextRunAt: null, lastRunAt: null }
	}

	const hasTime = timerHasExplicitTime(timer.baseAt)
	const checkedAt = toValidDate(lastCheckedAt)
	const nextRunAt = getNextTimerRunAt(timer, now)
	const lastRunAt = getLastTimerRunAt(timer, now)

	// 1. Red (просрочка): если ластчек раньше последнего срабатывания (или его нет)
	if (lastRunAt !== null) {
		if (checkedAt === null || checkedAt.getTime() < lastRunAt.getTime()) {
			return {
				visualState: 'red',
				label: `late ${formatShortDuration(now.getTime() - lastRunAt.getTime(), hasTime)}`,
				nextRunAt,
				lastRunAt,
			}
		}
	}

	// 2. Blue (пречек): если ластчек от последнего до следующего (или равен следующему)
	const isBlue = lastRunAt !== null
		? (checkedAt !== null && checkedAt.getTime() > lastRunAt.getTime())
		: (checkedAt !== null && nextRunAt !== null && checkedAt.getTime() >= nextRunAt.getTime())

	if (isBlue) {
		return {
			visualState: 'blue',
			label: nextRunAt ? `${formatTimerRemaining(nextRunAt, now, hasTime)} prechecked` : 'prechecked',
			nextRunAt,
			lastRunAt,
		}
	}

	// 3. Green / Yellow / Muted (текущий интервал выполнен)
	if (nextRunAt !== null) {
		const remainingMs = nextRunAt.getTime() - now.getTime()
		if (remainingMs <= YELLOW_WARNING_MS) {
			return {
				visualState: 'yellow',
				label: `${formatTimerRemaining(nextRunAt, now, hasTime)} soon`,
				nextRunAt,
				lastRunAt,
			}
		}
		return {
			visualState: lastRunAt !== null ? 'green' : 'muted',
			label: formatTimerRemaining(nextRunAt, now, hasTime),
			nextRunAt,
			lastRunAt,
		}
	}

	return {
		visualState: 'green',
		label: '-',
		nextRunAt: null,
		lastRunAt,
	}
}

export function getTimerCycleNextCheckedAt(timer: Timer, link: ItemTimerLink, now = new Date()): string {
	const status = getTimerStatus(timer, link.lastCheckedAt, now)
	const lastRunAt = status.lastRunAt
	const nextRunAt = status.nextRunAt

	if (status.visualState === 'red') {
		return lastRunAt ? lastRunAt.toISOString() : now.toISOString()
	}

	if (status.visualState === 'yellow' || status.visualState === 'green' || status.visualState === 'muted') {
		return nextRunAt ? nextRunAt.toISOString() : now.toISOString()
	}

	if (status.visualState === 'blue') {
		return lastRunAt ? lastRunAt.toISOString() : new Date(0).toISOString()
	}

	return now.toISOString()
}
