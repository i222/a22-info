import { TagQuickFilter } from '@/components/item/TagQuickFilter'
import ClearRounded from '@mui/icons-material/ClearRounded'
import SortRounded from '@mui/icons-material/SortRounded'
import { Box, IconButton, Stack, TextField, Tooltip } from '@mui/material'

export type ItemSortField = 'updatedAt' | 'createdAt'

interface ItemsFilterProps {
	searchQuery: string
	onSearchQueryChange: (query: string) => void
	allTags: string[]
	selectedTags: string[]
	onSelectedTagsChange: (tags: string[]) => void
	sortField: ItemSortField
	onSortFieldChange: (field: ItemSortField) => void
}

export function ItemsFilter({
	searchQuery,
	onSearchQueryChange,
	allTags,
	selectedTags,
	onSelectedTagsChange,
	sortField,
	onSortFieldChange,
}: ItemsFilterProps) {
	const toggleSort = () => {
		onSortFieldChange(sortField === 'updatedAt' ? 'createdAt' : 'updatedAt')
	}

	const sortTooltipLabel = sortField === 'updatedAt' ? 'Sorted by: Updated' : 'Sorted by: Created'

	return (
		<Stack direction="row" spacing={1} alignItems="center">
			<TextField
				size="small"
				label="Search"
				placeholder="Search in all fields except tags"
				value={searchQuery}
				onChange={(event) => onSearchQueryChange(event.target.value)}
				sx={{ width: 130, flexShrink: 0 }}
				InputProps={{
					endAdornment: searchQuery
						? (
							<IconButton size="small" aria-label="Clear search" onClick={() => onSearchQueryChange('')} edge="end">
								<ClearRounded fontSize="small" />
							</IconButton>
						)
						: undefined,
				}}
			/>

			<Box sx={{ flex: 1, minWidth: 0 }}>
				<TagQuickFilter allTags={allTags} value={selectedTags} onChange={onSelectedTagsChange} />
			</Box>

			<Tooltip title={sortTooltipLabel}>
				<IconButton
					color="primary"
					onClick={toggleSort}
					aria-label={sortTooltipLabel}
					sx={{
						border: '1px solid',
						borderColor: 'divider',
						borderRadius: 1,
						p: '7px',
						flexShrink: 0,
					}}
				>
					<SortRounded fontSize="small" />
				</IconButton>
			</Tooltip>
		</Stack>
	)
}
