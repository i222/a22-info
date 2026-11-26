export const RELATIONSHIPS_REPORT_TAGS_STORAGE_KEY = 'relationships-report-tags'
export const RELATIONSHIPS_REPORT_TYPE_FILTERS_STORAGE_KEY = 'relationships-report-type-filters'

function normalizeTagList(tags: Array<string>): Array<string> {
	return tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
}

export function parseTagFilterInput(input: string): Array<string> {
	return normalizeTagList(input.split(','))
}

export function stringifyTagFilter(tags: Array<string>): string {
	return normalizeTagList(tags).join(', ')
}

export function loadRelationshipReportTags(): Array<string> {
	const raw = localStorage.getItem(RELATIONSHIPS_REPORT_TAGS_STORAGE_KEY)
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

export function saveRelationshipReportTags(tags: Array<string>): void {
	localStorage.setItem(RELATIONSHIPS_REPORT_TAGS_STORAGE_KEY, JSON.stringify(normalizeTagList(tags)))
}

export function loadRelationshipReportTypeFilters(): Array<string> {
	return ['related', 'contact', 'link', 'recovery_info', 'recovery_info_primary']
}

export function saveRelationshipReportTypeFilters(filters: Array<string>): void {
	localStorage.setItem(RELATIONSHIPS_REPORT_TYPE_FILTERS_STORAGE_KEY, JSON.stringify(filters))
}
