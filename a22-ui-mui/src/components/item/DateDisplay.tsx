import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { formatDateShort } from 'src/ui-core/models/item/dateHelpers'

interface DateDisplayProps {
	value: string | number
}

export function DateDisplay({ value }: DateDisplayProps) {
	const { display, full } = formatDateShort(value)
	const [_copyStatus, setCopyStatus] = useState<string | null>(null)
	const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		return () => {
			if (statusTimeoutRef.current) {
				clearTimeout(statusTimeoutRef.current)
			}
		}
	}, [])

	const copyValue = async (value: string) => {
		if (!navigator.clipboard) return
		try {
			await navigator.clipboard.writeText(value)
			setCopyStatus('Copied')
			if (statusTimeoutRef.current) {
				clearTimeout(statusTimeoutRef.current)
			}
			statusTimeoutRef.current = setTimeout(() => setCopyStatus(null), 1200)
		} catch (error) {
			console.error('Failed to copy text: ', error)
		}
	}

	return (
		<Box display="inline-flex" alignItems="center" gap={0.25}>
			<Tooltip title={full}>
				<Typography variant="body2" sx={{ fontWeight: 400 }}>
					{display}
				</Typography>
			</Tooltip>
			<IconButton size="small" sx={{ p: 0.25 }} aria-label="copy value" onClick={() => void copyValue(display)}>
				<ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
			</IconButton>
		</Box>
	)
}
