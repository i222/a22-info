import { ItemEditor } from '@/components/item/ItemEditor'
import { ItemList } from '@/components/item/ItemList'
import { ItemsFilter, type ItemSortField } from '@/components/item/ItemsFilter'
import { ItemsToolbar } from '@/components/item/ItemsToolbar'
import { ItemView } from '@/components/item/ItemView'
import { importV1SnapshotFromJson } from '@/lib/item/indexeddb/importV1'
import { useFilteredItems, useItemStore } from '@/lib/item/store/itemStore'
import { getItemDisplayTitle, getItemDisplayValue } from '@/models/item/helpers'
import type { ItemInput } from '@/models/item/types'
import {
	Alert,
	Box,
	Button,
	Card,
	CardContent,
	CircularProgress,
	Dialog,
	DialogActions,
	DialogContent,
	DialogContentText,
	DialogTitle,
	Divider,
	Grid,
	Stack,
	Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'

type EditorMode = 'none' | 'create' | 'edit' | 'view'

export function ItemsPage() {
	const items = useFilteredItems()
	const allItems = useItemStore((state) => state.items)
	const tags = useItemStore((state) => state.tags)
	const timers = useItemStore((state) => state.timers)
	const itemTimerLinks = useItemStore((state) => state.itemTimerLinks)
	const itemLinks = useItemStore((state) => state.itemLinks)
	const infoLabelHints = useItemStore((state) => state.infoLabelHints)
	const relationshipTypeHints = useItemStore((state) => state.relationshipTypeHints)
	const selectedTags = useItemStore((state) => state.selectedTags)
	const searchQuery = useItemStore((state) => state.searchQuery)
	const selectedItemId = useItemStore((state) => state.selectedItemId)
	const isLoading = useItemStore((state) => state.isLoading)
	const error = useItemStore((state) => state.error)
	const load = useItemStore((state) => state.load)
	const createItem = useItemStore((state) => state.createItem)
	const updateItem = useItemStore((state) => state.updateItem)
	const deleteItem = useItemStore((state) => state.deleteItem)
	const createTimer = useItemStore((state) => state.createTimer)
	const updateTimer = useItemStore((state) => state.updateTimer)
	const createItemTimerLink = useItemStore((state) => state.createItemTimerLink)
	const deleteItemTimerLink = useItemStore((state) => state.deleteItemTimerLink)
	const setSelectedTags = useItemStore((state) => state.setSelectedTags)
	const setSearchQuery = useItemStore((state) => state.setSearchQuery)
	const setSelectedItemId = useItemStore((state) => state.setSelectedItemId)

	const [editorMode, setEditorMode] = useState<EditorMode>('none')
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [isImporting, setIsImporting] = useState(false)
	const [importError, setImportError] = useState<string | null>(null)
	const [itemSortField, setItemSortField] = useState<ItemSortField>('updatedAt')
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const [confirmState, setConfirmState] = useState<
		{
			title: string
			description: string
			confirmLabel: string
			resolve: (confirmed: boolean) => void
		} | null
	>(null)

	useEffect(() => {
		void load()
	}, [load])

	const selectedItem = useMemo(() => allItems.find((item) => item.id === selectedItemId), [allItems, selectedItemId])
	const sortedItems = useMemo(() => {
		return [...items].sort((a, b) => {
			const aDate = new Date(b[itemSortField]).getTime()
			const bDate = new Date(a[itemSortField]).getTime()
			if (Number.isNaN(aDate) && Number.isNaN(bDate)) return 0
			if (Number.isNaN(aDate)) return 1
			if (Number.isNaN(bDate)) return -1
			return aDate - bDate
		})
	}, [items, itemSortField])
	const detailsHeader = editorMode === 'create' ? 'New item' : selectedItem ? getItemDisplayValue(selectedItem) : 'Details'
	const detailsFormId = 'item-details-form'

	const requestDeleteConfirmation = (description: string, title = 'Confirm delete'): Promise<boolean> =>
		new Promise((resolve) => {
			setConfirmState({
				title,
				description,
				confirmLabel: 'Delete',
				resolve,
			})
		})

	const handleCreate = async (input: ItemInput) => {
		setIsSubmitting(true)
		try {
			await createItem(input)
			setEditorMode('none')
		} finally {
			setIsSubmitting(false)
		}
	}

	const handleUpdate = async (input: ItemInput) => {
		if (!selectedItemId) {
			return
		}
		setIsSubmitting(true)
		try {
			await updateItem(selectedItemId, input)
			setEditorMode('view')
		} finally {
			setIsSubmitting(false)
		}
	}

	const handleExport = async () => {
		const exportData = {
			items: allItems,
			timers,
			itemTimerLinks,
			itemLinks,
		}
		const exportDataJson = JSON.stringify(exportData)
		const encoder = new TextEncoder()
		const data = encoder.encode(exportDataJson)
		const hashBuffer = await crypto.subtle.digest('SHA-256', data)
		const hashArray = Array.from(new Uint8Array(hashBuffer))
		const checksum = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

		const timestamp = new Date().toISOString()
		const payload = {
			metadata: {
				version: '1',
				date: timestamp,
				checksum,
			},
			...exportData,
		}
		const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = `items-export-${timestamp.replace(/[:.]/g, '-')}.json`
		document.body.append(link)
		link.click()
		link.remove()
		URL.revokeObjectURL(url)
	}

	const handleImportClick = () => {
		fileInputRef.current?.click()
	}

	const handleImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		event.target.value = ''
		if (!file) {
			return
		}
		void (async () => {
			setIsImporting(true)
			setImportError(null)
			try {
				const rawJson = await file.text()
				await importV1SnapshotFromJson(rawJson)
				await load()
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Import failed.'
				setImportError(message)
				console.error('[ImportV1]', message)
			} finally {
				setIsImporting(false)
			}
		})()
	}

	const openReportsPage = () => {
		window.location.pathname = '/reports'
	}
	const openTimersPage = () => {
		window.location.pathname = '/timers'
	}

	return (
		<Grid container spacing={3}>
			<Grid
				item
				xs={12}
				md={12}
				sx={{
					flexBasis: { md: '40%' },
					maxWidth: { md: '40%' },
				}}
			>
				<Card sx={{ height: 'calc(100vh - 48px)', minHeight: 600, display: 'flex', flexDirection: 'column' }}>
					<CardContent sx={{ flexGrow: 1, minHeight: 0 }}>
						<Stack spacing={2} sx={{ height: '100%' }}>
							<ItemsToolbar
								isImporting={isImporting}
								fileInputRef={fileInputRef}
								onExport={handleExport}
								onImportClick={handleImportClick}
								onImportFileChange={handleImportFileChange}
								onOpenReports={openReportsPage}
								onOpenTimers={openTimersPage}
								onAddClick={() => {
									setSelectedItemId(null)
									setEditorMode('create')
								}}
							/>

							<ItemsFilter
								searchQuery={searchQuery}
								onSearchQueryChange={setSearchQuery}
								allTags={tags}
								selectedTags={selectedTags}
								onSelectedTagsChange={setSelectedTags}
								sortField={itemSortField}
								onSortFieldChange={setItemSortField}
							/>

							{isLoading && <CircularProgress size={20} />}
							{isImporting && <CircularProgress size={20} />}
							{error && <Alert severity="error">{error}</Alert>}
							{importError && <Alert severity="error">{importError}</Alert>}
							<Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
								<ItemList
									items={sortedItems}
									selectedItemId={selectedItemId}
									selectedTags={selectedTags}
									onView={(id) => {
										setSelectedItemId(id)
										setEditorMode('view')
									}}
									onToggleTag={(tag) => {
										setSelectedTags(selectedTags.includes(tag) ? selectedTags.filter((value) => value !== tag) : [...selectedTags, tag])
									}}
									onDelete={(id) => {
										void (async () => {
											const item = allItems.find((candidate) => candidate.id === id)
											const itemTitle = item ? getItemDisplayTitle(item) : '-'
											if (await requestDeleteConfirmation(`This action cannot be undone. Delete "${itemTitle}"?`, 'Delete item?')) {
												await deleteItem(id)
											}
										})()
									}}
								/>
							</Box>
						</Stack>
					</CardContent>
				</Card>
			</Grid>

			<Grid
				item
				xs={12}
				md={12}
				sx={{
					flexBasis: { md: '60%' },
					maxWidth: { md: '60%' },
					overflowY: 'auto',
				}}
			>
				<Card sx={{ height: 'calc(100vh - 48px)', minHeight: 600, display: 'flex', flexDirection: 'column' }}>
					<CardContent sx={{ flexGrow: 1, overflowY: 'auto' }}>
						<Stack spacing={2}>
							<Stack direction="row" justifyContent="space-between" alignItems="center">
								<Typography variant="h6">{detailsHeader}</Typography>
								{editorMode === 'view' && selectedItem && (
									<Button variant="outlined" size="small" onClick={() => setEditorMode('edit')}>
										Edit
									</Button>
								)}
								{(editorMode === 'create' || editorMode === 'edit') && (
									<Stack direction="row" spacing={1}>
										<Button type="submit" form={detailsFormId} variant="contained" size="small" disabled={isSubmitting}>
											Save
										</Button>
										<Button
											variant="text"
											size="small"
											disabled={isSubmitting}
											onClick={() => setEditorMode(editorMode === 'create' ? 'none' : 'view')}
										>
											Cancel
										</Button>
									</Stack>
								)}
							</Stack>
							<Divider />
							{editorMode === 'none' && <Typography color="text.secondary">Select an item to view details or create a new one.</Typography>}
							{editorMode === 'create' && (
								<ItemEditor
									itemLinks={itemLinks}
									tagHints={tags}
									infoLabelHints={infoLabelHints}
									relationshipTypeHints={relationshipTypeHints}
									targetItems={allItems}
									timers={timers}
									itemTimerLinks={itemTimerLinks}
									formId={detailsFormId}
									onConfirmDelete={(label) => requestDeleteConfirmation(label)}
									onSubmit={handleCreate}
									onCreateTimer={createTimer}
									onUpdateTimer={updateTimer}
									onLinkTimer={async (itemId, timerId) => {
										await createItemTimerLink({ itemId, timerId, lastCheckedAt: new Date(0).toISOString() })
									}}
									onUnlinkTimer={deleteItemTimerLink}
								/>
							)}
							{editorMode === 'edit' && selectedItem && (
								<ItemEditor
									item={selectedItem}
									itemLinks={itemLinks}
									tagHints={tags}
									infoLabelHints={infoLabelHints}
									relationshipTypeHints={relationshipTypeHints}
									targetItems={allItems}
									timers={timers}
									itemTimerLinks={itemTimerLinks}
									formId={detailsFormId}
									onConfirmDelete={(label) => requestDeleteConfirmation(label)}
									onSubmit={handleUpdate}
									onCreateTimer={createTimer}
									onUpdateTimer={updateTimer}
									onLinkTimer={async (itemId, timerId) => {
										await createItemTimerLink({ itemId, timerId, lastCheckedAt: new Date(0).toISOString() })
									}}
									onUnlinkTimer={deleteItemTimerLink}
								/>
							)}
							{editorMode === 'view' && selectedItem && <ItemView item={selectedItem} />}
							{editorMode !== 'create' && !selectedItem && <Typography color="text.secondary">No item selected.</Typography>}
						</Stack>
					</CardContent>
				</Card>
			</Grid>
			<Dialog
				open={confirmState !== null}
				onClose={() => {
					if (!confirmState) {
						return
					}
					confirmState.resolve(false)
					setConfirmState(null)
				}}
			>
				<DialogTitle>{confirmState?.title ?? 'Confirm delete'}</DialogTitle>
				<DialogContent>
					<DialogContentText>{confirmState?.description ?? ''}</DialogContentText>
				</DialogContent>
				<DialogActions>
					<Button
						onClick={() => {
							if (!confirmState) {
								return
							}
							confirmState.resolve(false)
							setConfirmState(null)
						}}
					>
						Cancel
					</Button>
					<Button
						color="error"
						variant="contained"
						onClick={() => {
							if (!confirmState) {
								return
							}
							confirmState.resolve(true)
							setConfirmState(null)
						}}
					>
						{confirmState?.confirmLabel ?? 'Delete'}
					</Button>
				</DialogActions>
			</Dialog>
		</Grid>
	)
}
