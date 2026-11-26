import { Box, InputBase, List, ListItemButton, ListItemText, Paper, Typography } from '@mui/material'
import { getItemDisplayValue } from 'src/ui-core/models/item/helpers'
import type { Item } from 'src/ui-core/models/item/types'

interface ReportSidebarProps {
	items: Array<Item>
	totalCount: number
	searchQuery: string
	onSearchChange: (q: string) => void
	selectedItemId: string | null
	onSelectItem: (id: string | null) => void
	itemLinkCounts: Map<string, number>
}

export function ReportSidebar({
	items,
	totalCount,
	searchQuery,
	onSearchChange,
	selectedItemId,
	onSelectItem,
	itemLinkCounts,
}: ReportSidebarProps) {
	return (
		<Paper
			elevation={0}
			className="relationships-report-sidebar"
			sx={{
				width: 280,
				display: 'flex',
				flexDirection: 'column',
				border: '1px solid',
				borderColor: 'divider',
				overflow: 'hidden',
			}}
		>
			<Box sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
				<InputBase
					placeholder="Поиск по полям и имени..."
					value={searchQuery}
					onChange={(e) => onSearchChange(e.target.value)}
					sx={{ fontSize: '0.875rem', width: '100%' }}
				/>
			</Box>

			<List sx={{ flex: 1, overflowY: 'auto', p: 0 }}>
				{items.map((item) => {
					const count = itemLinkCounts.get(item.id) || 0
					const isSelected = selectedItemId === item.id
					const displayTitle = getItemDisplayValue(item) || 'Без названия'

					return (
						<ListItemButton
							key={item.id}
							selected={isSelected}
							onClick={() => onSelectItem(item.id)}
							sx={{ py: 0.5, px: 1.5 }}
						>
							<ListItemText
								primary={displayTitle}
								primaryTypographyProps={{
									variant: 'body2',
									noWrap: true,
									fontWeight: isSelected ? 600 : 400,
								}}
							/>
							<Typography
								variant="caption"
								sx={{
									ml: 1,
									px: 0.8,
									py: 0.2,
									borderRadius: 1,
									bgcolor: count > 0 ? 'action.selected' : 'action.hover',
									color: count > 0 ? 'text.primary' : 'text.disabled',
									fontWeight: 600,
								}}
							>
								{count}
							</Typography>
						</ListItemButton>
					)
				})}
			</List>

			<Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
				<Typography variant="caption" color="text.secondary" display="block" align="center">
					Найдено: {items.length} из {totalCount}
				</Typography>
			</Box>
		</Paper>
	)
}
