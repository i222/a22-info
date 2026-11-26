import { TagQuickFilter } from '@/components/item/TagQuickFilter'
import PrintRounded from '@mui/icons-material/PrintRounded'
import { Box, Button, Checkbox, FormControlLabel, Paper, Stack, Typography } from '@mui/material'

interface ReportFiltersProps {
	tags: Array<string>
	selectedTags: Array<string>
	onTagsChange: (tags: Array<string>) => void
	typeFilters: Array<string>
	onTypeFiltersChange: (types: Array<string>) => void
	typeFilterOptions: Array<string>
	onSave: () => void
	onPrint: () => void
}

export function ReportFilters({
	tags,
	selectedTags,
	onTagsChange,
	typeFilters,
	onTypeFiltersChange,
	typeFilterOptions,
	onSave,
	onPrint,
}: ReportFiltersProps) {
	return (
		<Paper
			elevation={0}
			className="relationships-report-filters"
			sx={{
				p: 1,
				border: '1px solid',
				borderColor: 'divider',
				display: 'flex',
				alignItems: 'center',
				gap: 1.5,
				flexWrap: 'wrap',
			}}
		>
			<Box sx={{ width: 280, flexShrink: 0 }}>
				<TagQuickFilter
					allTags={tags}
					value={selectedTags}
					onChange={onTagsChange}
					label=""
					placeholder="Фильтр по тегам..."
					size="small"
				/>
			</Box>

			<Box sx={{ height: 24, width: '1px', bgcolor: 'divider' }} />

			<Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
				<Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
					Типы:
				</Typography>
				{typeFilterOptions.map((type) => {
					const isChecked = typeFilters.includes(type)
					return (
						<FormControlLabel
							key={type}
							control={
								<Checkbox
									checked={isChecked}
									onChange={(event) => {
										if (event.target.checked) {
											onTypeFiltersChange([...typeFilters, type])
										} else {
											onTypeFiltersChange(typeFilters.filter((t) => t !== type))
										}
									}}
									size="small"
									sx={{ p: 0.25 }}
								/>
							}
							label={<Typography variant="caption">{type}</Typography>}
							sx={{ mr: 1, ml: 0 }}
						/>
					)
				})}
				{typeFilters.length < typeFilterOptions.length && (
					<Button
						variant="text"
						size="small"
						onClick={() => onTypeFiltersChange(typeFilterOptions)}
						sx={{ fontSize: '0.75rem', py: 0, px: 0.5, minWidth: 'auto' }}
					>
						Все
					</Button>
				)}
			</Stack>

			<Box sx={{ ml: 'auto' }}>
				<Stack direction="row" spacing={1}>
					<Button variant="outlined" size="small" onClick={onSave}>
						Сохранить
					</Button>
					<Button variant="contained" size="small" startIcon={<PrintRounded />} onClick={onPrint}>
						Печать
					</Button>
				</Stack>
			</Box>
		</Paper>
	)
}
