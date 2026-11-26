import { DateDisplay } from '@/components/item/DateDisplay'
import { getTimerViewState } from '@/components/item/timerViewModel'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getItemDisplayValue } from 'src/ui-core/models/item/helpers'
import type { Item } from 'src/ui-core/models/item/types'
import { useItemStore } from 'src/ui-core/store/itemStore'

interface ItemViewProps {
	item: Item
}

export function ItemView({ item }: ItemViewProps) {
	const cycleItemTimerLink = useItemStore((state) => state.cycleItemTimerLink)

	// 1. Берутся стабильные массивы из Zustand (без inline .filter в селекторе!)
	const allItems = useItemStore((state) => state.items)
	const timers = useItemStore((state) => state.timers)
	const itemLinks = useItemStore((state) => state.itemLinks)
	const itemTimerLinks = useItemStore((state) => state.itemTimerLinks)
	const timerStatuses = useItemStore((state) => state.timerStatuses)

	// 2. Фильтрация строго через useMemo
	const connectedToLinks = useMemo(
		() => itemLinks.filter((link) => link.itemId === item.id),
		[itemLinks, item.id],
	)

	const connectedFromLinks = useMemo(
		() => itemLinks.filter((link) => link.targetId === item.id),
		[itemLinks, item.id],
	)

	const itemMap = useMemo(
		() => new Map(allItems.map((candidate) => [candidate.id, candidate])),
		[allItems],
	)

	const getTargetLabel = useCallback(
		(targetId: string): string => {
			const target = itemMap.get(targetId)
			return target ? getItemDisplayValue(target) : '-'
		},
		[itemMap],
	)

	const [copyStatus, setCopyStatus] = useState<string | null>(null)
	const [checkStatus, setCheckStatus] = useState<string | null>(null)

	const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		return () => {
			if (statusTimeoutRef.current) {
				clearTimeout(statusTimeoutRef.current)
			}
		}
	}, [])

	const showStatus = useCallback(
		(setter: (msg: string | null) => void, message: string) => {
			setter(message)
			if (statusTimeoutRef.current) {
				clearTimeout(statusTimeoutRef.current)
			}
			statusTimeoutRef.current = setTimeout(() => setter(null), 1200)
		},
		[],
	)

	const copyValue = useCallback(
		async (value: string) => {
			if (!navigator.clipboard) return
			try {
				await navigator.clipboard.writeText(value)
				showStatus(setCopyStatus, 'Copied')
			} catch (error) {
				console.error('Failed to copy text: ', error)
			}
		},
		[showStatus],
	)

	const handleCycleTimer = useCallback(
		async (linkId: string, statusMessage: string) => {
			await cycleItemTimerLink(linkId)
			showStatus(setCheckStatus, statusMessage)
		},
		[cycleItemTimerLink, showStatus],
	)

	const timersMap = useMemo(
		() => new Map(timers.map((timer) => [timer.id, timer])),
		[timers],
	)

	const timerRows = useMemo(() => {
		return itemTimerLinks
			.filter((link) => link.itemId === item.id)
			.map((link) => {
				const timer = timersMap.get(link.timerId)
				return timer ? { timer, link } : null
			})
			.filter((row): row is NonNullable<typeof row> => row !== null)
	}, [item.id, itemTimerLinks, timersMap])

	return (
		<Stack spacing={1.25}>
			{item.tags.length > 0 && (
				<Stack direction="row" spacing={1}>
					{item.tags.map((tag) => <Chip key={tag} label={tag} size="small" variant="outlined" color="primary" />)}
				</Stack>
			)}

			{item.infoEntries.length > 0 && (
				<Stack spacing={0.25}>
					<Typography variant="body2" color="text.secondary" sx={{ fontWeight: 900 }}>
						Info
					</Typography>
					{item.infoEntries.map((entry, index) => (
						<Stack key={`${entry.label}-${entry.value}-${index}`} direction="row" spacing={0.25} sx={{ pl: 1 }} alignItems="center">
							<Typography variant="body2" sx={{ fontWeight: 400 }}>
								{entry.label}: {entry.value}
							</Typography>
							<IconButton size="small" sx={{ p: 0.25 }} aria-label="copy value" onClick={() => void copyValue(entry.value)}>
								<ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
							</IconButton>
						</Stack>
					))}
				</Stack>
			)}

			{connectedFromLinks.length > 0 && (
				<>
					<Typography variant="body2" color="text.secondary" sx={{ fontWeight: 900 }}>
						Connected from
					</Typography>
					<Stack spacing={1}>
						{connectedFromLinks.map((link) => (
							<Stack key={link.id} direction="row" spacing={0.25} sx={{ pl: 1 }} alignItems="center">
								<Typography variant="body2" sx={{ fontWeight: 400 }}>
									{link.type}: {getTargetLabel(link.itemId)}
								</Typography>
							</Stack>
						))}
					</Stack>
				</>
			)}

			{connectedToLinks.length > 0 && (
				<>
					<Typography variant="body2" color="text.secondary" sx={{ fontWeight: 900 }}>
						Connected to
					</Typography>
					<Stack spacing={1}>
						{connectedToLinks.map((link) => (
							<Stack key={link.id} direction="row" spacing={0.25} sx={{ pl: 1 }} alignItems="center">
								<Typography variant="body2" sx={{ fontWeight: 400 }}>
									{link.type}: {getTargetLabel(link.targetId)}
								</Typography>
							</Stack>
						))}
					</Stack>
				</>
			)}

			{timerRows.length > 0 && (
				<Stack spacing={0.25}>
					<Typography variant="body2" color="text.secondary" sx={{ fontWeight: 900 }}>
						Timers
					</Typography>
					{timerRows.map(({ timer, link }) => {
						const timerView = getTimerViewState(timer, link, timerStatuses[link.id])
						const isErrorState = timerView.textColor === 'error'

						return (
							<Stack
								key={timer.id}
								direction="row"
								spacing={0.25}
								sx={{
									pl: 1,
									pr: 0.5,
									py: 0.25,
									borderRadius: 0.75,
									border: '1px solid',
									borderColor: isErrorState ? 'error.main' : 'transparent',
								}}
								alignItems="center"
							>
								<Stack direction="row" spacing={0.5} alignItems="center" sx={{ width: '100%' }}>
									{timerView.dotColor && (
										<Box
											component="span"
											sx={{
												width: 8,
												height: 8,
												borderRadius: '50%',
												bgcolor: timerView.dotColor,
												...(timerView.dotPulsing && {
													animation: 'timerPulse 1s infinite ease-in-out',
													'@keyframes timerPulse': {
														'0%, 100%': { opacity: 0.2 },
														'50%': { opacity: 1 },
													},
												}),
											}}
										/>
									)}
									<Typography
										variant="body2"
										color={timerView.textColor}
										sx={{
											flex: 1,
											minWidth: 0,
											fontWeight: 400,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											display: '-webkit-box',
											WebkitLineClamp: 2,
											WebkitBoxOrient: 'vertical',
										}}
									>
										{`${timer.name} • ${timerView.text}`}
									</Typography>
									{timerView.showCheck && (
										<Tooltip title={timerView.checkTooltip}>
											<IconButton
												size="small"
												aria-label="check timer"
												onClick={() => void handleCycleTimer(link.id, 'checked now')}
											>
												<TaskAltRoundedIcon fontSize="small" />
											</IconButton>
										</Tooltip>
									)}
									{timerView.showCancel && (
										<Tooltip title={timerView.cancelTooltip}>
											<IconButton
												size="small"
												aria-label="cancel precheck"
												onClick={() => void handleCycleTimer(link.id, 'precheck canceled')}
											>
												<CloseRoundedIcon fontSize="small" />
											</IconButton>
										</Tooltip>
									)}
								</Stack>
							</Stack>
						)
					})}
				</Stack>
			)}

			{item.dateTimeEntries.length > 0 && (
				<>
					<Typography variant="body2" color="text.secondary" sx={{ fontWeight: 900 }}>
						Dates
					</Typography>
					{item.dateTimeEntries.map((entry, index) => (
						<Stack key={`${entry.label}-${entry.value}-${index}`} direction="row" spacing={0.25} sx={{ pl: 1 }} alignItems="center">
							<Typography variant="body2" component="span" sx={{ fontWeight: 400 }}>
								{entry.label}: <DateDisplay value={entry.value} />
							</Typography>
						</Stack>
					))}
				</>
			)}

			{copyStatus && (
				<Typography variant="caption" color="success.main">
					{copyStatus}
				</Typography>
			)}
			{checkStatus && (
				<Typography variant="caption" color="success.main">
					{checkStatus}
				</Typography>
			)}

			<Typography component="div" variant="body2" color="text.secondary" sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
				Created: <DateDisplay value={item.createdAt} />
				Updated: <DateDisplay value={item.updatedAt} />
			</Typography>
		</Stack>
	)
}
