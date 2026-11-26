import { formatTimerRemaining, formatTimerShortDate, timerHasExplicitTime, toValidDate } from 'src/ui-core/models/item/timerLogic'
import type { ItemTimerLink, Timer } from 'src/ui-core/models/item/types'
import type { TimerEngineStatus } from 'src/ui-core/platform/commands'

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

/**
 * Presentation mapping for a Rust engine status: the structured
 * `visualState` + run timestamps come from the store's `timerStatuses`
 * (`timers_statuses` command); label text is built here with the TypeScript
 * formatters.
 */
export function getTimerViewState(timer: Timer, link: ItemTimerLink, status: TimerEngineStatus | undefined): TimerViewState {
	const now = new Date()
	const hasTime = timerHasExplicitTime(timer.baseAt)
	const nextRunAt = status?.nextRunAt !== undefined ? new Date(status.nextRunAt) : null
	const lastRunAt = status?.lastRunAt !== undefined ? new Date(status.lastRunAt) : null
	const nextLabel = nextRunAt ? formatTimerShortDate(nextRunAt, hasTime) : null
	const lastRelevantDate = toValidDate(link.lastCheckedAt) ?? toValidDate(timer.baseAt)
	const lastLabel = lastRelevantDate ? formatTimerShortDate(lastRelevantDate, hasTime) : 'invalid date'

	// Label strings mirror the old TS engine (timerLogic.ts `getTimerStatus`).
	let label: string
	if (!status) {
		label = timer.isActive ? '…' : 'inactive'
	} else if (status.visualState === 'red') {
		label = `late ${lastRunAt ? formatTimerRemaining(lastRunAt, now, hasTime) : 'now'}`
	} else if (status.visualState === 'blue') {
		label = nextRunAt ? `${formatTimerRemaining(nextRunAt, now, hasTime)} prechecked` : 'prechecked'
	} else if (status.visualState === 'yellow') {
		label = nextRunAt ? `${formatTimerRemaining(nextRunAt, now, hasTime)} soon` : 'soon'
	} else if (status.visualState === 'green') {
		label = nextRunAt ? formatTimerRemaining(nextRunAt, now, hasTime) : '-'
	} else {
		label = !timer.isActive
			? 'inactive'
			: toValidDate(timer.baseAt) === null
			? 'invalid date'
			: nextRunAt
			? formatTimerRemaining(nextRunAt, now, hasTime)
			: '-'
	}

	const visualState = status?.visualState ?? 'muted'

	if (visualState === 'muted') {
		const canCheckMuted = timer.isActive && Boolean(nextRunAt)
		return {
			text: timer.isActive ? (nextLabel ? `${nextLabel} (${label})` : label) : `${lastLabel} (off)`,
			textColor: 'text.secondary',
			dotColor: 'grey.500',
			dotPulsing: false,
			showCheck: canCheckMuted,
			showCancel: false,
			checkTooltip: canCheckMuted ? 'Check timer (precheck)' : '',
			cancelTooltip: '',
		}
	}

	if (visualState === 'green') {
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

	if (visualState === 'blue') {
		return {
			text: nextLabel ? `${nextLabel} (prechecked)` : label,
			textColor: 'primary.main',
			dotColor: 'primary.main',
			dotPulsing: false,
			showCheck: false,
			showCancel: true,
			checkTooltip: '',
			cancelTooltip: 'Cancel precheck (uncheck)',
		}
	}

	if (visualState === 'yellow') {
		return {
			text: nextLabel ? `${nextLabel} (soon)` : label,
			textColor: 'warning.main',
			dotColor: 'warning.main',
			dotPulsing: false,
			showCheck: true,
			showCancel: false,
			checkTooltip: 'Check timer (precheck)',
			cancelTooltip: '',
		}
	}

	if (visualState === 'red') {
		const overdueDate = lastRunAt ?? toValidDate(timer.baseAt)
		const overdueDateLabel = overdueDate ? formatTimerShortDate(overdueDate, hasTime) : 'invalid date'
		return {
			text: `${overdueDateLabel} (${label})`,
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
		text: nextLabel ? `${nextLabel} (${label})` : label,
		textColor: 'text.primary',
		dotColor: nextRunAt ? 'success.main' : null,
		dotPulsing: Boolean(nextRunAt),
		showCheck: false,
		showCancel: false,
		checkTooltip: '',
		cancelTooltip: '',
	}
}
