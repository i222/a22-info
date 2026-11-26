import { Box, Paper, Stack, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { getItemDisplayValue } from 'src/ui-core/models/item/helpers'
import { useItemStore } from 'src/ui-core/store/itemStore'
import { RelationshipGraph } from './RelationshipGraph'
import {
	loadRelationshipReportTags,
	loadRelationshipReportTypeFilters,
	saveRelationshipReportTags,
	saveRelationshipReportTypeFilters,
	stringifyTagFilter,
} from './relationshipsReportConfig'
import { ReportFilters } from './ReportFilters'
import { ReportSidebar } from './ReportSidebar'

const TYPE_FILTER_OPTIONS = ['related', 'contact', 'link', 'recovery_info', 'recovery_info_primary']

export function RelationshipsReportPage() {
	const items = useItemStore((state) => state.items)
	const itemLinks = useItemStore((state) => state.itemLinks)
	const tags = useItemStore((state) => state.tags)
	const isLoading = useItemStore((state) => state.isLoading)
	const error = useItemStore((state) => state.error)
	const load = useItemStore((state) => state.load)

	const [selectedTags, setSelectedTags] = useState<Array<string>>(() => loadRelationshipReportTags())
	const [, setTagInput] = useState<string>(() => stringifyTagFilter(loadRelationshipReportTags()))
	const [typeFilters, setTypeFilters] = useState<Array<string>>(() => loadRelationshipReportTypeFilters())

	const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
	const [searchQuery, setSearchQuery] = useState('')

	useEffect(() => {
		setTagInput(stringifyTagFilter(selectedTags))
	}, [selectedTags])

	const saveConfig = () => {
		saveRelationshipReportTags(selectedTags)
		saveRelationshipReportTypeFilters(typeFilters)
	}

	const handlePrint = () => {
		window.print()
	}

	useEffect(() => {
		const handleBeforeUnload = () => saveConfig()
		window.addEventListener('beforeunload', handleBeforeUnload)
		return () => window.removeEventListener('beforeunload', handleBeforeUnload)
	}, [selectedTags, typeFilters])

	useEffect(() => {
		if (tags.length === 0) void load()
	}, [tags.length, load])

	// Фильтрация по ТЕГАМ (OR)
	const tagFilteredItems = useMemo(() => {
		if (selectedTags.length === 0) return items
		return items.filter((item) => {
			if (!item.tags || item.tags.length === 0) return false
			return item.tags.some((tag) => selectedTags.includes(tag))
		})
	}, [items, selectedTags])

	// Подсчёт связей
	const itemLinkCounts = useMemo(() => {
		const map = new Map<string, number>()
		itemLinks.forEach((link) => {
			if (typeFilters.length > 0 && !typeFilters.includes(link.type)) return
			map.set(link.itemId, (map.get(link.itemId) || 0) + 1)
			map.set(link.targetId, (map.get(link.targetId) || 0) + 1)
		})
		return map
	}, [itemLinks, typeFilters])

	// Фильтрация по тексту поиска
	const filteredItemsList = useMemo(() => {
		const q = searchQuery.trim().toLowerCase()
		if (!q) {
			return [...tagFilteredItems].sort(
				(a, b) => (itemLinkCounts.get(b.id) || 0) - (itemLinkCounts.get(a.id) || 0),
			)
		}

		return tagFilteredItems
			.filter((item) => {
				const val = getItemDisplayValue(item).toLowerCase()
				const itemTags = (item.tags || []).join(' ').toLowerCase()

				const fieldsText = item.infoEntries.map((e) => `${e.label} ${e.value}`).join(' ').toLowerCase()

				return val.includes(q) || itemTags.includes(q) || fieldsText.includes(q)
			})
			.sort((a, b) => (itemLinkCounts.get(b.id) || 0) - (itemLinkCounts.get(a.id) || 0))
	}, [tagFilteredItems, itemLinkCounts, searchQuery])

	const handleToggleSelectItem = (id: string | null) => {
		setSelectedItemId((prev) => (prev === id ? null : id))
	}

	return (
		<>
			<style>
				{`
                    @page { size: A4 portrait; margin: 7mm; }
                    @media print {
                        .relationships-report-root { padding: 0 !important; background: #fff !important; height: auto !important; }
                        .relationships-report-filters, .relationships-report-sidebar { display: none !important; }
                        .relationships-report-main { width: 100% !important; }
                    }
                `}
			</style>
			<Stack
				className="relationships-report-root"
				sx={{ p: 1.5, gap: 1.5, bgcolor: '#f4f5f7', height: '100vh', overflow: 'hidden' }}
			>
				<Typography variant="h6" sx={{ fontWeight: 600 }}>
					Relationships Report
				</Typography>

				<ReportFilters
					tags={tags}
					selectedTags={selectedTags}
					onTagsChange={(nextTags) => {
						setSelectedTags(nextTags)
						setTagInput(stringifyTagFilter(nextTags))
					}}
					typeFilters={typeFilters}
					onTypeFiltersChange={setTypeFilters}
					typeFilterOptions={TYPE_FILTER_OPTIONS}
					onSave={saveConfig}
					onPrint={handlePrint}
				/>

				<Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
					<ReportSidebar
						items={filteredItemsList}
						totalCount={items.length}
						searchQuery={searchQuery}
						onSearchChange={setSearchQuery}
						selectedItemId={selectedItemId}
						onSelectItem={handleToggleSelectItem}
						itemLinkCounts={itemLinkCounts}
					/>

					<Paper
						elevation={0}
						className="relationships-report-main"
						sx={{
							flex: 1,
							minWidth: 0,
							display: 'flex',
							flexDirection: 'column',
							border: '1px solid',
							borderColor: 'divider',
							position: 'relative',
							overflow: 'hidden',
						}}
					>
						{isLoading && (
							<Box sx={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>
								<Typography variant="caption" color="text.secondary">
									Загрузка...
								</Typography>
							</Box>
						)}

						{error && (
							<Box sx={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>
								<Typography variant="caption" color="error">
									{error}
								</Typography>
							</Box>
						)}

						<Box sx={{ flex: 1, minHeight: 0 }}>
							<RelationshipGraph
								items={items}
								itemLinks={itemLinks}
								selectedTags={selectedTags}
								typeFilters={typeFilters}
								focusItemId={selectedItemId}
								onSelectNode={handleToggleSelectItem}
							/>
						</Box>
					</Paper>
				</Stack>
			</Stack>
		</>
	)
}
