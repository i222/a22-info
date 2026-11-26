import { getItemDisplayValue } from '@/models/item/helpers'
import type { Item } from '@/models/item/types'
import Delete from '@mui/icons-material/Delete'
import { Chip, IconButton, List, ListItem, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'

interface ItemListProps {
	items: Array<Item>
	selectedItemId: string | null
	selectedTags: Array<string>
	onView: (id: string) => void
	onDelete: (id: string) => void
	onToggleTag: (tag: string) => void
}

export function ItemList({ items, selectedItemId, selectedTags, onView, onDelete, onToggleTag }: ItemListProps) {
	if (items.length === 0) {
		return <Typography color="text.secondary">No items found.</Typography>
	}

	return (
		<List disablePadding>
			{items.map((item) => (
				<ListItem key={item.id} divider disablePadding>
					<ListItemButton selected={selectedItemId === item.id} onClick={() => onView(item.id)} sx={{ py: 1 }}>
						<ListItemText
							primary={getItemDisplayValue(item)}
							secondaryTypographyProps={{ component: 'div' }}
							secondary={
								<Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
									{item.tags.map((tag) => (
										<Chip
											key={tag}
											label={tag}
											size="small"
											variant={selectedTags.includes(tag) ? 'filled' : 'outlined'}
											color="primary"
											clickable
											onClick={(event) => {
												event.stopPropagation()
												onToggleTag(tag)
											}}
										/>
									))}
								</Stack>
							}
						/>
						<IconButton
							edge="end"
							aria-label="Delete item"
							onClick={(event) => {
								event.stopPropagation()
								onDelete(item.id)
							}}
						>
							<Delete />
						</IconButton>
					</ListItemButton>
				</ListItem>
			))}
		</List>
	)
}
