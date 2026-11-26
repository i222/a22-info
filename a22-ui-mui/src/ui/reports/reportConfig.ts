export const BASIC_REPORT_TAGS_STORAGE_KEY = 'basic-report-tags-order'
export const BASIC_REPORT_FONT_SIZE_STORAGE_KEY = 'basic-report-font-size'

function normalizeTagList(tags: Array<string>): Array<string> {
	return tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
}

export function parseTagOrderInput(input: string): Array<string> {
	return normalizeTagList(input.split(','))
}

export function stringifyTagOrder(tags: Array<string>): string {
	return normalizeTagList(tags).join(', ')
}

export function loadBasicReportTagOrder(): Array<string> {
	const raw = localStorage.getItem(BASIC_REPORT_TAGS_STORAGE_KEY)
	if (!raw) {
		return []
	}
	try {
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) {
			return []
		}
		return normalizeTagList(parsed.map((value) => String(value)))
	} catch {
		return []
	}
}

export function saveBasicReportTagOrder(tags: Array<string>): void {
	localStorage.setItem(BASIC_REPORT_TAGS_STORAGE_KEY, JSON.stringify(normalizeTagList(tags)))
}

export function loadBasicReportFontSize(): number {
	const raw = localStorage.getItem(BASIC_REPORT_FONT_SIZE_STORAGE_KEY)
	if (!raw) {
		return 11
	}
	const parsed = Number.parseFloat(raw)
	if (Number.isNaN(parsed)) {
		return 11
	}
	return Math.min(16, Math.max(8, parsed))
}

export function saveBasicReportFontSize(fontSize: number): void {
	const normalized = Math.min(16, Math.max(8, fontSize))
	localStorage.setItem(BASIC_REPORT_FONT_SIZE_STORAGE_KEY, String(normalized))
}
