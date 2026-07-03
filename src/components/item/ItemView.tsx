import { getTimerViewState } from '@/components/item/timerViewModel'
import { useItemStore } from '@/lib/item/store/itemStore'
import { getItemDisplayValue } from '@/models/item/helpers'
import type { Item } from '@/models/item/types'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'

interface ItemViewProps {
	item: Item
}

function formatDateTime(value: string): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value
	}

	return date.toLocaleString('ru-RU')
}

export function ItemView({ item }: ItemViewProps) {
	const allItems = useItemStore((state) => state.items)
	const timers = useItemStore((state) => state.timers)
	const itemTimerLinks = useItemStore((state) => state.itemTimerLinks)
	const itemLinks = useItemStore((state) => state.itemLinks)
	const cycleItemTimerLink = useItemStore((state) => state.cycleItemTimerLink)
	const itemById = useMemo(() => new Map(allItems.map((candidate) => [candidate.id, candidate])), [allItems])
	const timerById = useMemo(() => new Map(timers.map((timer) => [timer.id, timer])), [timers])
	const getRelationshipTargetLabel = (targetId: string): string => {
		const target = itemById.get(targetId)
		return target ? getItemDisplayValue(target) : '-'
	}
	const [copyStatus, setCopyStatus] = useState<string | null>(null)
	const [checkStatus, setCheckStatus] = useState<string | null>(null)
	const [now, setNow] = useState(() => new Date())

	useEffect(() => {
		const intervalId = window.setInterval(() => setNow(new Date()), 30 * 1000)
		return () => window.clearInterval(intervalId)
	}, [])

	const copyValue = async (value: string) => {
		if (!navigator.clipboard) {
			return
		}
		await navigator.clipboard.writeText(value)
		setCopyStatus('Copied')
		window.setTimeout(() => setCopyStatus(null), 1200)
	}
	const relationships = useMemo(() => {
		return itemLinks.filter((link) => link.itemId === item.id)
	}, [itemLinks, item.id])

	const relationshipCounts = useMemo(() => {
		const counts = new Map<string, number>()
		for (const relationship of relationships) {
			const key = `${relationship.type}::${relationship.targetId}`
			counts.set(key, (counts.get(key) ?? 0) + 1)
		}
		return counts
	}, [relationships])
	const relationshipValidation = useMemo(
		() =>
			relationships.map((relationship) => {
				const duplicateKey = `${relationship.type}::${relationship.targetId}`
				if (relationship.targetId === item.id) {
					return { isValid: false, message: 'self-reference is not allowed' }
				}
				if (!itemById.has(relationship.targetId)) {
					return { isValid: false, message: 'target item does not exist' }
				}
				if ((relationshipCounts.get(duplicateKey) ?? 0) > 1) {
					return { isValid: false, message: 'duplicate relationship' }
				}
				return { isValid: true, message: '' }
			}),
		[relationships, item.id, itemById, relationshipCounts],
	)
	const relationshipRows = useMemo(() => {
		const occurrences = new Map<string, number>()
		return relationships.map((relationship, index) => {
			const baseKey = `${relationship.type}::${relationship.targetId}`
			const occurrence = (occurrences.get(baseKey) ?? 0) + 1
			occurrences.set(baseKey, occurrence)
			return {
				relationship,
				validation: relationshipValidation[index],
				key: `${baseKey}::${occurrence}`,
			}
		})
	}, [relationships, relationshipValidation])
	const invalidRelationshipsCount = relationshipValidation.filter((entry) => !entry.isValid).length
	const timerRows = useMemo(
		() => {
			const rows = itemTimerLinks
				.filter((link) => link.itemId === item.id)
				.map((link) => {
					const timer = timerById.get(link.timerId)
					return timer ? { timer, link } : null
				})
				.filter(Boolean)
			return rows as Array<{ timer: (typeof timers)[number]; link: (typeof itemTimerLinks)[number] }>
		},
		[itemTimerLinks, item.id, timerById],
	)

	return (
		<Stack spacing={1.25}>
			{
				/* mainInfoEntry ? (
				<Stack spacing={0.25}>
					<Typography variant="subtitle1">{mainInfoEntry.label}</Typography>
					<Typography variant="body2" color="text.secondary">
						{mainInfoEntry.value}
					</Typography>
				</Stack>
			) : (
				<Typography variant="subtitle1">{fallbackTitle}</Typography>
			)} */
			}
			<Stack direction="row" spacing={1}>
				{item.tags.map((tag) => <Chip key={tag} label={tag} size="small" variant="outlined" color="primary" />)}
			</Stack>
			<Stack spacing={0.25}>
				<Typography variant="body2" color="text.secondary" sx={{ fontWeight: 900 }}>
					Info
				</Typography>
				{item.infoEntries.length === 0 && <Typography variant="body2" color="text.secondary">-</Typography>}
				{item.infoEntries.map((entry) => (
					<Stack key={`${entry.label}-${entry.value}`} direction="row" spacing={0.25} sx={{ pl: 1 }} alignItems="center">
						<Typography variant="body2" sx={{ fontWeight: 400 }}>
							{entry.label}: {entry.value}
						</Typography>
						<IconButton size="small" sx={{ p: 0.25 }} aria-label="copy value" onClick={() => void copyValue(entry.value)}>
							<ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
						</IconButton>
					</Stack>
				))}
			</Stack>
			<Stack spacing={0.25}>
				<Typography variant="body2" color="text.secondary" sx={{ fontWeight: 900 }}>
					Relationships
				</Typography>
				{invalidRelationshipsCount > 0 && (
					<Typography variant="body2" color="error" sx={{ pl: 1 }}>
						Found invalid relationships: {invalidRelationshipsCount}
					</Typography>
				)}
				{relationships.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400, pl: 1 }}>-</Typography>}
				{relationshipRows.map(({ relationship, validation, key }) => (
					<Stack key={key} direction="row" spacing={0.25} sx={{ pl: 1 }} alignItems="center">
						<Typography variant="body2" color={validation?.isValid ? 'text.primary' : 'error'} sx={{ fontWeight: 400 }}>
							{relationship.type} - {getRelationshipTargetLabel(relationship.targetId)}
							{validation?.isValid ? '' : ` (${validation?.message})`}
						</Typography>
						<IconButton
							size="small"
							sx={{ p: 0.25 }}
							aria-label="copy relationship value"
							onClick={() => void copyValue(getRelationshipTargetLabel(relationship.targetId))}
						>
							<ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
						</IconButton>
					</Stack>
				))}
			</Stack>
			<Stack spacing={0.25}>
				<Typography variant="body2" color="text.secondary" sx={{ fontWeight: 900 }}>
					Timers
				</Typography>
				{timerRows.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400, pl: 1 }}>-</Typography>}
				{timerRows.map(({ timer, link }) => {
					const timerView = getTimerViewState(timer, link, now)
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
								border: timerView.textColor === 'error' ? '1px solid' : '1px solid transparent',
								borderColor: timerView.textColor === 'error' ? 'error.main' : 'transparent',
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
											...(timerView.dotPulsing
												? {
													animation: 'timerPulse 1s infinite ease-in-out',
													'@keyframes timerPulse': {
														'0%, 100%': { opacity: 0.2 },
														'50%': { opacity: 1 },
													},
												}
												: {}),
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
											onClick={() => {
												void (async () => {
													await cycleItemTimerLink(link.id, now.toISOString())
													setCheckStatus('checked now')
													window.setTimeout(() => setCheckStatus(null), 1200)
												})()
											}}
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
											onClick={() => {
												void (async () => {
													await cycleItemTimerLink(link.id, now.toISOString())
													setCheckStatus('precheck canceled')
													window.setTimeout(() => setCheckStatus(null), 1200)
												})()
											}}
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
			<Stack spacing={0.25}>
				<Typography variant="body2" color="text.secondary">
					Created: {formatDateTime(item.createdAt)}
				</Typography>
				<Typography variant="body2" color="text.secondary">
					Updated: {formatDateTime(item.updatedAt)}
				</Typography>
			</Stack>
		</Stack>
	)
}
