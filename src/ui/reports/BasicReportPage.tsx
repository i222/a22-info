import { useItemStore } from '@/lib/item/store/itemStore'
import { getItemDisplayValue } from '@/models/item/helpers'
import type { InfoEntry, Item, ItemLink } from '@/models/item/types'
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material'
import { useEffect, useMemo } from 'react'
import { loadBasicReportFontSize, loadBasicReportTagOrder } from './reportConfig'

function isEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function isPhone(value: string): boolean {
	const compact = value.replace(/[^\d+]/g, '')
	return /^\+?\d{7,15}$/.test(compact)
}

function isSocial(value: string): boolean {
	const trimmed = value.trim().toLowerCase()
	if (trimmed.length === 0) {
		return false
	}
	if (/^@[a-z0-9._-]+$/i.test(trimmed)) {
		return true
	}
	return /(t\.me|telegram|instagram\.com|facebook\.com|fb\.com|vk\.com|vkontakte|linkedin\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|whatsapp|wa\.me)/i.test(trimmed)
}

function resolveBullet(value: string): string {
	if (isEmail(value)) {
		return '✉'
	}
	if (isPhone(value)) {
		return '☎'
	}
	if (isSocial(value)) {
		return '⌘'
	}
	return '•'
}

type ReportPart = {
	text: string
	isFat: boolean
}

function isFatLabel(label: string): boolean {
	return label.trim().toLowerCase() === 'fat'
}

function resolveMainEntry(item: Item): InfoEntry | undefined {
	const mainEntry = item.mainInfoField ? item.infoEntries.find((entry) => entry.label === item.mainInfoField) : undefined
	if (mainEntry) {
		return mainEntry
	}
	const titleEntry = item.infoEntries.find((entry) => entry.label.trim().toLowerCase() === 'title')
	if (titleEntry) {
		return titleEntry
	}
	return item.infoEntries[0]
}

function buildItemParts(item: Item, itemById: Map<string, Item>, relationships: Array<ItemLink>): { main: ReportPart; others: Array<ReportPart>; relationships: Array<string> } {
	const mainEntry = resolveMainEntry(item)
	const mainValue = mainEntry?.value ?? getItemDisplayValue(item)
	const otherInfoValues = item.infoEntries.filter((entry) => entry !== mainEntry)

	const relationshipValues = relationships.map((relationship) => {
		const target = itemById.get(relationship.targetId)
		return target ? getItemDisplayValue(target) : relationship.targetId
	})

	return {
		main: {
			text: mainValue,
			isFat: mainEntry ? isFatLabel(mainEntry.label) : false,
		},
		others: otherInfoValues.map((entry) => ({
			text: entry.value,
			isFat: isFatLabel(entry.label),
		})),
		relationships: relationshipValues,
	}
}

type ReportGroup = {
	key: string
	items: Array<Item>
}

type ReportRow =
	| { id: string; kind: 'group-divider' }
	| { id: string; kind: 'item'; parts: { main: ReportPart; others: Array<ReportPart>; relationships: Array<string> } }

function buildReportGroups(items: Array<Item>, tagOrder: Array<string>): Array<ReportGroup> {
	if (tagOrder.length === 0) {
		return [{ key: 'all', items }]
	}

	const normalizedOrder = tagOrder.map((tag) => tag.toLowerCase())
	const usedItemIds = new Set<string>()
	const groups: Array<ReportGroup> = []

	for (let index = 0; index < normalizedOrder.length; index += 1) {
		const tagLower = normalizedOrder[index]
		const groupItems = items.filter((item) => !usedItemIds.has(item.id) && item.tags.some((tag) => tag.toLowerCase() === tagLower))
		if (groupItems.length === 0) {
			continue
		}
		groupItems.forEach((item) => {
			usedItemIds.add(item.id)
		})
		groups.push({ key: `tag-${tagLower}`, items: groupItems })
	}

	const remainingItems = items.filter((item) => !usedItemIds.has(item.id))
	if (remainingItems.length > 0) {
		groups.push({ key: 'remaining', items: remainingItems })
	}

	return groups
}

