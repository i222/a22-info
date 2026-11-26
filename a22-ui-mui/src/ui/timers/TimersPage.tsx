import { TimerDialog } from '@/components/item/TimerDialog'
import { getTimerViewState } from '@/components/item/timerViewModel'
import Add from '@mui/icons-material/Add'
import ArrowBack from '@mui/icons-material/ArrowBack'
import CloseRounded from '@mui/icons-material/CloseRounded'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import EditOutlined from '@mui/icons-material/EditOutlined'
import TaskAltRounded from '@mui/icons-material/TaskAltRounded'
import {
	Button,
	Card,
	CardContent,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	Divider,
	Grid,
	IconButton,
	List,
	ListItem,
	ListItemButton,
	ListItemText,
	Stack,
	Tooltip,
	Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { formatTimerBaseAt } from 'src/ui-core/models/item/helpers'
import { formatTimerShortDate, timerHasExplicitTime } from 'src/ui-core/models/item/timerLogic'
import type { Timer } from 'src/ui-core/models/item/types'
import { useItemStore } from 'src/ui-core/store/itemStore'

export function TimersPage() {
	const timers = useItemStore((state) => state.timers)
	const items = useItemStore((state) => state.items)
	const itemTimerLinks = useItemStore((state) => state.itemTimerLinks)
	const createTimer = useItemStore((state) => state.createTimer)
	const updateTimer = useItemStore((state) => state.updateTimer)
	const deleteTimer = useItemStore((state) => state.deleteTimer)
	const cycleItemTimerLink = useItemStore((state) => state.cycleItemTimerLink)
	const load = useItemStore((state) => state.load)
	const timerStatuses = useItemStore((state) => state.timerStatuses)

	const [selectedTimerId, setSelectedTimerId] = useState<string | null>(timers[0]?.id ?? null)
	useEffect(() => {
		void load()
	}, [load])
	useEffect(() => {
		if (!selectedTimerId && timers.length > 0) {
			setSelectedTimerId(timers[0].id)
		}
	}, [selectedTimerId, timers])

	const [dialogState, setDialogState] = useState<{ open: boolean; timer?: Timer }>({ open: false })
	const [deleteConfirmTimerId, setDeleteConfirmTimerId] = useState<string | null>(null)
	const [checkStatus, setCheckStatus] = useState<string | null>(null)

	const selectedTimer = useMemo(() => timers.find((timer) => timer.id === selectedTimerId) ?? null, [timers, selectedTimerId])
	const deleteConfirmTimer = useMemo(
		() => timers.find((timer) => timer.id === deleteConfirmTimerId) ?? null,
		[timers, deleteConfirmTimerId],
	)
	const linkedItems = useMemo(() => {
		if (!selectedTimer) {
			return []
		}
		const itemById = new Map(items.map((item) => [item.id, item]))
		return itemTimerLinks
			.filter((link) => link.timerId === selectedTimer.id)
			.map((link) => {
				const item = itemById.get(link.itemId)
				return item ? { item, link } : null
			})
			.filter((entry): entry is { item: (typeof items)[number]; link: (typeof itemTimerLinks)[number] } => Boolean(entry))
	}, [selectedTimer, itemTimerLinks, items])
	const linkedItemsForDeleteConfirm = useMemo(() => {
		if (!deleteConfirmTimer) {
			return []
		}
		const itemById = new Map(items.map((item) => [item.id, item]))
		return itemTimerLinks
			.filter((link) => link.timerId === deleteConfirmTimer.id)
			.map((link) => itemById.get(link.itemId))
			.filter((item): item is (typeof items)[number] => Boolean(item))
	}, [deleteConfirmTimer, itemTimerLinks, items])

	return (
		<Grid container spacing={3}>
			<Grid item xs={12}>
				<Button
					startIcon={<ArrowBack />}
					variant="text"
					onClick={() => {
						window.location.pathname = '/'
					}}
				>
					Back to items
				</Button>
			</Grid>
			<Grid item xs={12} md={5}>
				<Card>
					<CardContent>
						<Stack spacing={1}>
							<Stack direction="row" justifyContent="space-between" alignItems="center">
								<Typography variant="h5">Timers</Typography>
								<Button startIcon={<Add />} variant="contained" size="small" onClick={() => setDialogState({ open: true })}>
									Add timer
								</Button>
							</Stack>
							<Divider />
							<List dense disablePadding>
								{timers.map((timer) => (
									<ListItem
										key={timer.id}
										disablePadding
										secondaryAction={
											<Stack direction="row">
												<IconButton
													size="small"
													aria-label="edit timer"
													onClick={() => setDialogState({ open: true, timer })}
												>
													<EditOutlined fontSize="small" />
												</IconButton>
												<IconButton
													size="small"
													aria-label="delete timer"
													onClick={() => {
														setDeleteConfirmTimerId(timer.id)
													}}
												>
													<DeleteOutline fontSize="small" />
												</IconButton>
											</Stack>
										}
									>
										<ListItemButton selected={selectedTimerId === timer.id} onClick={() => setSelectedTimerId(timer.id)}>
											<ListItemText
												primary={timer.name}
												secondary={`${timer.isActive ? 'active' : 'inactive'} · ${formatTimerBaseAt(timer.baseAt)}`}
											/>
										</ListItemButton>
									</ListItem>
								))}
							</List>
						</Stack>
					</CardContent>
				</Card>
			</Grid>
			<Grid item xs={12} md={7}>
				<Card>
					<CardContent>
						{selectedTimer
							? (
								<Stack spacing={1}>
									{(() => {
										const hasTime = timerHasExplicitTime(selectedTimer.baseAt)
										// The engine runs in Rust: prev/next come from the structured
										// status of any linked item (identical for all links of a timer).
										const selectedStatus = linkedItems.length > 0 ? timerStatuses[linkedItems[0].link.id] : undefined
										const prevRunAt = selectedStatus?.lastRunAt !== undefined ? new Date(selectedStatus.lastRunAt) : null
										const nextRunAt = selectedStatus?.nextRunAt !== undefined ? new Date(selectedStatus.nextRunAt) : null
										return (
											<Typography variant="caption" color="text.secondary">
												prev: {prevRunAt ? formatTimerShortDate(prevRunAt, hasTime) : '-'} · next: {nextRunAt ? formatTimerShortDate(nextRunAt, hasTime) : '-'}
											</Typography>
										)
									})()}
									<Typography variant="h6">{selectedTimer.name}</Typography>
									<Typography variant="body2" color="text.secondary">{selectedTimer.description}</Typography>
									<Typography variant="body2">Base: {formatTimerBaseAt(selectedTimer.baseAt)}</Typography>
									<Typography variant="body2">
										Schedule: {selectedTimer.schedule ? `every ${selectedTimer.schedule.every} ${selectedTimer.schedule.unit}` : 'one-time'}
									</Typography>
									<Divider />
									<Typography variant="subtitle2">Linked items</Typography>
									{linkedItems.length === 0 && <Typography color="text.secondary">No linked items.</Typography>}
									{linkedItems.map(({ item, link }) => {
										const timerView = getTimerViewState(selectedTimer, link, timerStatuses[link.id])

										return (
											<Stack key={link.id} spacing={0.25} sx={{ py: 0.5 }}>
												<Stack direction="row" alignItems="center" spacing={0.5}>
													<Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
														{item.infoEntries[0]?.value ?? item.id}
													</Typography>
													{timerView.showCheck && (
														<Tooltip title={timerView.checkTooltip}>
															<IconButton
																size="small"
																aria-label="check linked timer"
																onClick={() => {
																	void (async () => {
																		await cycleItemTimerLink(link.id)
																		setCheckStatus('checked')
																		window.setTimeout(() => setCheckStatus(null), 1200)
																	})()
																}}
															>
																<TaskAltRounded fontSize="small" />
															</IconButton>
														</Tooltip>
													)}
													{timerView.showCancel && (
														<Tooltip title={timerView.cancelTooltip}>
															<IconButton
																size="small"
																aria-label="uncheck linked timer"
																onClick={() => {
																	void (async () => {
																		await cycleItemTimerLink(link.id)
																		setCheckStatus('unchecked')
																		window.setTimeout(() => setCheckStatus(null), 1200)
																	})()
																}}
															>
																<CloseRounded fontSize="small" />
															</IconButton>
														</Tooltip>
													)}
												</Stack>
											</Stack>
										)
									})}
									{checkStatus && (
										<Typography variant="caption" color="success.main">
											{checkStatus}
										</Typography>
									)}
								</Stack>
							)
							: <Typography color="text.secondary">Select a timer from the list.</Typography>}
					</CardContent>
				</Card>
			</Grid>
			<TimerDialog
				open={dialogState.open}
				timer={dialogState.timer}
				onClose={() => setDialogState({ open: false })}
				onSave={(input) => {
					void (async () => {
						if (dialogState.timer) {
							await updateTimer(dialogState.timer.id, input)
						} else {
							const created = await createTimer(input)
							setSelectedTimerId(created.id)
						}
						setDialogState({ open: false })
					})()
				}}
			/>
			<Dialog
				open={Boolean(deleteConfirmTimer)}
				onClose={() => setDeleteConfirmTimerId(null)}
				fullWidth
				maxWidth="sm"
			>
				<DialogTitle>Delete timer?</DialogTitle>
				<DialogContent>
					<Stack spacing={1}>
						<Typography>
							Timer `{deleteConfirmTimer?.name ?? '-'}` will be deleted.
						</Typography>
						{linkedItemsForDeleteConfirm.length > 0
							? (
								<>
									<Typography color="error">
										Linked items ({linkedItemsForDeleteConfirm.length}) will be unlinked:
									</Typography>
									<List dense disablePadding>
										{linkedItemsForDeleteConfirm.map((item) => (
											<ListItem key={item.id} disablePadding>
												<ListItemText primary={item.infoEntries[0]?.value ?? item.id} />
											</ListItem>
										))}
									</List>
								</>
							)
							: <Typography color="text.secondary">No linked items.</Typography>}
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setDeleteConfirmTimerId(null)}>Cancel</Button>
					<Button
						color="error"
						variant="contained"
						onClick={() => {
							void (async () => {
								if (!deleteConfirmTimer) {
									return
								}
								await deleteTimer(deleteConfirmTimer.id)
								if (selectedTimerId === deleteConfirmTimer.id) {
									setSelectedTimerId(null)
								}
								setDeleteConfirmTimerId(null)
							})()
						}}
					>
						Delete
					</Button>
				</DialogActions>
			</Dialog>
		</Grid>
	)
}
