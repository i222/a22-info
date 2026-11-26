const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export type TimerVisualState = 'red' | 'green' | 'blue' | 'yellow' | 'muted'

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
