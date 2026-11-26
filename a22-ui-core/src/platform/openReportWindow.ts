import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauri } from './tauri'

export type ReportKind = 'basic' | 'relationships'

const REPORT_LABEL_PREFIX = 'report-'
const MAIN_WINDOW_LABEL = 'main'

/** Fallback routes for plain browser development. */
const REPORT_PATHS: Record<ReportKind, string> = {
	basic: '/reports/basic',
	relationships: '/reports/relationships',
}

const REPORT_TITLES: Record<ReportKind, string> = {
	basic: 'Base report',
	relationships: 'Relationships report',
}

/** A4 portrait (210x297 mm) at ~980 px width. */
const REPORT_WINDOW_WIDTH = 980
const REPORT_WINDOW_HEIGHT = 1300

function reportLabel(kind: ReportKind): string {
	return `${REPORT_LABEL_PREFIX}${kind}`
}

/** The kind of the current webview when it is a report webview, otherwise null. */
export function currentReportKind(): ReportKind | null {
	if (!isTauri()) {
		return null
	}
	const label = getCurrentWebviewWindow().label
	if (!label.startsWith(REPORT_LABEL_PREFIX)) {
		return null
	}
	const kind = label.slice(REPORT_LABEL_PREFIX.length)
	return kind === 'basic' || kind === 'relationships' ? kind : null
}

/**
 * Open a report window, or focus it when it is already open (no duplicates).
 * Inside Tauri the report runs in its own `WebviewWindow` labelled
 * `report-<kind>` and renders based on that label; outside Tauri (plain
 * browser dev) it falls back to `window.open` + pathname routing.
 */
export async function openReportWindow(kind: ReportKind): Promise<void> {
	if (!isTauri()) {
		window.open(REPORT_PATHS[kind], '_blank', 'noopener,noreferrer')
		return
	}

	const label = reportLabel(kind)
	const existing = await WebviewWindow.getByLabel(label)
	if (existing) {
		await existing.show()
		await existing.setFocus()
		return
	}

	await new WebviewWindow(label, {
		url: 'index.html',
		title: REPORT_TITLES[kind],
		width: REPORT_WINDOW_WIDTH,
		height: REPORT_WINDOW_HEIGHT,
		resizable: true,
	})
}

/** Close the current (report) webview. */
export async function closeReportWindow(): Promise<void> {
	if (!isTauri()) {
		window.close()
		return
	}
	await getCurrentWebviewWindow().close()
}

/** Focus the main window and close the current report webview. */
export async function backToMain(): Promise<void> {
	if (!isTauri()) {
		window.close()
		return
	}
	const main = await WebviewWindow.getByLabel(MAIN_WINDOW_LABEL)
	if (main) {
		await main.show()
		await main.setFocus()
	}
	await getCurrentWebviewWindow().close()
}
