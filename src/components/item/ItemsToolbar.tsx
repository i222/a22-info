import Add from '@mui/icons-material/Add'
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import FileUploadOutlined from '@mui/icons-material/FileUploadOutlined'
import TimerOutlined from '@mui/icons-material/TimerOutlined'
import { Button, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import type { ChangeEvent, RefObject } from 'react'

interface ItemsToolbarProps {
	title?: string
	isImporting: boolean
	fileInputRef: RefObject<HTMLInputElement>
	onExport: () => void
	onImportClick: () => void
	onImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void
	onOpenReports: () => void
	onOpenTimers: () => void
	onAddClick: () => void
}

export function ItemsToolbar({
	title = 'Base',
	isImporting,
	fileInputRef,
	onExport,
	onImportClick,
	onImportFileChange,
	onOpenReports,
	onOpenTimers,
	onAddClick,
}: ItemsToolbarProps) {
	return (
		<Stack direction="row" justifyContent="space-between" alignItems="center">
			<Typography variant="h5">{title}</Typography>
			<Stack direction="row" spacing={1} alignItems="center">
				<input
					ref={fileInputRef}
					type="file"
					accept="application/json,.json"
					style={{ display: 'none' }}
					onChange={onImportFileChange}
				/>
				<Tooltip title="Export">
					<IconButton size="small" color="primary" onClick={onExport} aria-label="Export items">
						<FileDownloadOutlined fontSize="small" />
					</IconButton>
				</Tooltip>
				<Tooltip title="Import">
					<IconButton size="small" color="primary" aria-label="Import items" onClick={onImportClick} disabled={isImporting}>
						<FileUploadOutlined fontSize="small" />
					</IconButton>
				</Tooltip>
				<Tooltip title="Reports">
					<IconButton size="small" color="primary" aria-label="Open reports" onClick={onOpenReports}>
						<AssessmentOutlined fontSize="small" />
					</IconButton>
				</Tooltip>
				<Tooltip title="Timers">
					<IconButton size="small" color="primary" aria-label="Open timers" onClick={onOpenTimers}>
						<TimerOutlined fontSize="small" />
					</IconButton>
				</Tooltip>
				<Button startIcon={<Add />} variant="contained" onClick={onAddClick}>
					Add
				</Button>
			</Stack>
		</Stack>
	)
}