export function BasicReportPage() {
	const items = useItemStore((state) => state.items)
	const itemLinks = useItemStore((state) => state.itemLinks)
	const isLoading = useItemStore((state) => state.isLoading)
	const error = useItemStore((state) => state.error)
	const load = useItemStore((state) => state.load)

	useEffect(() => {
		void load()
	}, [load])

	const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
	const itemLinksByItemId = useMemo(() => {
		const groupsMap = new Map<string, Array<ItemLink>>()
		for (const link of itemLinks) {
			const arr = groupsMap.get(link.itemId) ?? []
			arr.push(link)
			groupsMap.set(link.itemId, arr)
		}
		return groupsMap
	}, [itemLinks])
	const tagOrder = useMemo(() => loadBasicReportTagOrder(), [])
	const reportFontSize = useMemo(() => loadBasicReportFontSize(), [])
	const groups = useMemo(() => buildReportGroups(items, tagOrder), [items, tagOrder])
	const reportRows = useMemo(
		() => {
			const rows: Array<ReportRow> = []
			groups.forEach((group, groupIndex) => {
				if (groupIndex > 0) {
					rows.push({ id: `group-divider-${group.key}`, kind: 'group-divider' })
				}
				group.items.forEach((item) => {
					rows.push({
						id: item.id,
						kind: 'item',
						parts: buildItemParts(item, itemById, itemLinksByItemId.get(item.id) ?? []),
					})
				})
			})
			return rows
		},
		[groups, itemById, itemLinksByItemId],
	)

	const pages = useMemo(() => {
		const rowsPerPage = 180
		return [
			{ id: 'page-1', rows: reportRows.slice(0, rowsPerPage) },
			{ id: 'page-2', rows: reportRows.slice(rowsPerPage, rowsPerPage * 2) },
		]
	}, [reportRows])

	return (
		<>
			<style>
				{`
					@page {
						size: A4 portrait;
						margin: 7mm;
					}

					@media print {
						html, body {
							background: #fff !important;
						}

						.report-root {
							padding: 0 !important;
							background: #fff !important;
							min-height: auto !important;
							gap: 0 !important;
						}

						.report-title {
							display: none !important;
						}

						.report-page {
							width: 196mm !important;
							min-height: 283mm !important;
							box-shadow: none !important;
							margin: 0 auto !important;
							padding: 0 !important;
							page-break-after: always;
							break-after: page;
						}

						.report-page:last-child {
							page-break-after: auto;
							break-after: auto;
						}
					}
				`}
			</style>
			<Stack className="report-root" sx={{ py: 2, px: 1.5, gap: 2, bgcolor: '#f2f2f2', minHeight: '100vh' }}>
				<Typography className="report-title" variant="h6">Base report (2x A4, portrait)</Typography>
				{isLoading && <CircularProgress size={20} />}
				{error && <Alert severity="error">{error}</Alert>}
				{pages.map((page, pageIndex) => (
					<Stack
						key={page.id}
						className="report-page"
						sx={{
							width: '210mm',
							minHeight: '297mm',
							bgcolor: '#fff',
							mx: 'auto',
							p: '7mm',
							boxShadow: '0 2px 16px rgba(0,0,0,0.12)',
						}}
					>
						<Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
							Page {pageIndex + 1} / 2
						</Typography>
						<Box
							sx={{
								m: 0,
								p: 0,
								columnCount: 3,
								columnGap: '6mm',
								columnFill: 'auto',
								fontSize: reportFontSize,
								lineHeight: 1.2,
							}}
						>
							{page.rows.map((row) => {
								if (row.kind === 'group-divider') {
									return <Box key={row.id} sx={{ breakInside: 'avoid', borderTop: '1px solid', borderColor: 'text.disabled', my: 0.45 }} />
								}
								const bullet = resolveBullet(row.parts.main.text)

								return (
									<Box
										key={row.id}
										sx={{
											breakInside: 'avoid',
											position: 'relative',
											mb: 0.45,
											pl: 1.4,
											pr: 0.5,
											fontSize: 'inherit',
											lineHeight: 'inherit',
										}}
									>
										<Box
											component="span"
											aria-hidden
											sx={{
												position: 'absolute',
												left: 0,
												top: 0,
												color: 'text.secondary',
												fontSize: '0.9em',
												lineHeight: 'inherit',
												width: '1.1em',
												textAlign: 'center',
											}}
										>
											{bullet}
										</Box>
										<Typography component="span" sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
											{row.parts.main.text.length === 0 && row.parts.others.length === 0 && row.parts.relationships.length === 0
												? (
													'-'
												)
												: (
													<>
														<Box
															component="span"
															sx={{
																fontWeight: 700,
																border: row.parts.main.isFat ? '1px solid' : 'none',
																borderColor: row.parts.main.isFat ? 'text.primary' : 'transparent',
																borderRadius: row.parts.main.isFat ? '2px' : 0,
																px: row.parts.main.isFat ? 0.35 : 0,
															}}
														>
															{row.parts.main.text}
														</Box>
														{row.parts.others.map((other) => (
															<Box key={`${row.id}-other-${other.text}`} component="span">
																{' '}
																<Box
																	component="span"
																	sx={{
																		border: other.isFat ? '1px solid' : 'none',
																		borderColor: other.isFat ? 'text.primary' : 'transparent',
																		borderRadius: other.isFat ? '2px' : 0,
																		px: other.isFat ? 0.35 : 0,
																	}}
																>
																	{other.text}
																</Box>
															</Box>
														))}
														{row.parts.relationships.length > 0 && (row.parts.main.text.length > 0 || row.parts.others.length > 0) ? ' ' : ''}
														{row.parts.relationships.map((relationshipValue, index) => (
															<Box
																key={`${row.id}-relationship-${relationshipValue}`}
																component="span"
																sx={{ fontStyle: 'italic' }}
															>
																{index > 0 ? ' ' : ''}
																{relationshipValue}
															</Box>
														))}
													</>
												)}
										</Typography>
									</Box>
								)
							})}
						</Box>
					</Stack>
				))}
			</Stack>
		</>
	)
}
