import { TagQuickFilter } from '@/components/item/TagQuickFilter'
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded'
import SaveRounded from '@mui/icons-material/SaveRounded'
import { Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { openReportWindow } from 'src/ui-core/platform/openReportWindow'
import { useItemStore } from 'src/ui-core/store/itemStore'
import { loadBasicReportFontSize, loadBasicReportTagOrder, parseTagOrderInput, saveBasicReportFontSize, saveBasicReportTagOrder, stringifyTagOrder } from './reportConfig'

export function ReportsPage() {
	const allTags = useItemStore((state) => state.tags)
	const load = useItemStore((state) => state.load)
	const [tagOrderInput, setTagOrderInput] = useState(() => stringifyTagOrder(loadBasicReportTagOrder()))
	const [fontSizeInput, setFontSizeInput] = useState(() => String(loadBasicReportFontSize()))
	const normalizedTags = useMemo(() => parseTagOrderInput(tagOrderInput), [tagOrderInput])

	useEffect(() => {
		if (allTags.length === 0) {
			void load()
		}
	}, [allTags.length, load])

	const saveConfig = () => {
		saveBasicReportTagOrder(normalizedTags)
		const parsedFontSize = Number.parseFloat(fontSizeInput)
		saveBasicReportFontSize(Number.isNaN(parsedFontSize) ? 11 : parsedFontSize)
	}

	const openBasicReport = () => {
		saveConfig()
		void openReportWindow('basic')
	}

	const openRelationshipsReport = () => {
		void openReportWindow('relationships')
	}

	return (
		<Stack spacing={2}>
			<Typography variant="h4">Reports</Typography>
			<Card>
				<CardContent>
					<Stack spacing={1.5}>
						<Typography variant="h6">Base report</Typography>
						<Typography variant="body2" color="text.secondary">
							Basic A4 portrait report with all items in 3 columns.
						</Typography>
						<Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'flex-start' }}>
							<Stack sx={{ flex: 1, minWidth: 0 }}>
								<TagQuickFilter
									allTags={allTags}
									value={normalizedTags}
									onChange={(tags) => setTagOrderInput(stringifyTagOrder(tags))}
									label="Tags order for grouping"
									placeholder="Select one or more tags"
								/>
							</Stack>
							<TextField
								size="small"
								type="number"
								label="Font size"
								value={fontSizeInput}
								onChange={(event) => setFontSizeInput(event.target.value)}
								inputProps={{ min: 8, max: 16, step: 0.5 }}
								helperText="Report font size in px (8-16)."
								sx={{ width: { xs: '100%', md: 170 } }}
							/>
						</Stack>
						<Stack direction="row" spacing={1}>
							<Button variant="outlined" startIcon={<SaveRounded />} onClick={saveConfig}>
								Сохранить настройки
							</Button>
							<Button variant="contained" endIcon={<OpenInNewRounded />} onClick={openBasicReport}>
								Показать отчет
							</Button>
						</Stack>
					</Stack>
				</CardContent>
			</Card>
			<Card>
				<CardContent>
					<Stack spacing={1.5}>
						<Typography variant="h6">Relationships report</Typography>
						<Typography variant="body2" color="text.secondary">
							Visualize item relationships with tag filtering and relationship type selection.
						</Typography>
						<Typography variant="body2" color="text.secondary">
							Shows items as nodes connected by relationships. Filter by tags and relationship types.
						</Typography>
						<Stack direction="row" spacing={1}>
							<Button variant="contained" endIcon={<OpenInNewRounded />} onClick={openRelationshipsReport}>
								Показать отчет
							</Button>
						</Stack>
					</Stack>
				</CardContent>
			</Card>
		</Stack>
	)
}
