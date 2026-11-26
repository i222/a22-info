import { formatTimerShortDate, getTimerStatus, timerHasExplicitTime, toValidDate } from '@/models/item/timerLogic'
import type { ItemTimerLink, Timer } from '@/models/item/types'

export type TimerViewState = {
	text: string
	textColor: 'text.primary' | 'error' | 'info.main' | 'text.secondary' | 'primary.main' | 'warning.main'
	dotColor: 'success.main' | 'grey.500' | 'info.main' | 'primary.main' | 'warning.main' | 'error.main' | null
	dotPulsing: boolean
	showCheck: boolean
	showCancel: boolean
	checkTooltip: string
	cancelTooltip: string
}

export function getTimerViewState(timer: Timer, link: ItemTimerLink, now = new Date()): TimerViewState {
	const status = getTimerStatus(timer, link.lastCheckedAt, now)
	const hasTime = timerHasExplicitTime(timer.baseAt)
	const nextLabel = status.nextRunAt ? formatTimerShortDate(status.nextRunAt, hasTime) : null
	const lastRelevantDate = toValidDate(link.lastCheckedAt) ?? toValidDate(timer.baseAt)
	const lastLabel = lastRelevantDate ? formatTimerShortDate(lastRelevantDate, hasTime) : 'invalid date'

	if (status.visualState === 'muted') {
		const canCheckMuted = timer.isActive && Boolean(status.nextRunAt)
		return {
			text: timer.isActive ? (nextLabel ? `${nextLabel} (${status.label})` : status.label) : `${lastLabel} (off)`,
			textColor: 'text.secondary',
			dotColor: 'grey.500',
			dotPulsing: false,
			showCheck: canCheckMuted,
			showCancel: false,
			checkTooltip: canCheckMuted ? 'Check timer (precheck)' : '',
			cancelTooltip: '',
		}
	}

	if (status.visualState === 'green') {
		return {
			text: `${lastLabel} (done)`,
			textColor: 'info.main',
			dotColor: 'info.main',
			dotPulsing: false,
			showCheck: false,
			showCancel: false,
			checkTooltip: '',
			cancelTooltip: '',
		}
	}

	if (status.visualState === 'blue') {
		return {
			text: nextLabel ? `${nextLabel} (prechecked)` : status.label,
			textColor: 'primary.main',
			dotColor: 'primary.main',
			dotPulsing: false,
			showCheck: false,
			showCancel: true,
			checkTooltip: '',
			cancelTooltip: 'Cancel precheck (uncheck)',
		}
	}

	if (status.visualState === 'yellow') {
		return {
			text: nextLabel ? `${nextLabel} (soon)` : status.label,
			textColor: 'warning.main',
			dotColor: 'warning.main',
			dotPulsing: false,
			showCheck: true,
			showCancel: false,
			checkTooltip: 'Check timer (precheck)',
			cancelTooltip: '',
		}
	}

	if (status.visualState === 'red') {
		const overdueDate = status.lastRunAt ?? toValidDate(timer.baseAt)
		const overdueDateLabel = overdueDate ? formatTimerShortDate(overdueDate, hasTime) : 'invalid date'
		return {
			text: `${overdueDateLabel} (${status.label})`,
			textColor: 'error',
			dotColor: 'error.main',
			dotPulsing: false,
			showCheck: true,
			showCancel: false,
			checkTooltip: 'Check timer',
			cancelTooltip: '',
		}
	}

	return {
		text: nextLabel ? `${nextLabel} (${status.label})` : status.label,
		textColor: 'text.primary',
		dotColor: status.nextRunAt ? 'success.main' : null,
		dotPulsing: Boolean(status.nextRunAt),
		showCheck: false,
		showCancel: false,
		checkTooltip: '',
		cancelTooltip: '',
	}
}
