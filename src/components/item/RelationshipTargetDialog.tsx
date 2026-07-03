import { TagQuickFilter } from '@/components/item/TagQuickFilter'
import { getItemDisplayValue, hasAllTags } from '@/models/item/helpers'
import type { Item } from '@/models/item/types'
import Search from '@mui/icons-material/Search'
import {
	Button,
	Checkbox,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	InputAdornment,
	List,
	ListItem,
	ListItemButton,
	ListItemText,
	Stack,
	TextField,
	Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'

interface RelationshipTargetDialogProps {
	open: boolean
	items: Array<Item>
	existingTargetIds: Array<string>
	onClose: () => void
	onAdd: (ids: Array<string>) => void
}

export function RelationshipTargetDialog({ open, items, existingTargetIds, onClose, onAdd }: RelationshipTargetDialogProps) {
	const [searchValue, setSearchValue] = useState('')
	const [selectedTags, setSelectedTags] = useState<Array<string>>([])
	const [selectedIds, setSelectedIds] = useState<Array<string>>([])

	useEffect(() => {
		if (!open) {
			return
		}
		setSearchValue('')
		setSelectedTags([])
		setSelectedIds([])
	}, [open])

	const allTags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags))).sort(), [items])
	const normalizedSearch = searchValue.trim().toLowerCase()
	const existingTargetIdsSet = useMemo(() => new Set(existingTargetIds), [existingTargetIds])

	const filteredItems = useMemo(() => {
		return items.filter((item) => {
			if (!hasAllTags(item, selectedTags)) {
				return false
			}
			if (normalizedSearch.length === 0) {
				return true
			}
			const displayValue = getItemDisplayValue(item).toLowerCase()
			const tagsValue = item.tags.join(' ').toLowerCase()
			return displayValue.includes(normalizedSearch) || tagsValue.includes(normalizedSearch)
		})
	}, [items, normalizedSearch, selectedTags])

	const toggleSelection = (id: string) => {
		if (existingTargetIdsSet.has(id)) {
			return
		}
		setSelectedIds((previous) => (previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]))
	}

	return (
		<Dialog
			open={open}
			onClose={onClose}
			fullWidth
			maxWidth="md"
			PaperProps={{
				sx: { minHeight: '600px' },
			}}
		>
			<DialogTitle>Select relationship target</DialogTitle>
			<DialogContent sx={{ display: 'flex', flexDirection: 'column' }}>
				<Stack spacing={2} sx={{ pt: 0.5, flexGrow: 1 }}>
					<Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="stretch">
						<TextField
							size="small"
							label="Search in list"
							value={searchValue}
							onChange={(event) => setSearchValue(event.target.value)}
							placeholder="Search by name or tags"
							InputProps={{
								startAdornment: (
									<InputAdornment position="start">
										<Search fontSize="small" />
									</InputAdornment>
								),
							}}
							sx={{ flex: 1 }}
						/>
						<Stack sx={{ flex: 1 }}>
							<TagQuickFilter
								allTags={allTags}
								value={selectedTags}
								onChange={setSelectedTags}
								label="Quick filter by tags"
								placeholder="Select tags"
								size="small"
							/>
						</Stack>
					</Stack>
					{filteredItems.length === 0
						? (
							<Typography variant="body2" color="text.secondary">
								No items match current filters.
							</Typography>
						)
						: (
							<List disablePadding>
								{filteredItems.map((item) => (
									<ListItem key={item.id} divider disablePadding>
										<ListItemButton
											selected={selectedIds.includes(item.id)}
											disabled={existingTargetIdsSet.has(item.id)}
											onClick={() => toggleSelection(item.id)}
										>
											<Checkbox
												size="small"
												checked={selectedIds.includes(item.id) || existingTargetIdsSet.has(item.id)}
												disabled={existingTargetIdsSet.has(item.id)}
											/>
											<ListItemText
												primary={getItemDisplayValue(item)}
												secondary={existingTargetIdsSet.has(item.id) ? 'Already linked' : item.tags.join(', ') || 'No tags'}
												secondaryTypographyProps={{ variant: 'caption' }}
											/>
										</ListItemButton>
									</ListItem>
								))}
							</List>
						)}
				</Stack>
			</DialogContent>
			<DialogActions>
				<Button
					variant="contained"
					disabled={selectedIds.length === 0}
					onClick={() => {
						onAdd(selectedIds)
					}}
				>
					Add selected ({selectedIds.length})
				</Button>
				<Button onClick={onClose}>Close</Button>
			</DialogActions>
		</Dialog>
	)
}
