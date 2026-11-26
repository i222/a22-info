import { RelationshipTargetDialog } from '@/components/item/RelationshipTargetDialog'
import { TimerDialog } from '@/components/item/TimerDialog'
import { createItemPayload, formatTimerBaseAt, getItemDisplayValue } from '@/models/item/helpers'
import type { DateTimeEntry, InfoEntry, Item, ItemInput, ItemLink, ItemTimerLink, Relationship, Timer, TimerInput } from '@/models/item/types'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import EditOutlined from '@mui/icons-material/EditOutlined'
import LinkOutlined from '@mui/icons-material/LinkOutlined'
import Star from '@mui/icons-material/Star'
import StarBorder from '@mui/icons-material/StarBorder'
import { Autocomplete, Box, Button, Chip, IconButton, Stack, TextField, Typography } from '@mui/material'
import { useMemo, useState } from 'react'

interface ItemEditorProps {
	item?: Item
	itemLinks: Array<ItemLink>
	tagHints: Array<string>
	infoLabelHints: Array<string>
	relationshipTypeHints: Array<string>
	targetItems: Array<Item>
	timers: Array<Timer>
	itemTimerLinks: Array<ItemTimerLink>
	formId: string
	onConfirmDelete: (label: string) => Promise<boolean>
	onSubmit: (input: ItemInput) => Promise<void>
	onCreateTimer: (input: TimerInput) => Promise<Timer>
	onUpdateTimer: (id: string, input: TimerInput) => Promise<void>
	onLinkTimer: (itemId: string, timerId: string) => Promise<void>
	onUnlinkTimer: (linkId: string) => Promise<void>
}

const EMPTY_INFO_ENTRY: InfoEntry = { label: '', value: '' }
type FormInfoEntry = InfoEntry & { id: string }
type FormDateTimeEntry = DateTimeEntry & { id: string }
type FormRelationship = Relationship & { id: string }

function createFormId(): string {
	return crypto.randomUUID()
}

export function ItemEditor({
	item,
	itemLinks,
	tagHints,
	infoLabelHints,
	relationshipTypeHints,
	targetItems,
	timers,
	itemTimerLinks,
	formId,
	onConfirmDelete,
	onSubmit,
	onCreateTimer,
	onUpdateTimer,
	onLinkTimer,
	onUnlinkTimer,
}: ItemEditorProps) {
	const [tags, setTags] = useState(item?.tags ?? [])
	const [infoEntries, setInfoEntries] = useState<FormInfoEntry[]>(
		(item?.infoEntries ?? []).map((entry) => ({ ...entry, id: createFormId() })),
	)
	const [mainInfoField, setMainInfoField] = useState(item?.mainInfoField ?? '')
	const [relationships, setRelationships] = useState<FormRelationship[]>(() => {
		const initial = item
			? itemLinks
				.filter((link) => link.itemId === item.id)
				.map((link) => ({ type: link.type, targetId: link.targetId }))
			: []
		return initial.map((relationship) => ({ ...relationship, id: createFormId() }))
	})
	const [dateTimeEntries, setDateTimeEntries] = useState<FormDateTimeEntry[]>(
		(item?.dateTimeEntries ?? []).map((field) => ({ ...field, id: createFormId() })),
	)
	const [isSaving, setIsSaving] = useState(false)
	const [submitError, setSubmitError] = useState<string | null>(null)
	const [isRelationshipDialogOpen, setRelationshipDialogOpen] = useState(false)
	const [isTimerDialogOpen, setTimerDialogOpen] = useState(false)
	const [editingTimer, setEditingTimer] = useState<Timer | undefined>(undefined)
	const [selectedTimerIdToLink, setSelectedTimerIdToLink] = useState<string | null>(null)
	const relationshipTargetOptions = useMemo(
		() => targetItems.filter((candidate) => candidate.id !== item?.id),
		[targetItems, item?.id],
	)
	const relationshipTargetsById = useMemo(
		() => new Map(relationshipTargetOptions.map((candidate) => [candidate.id, candidate])),
		[relationshipTargetOptions],
	)
	const activeTimerLinks = useMemo(
		() => itemTimerLinks.filter((link) => link.itemId === item?.id),
		[itemTimerLinks, item?.id],
	)
	const linkedTimers = useMemo(
		() =>
			activeTimerLinks
				.map((link) => {
					const timer = timers.find((entry) => entry.id === link.timerId)
					return timer ? { link, timer } : null
				})
				.filter((entry): entry is { link: ItemTimerLink; timer: Timer } => Boolean(entry)),
		[activeTimerLinks, timers],
	)
	const availableTimers = useMemo(() => {
		const linkedTimerIds = new Set(activeTimerLinks.map((link) => link.timerId))
		return timers.filter((timer) => !linkedTimerIds.has(timer.id))
	}, [timers, activeTimerLinks])
	const selectedTimerToLink = useMemo(
		() => availableTimers.find((timer) => timer.id === selectedTimerIdToLink) ?? null,
		[availableTimers, selectedTimerIdToLink],
	)

	const addRelationships = (targetIds: Array<string>) => {
		if (targetIds.length === 0) {
			return
		}
		setRelationships((previous) => {
			const existingTargetIds = new Set(previous.map((relationship) => relationship.targetId))
			const additions = targetIds
				.filter((targetId) => !existingTargetIds.has(targetId))
				.map((targetId) => ({ id: createFormId(), type: 'related', targetId }))
			return [...previous, ...additions]
		})
		setRelationshipDialogOpen(false)
	}

	const handleSubmit = async () => {
		if (isSaving) {
			return
		}
		const payload: ItemInput = {
			...createItemPayload({
				mainInfoField,
				tags,
				infoEntries: infoEntries.map(({ label, value }) => ({ label, value })),
				dateTimeEntries: dateTimeEntries.map(({ label, value }) => ({ label, value })),
			}),
			relationships: relationships.map(({ type, targetId }) => ({ type, targetId })),
		}
		if (!item && payload.infoEntries.length === 0) {
			setSubmitError('Add at least one info entry before creating an item.')
			return
		}
		setSubmitError(null)
		setIsSaving(true)
		try {
			await onSubmit(payload)
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<Stack
			component="form"
			id={formId}
			spacing={1.5}
			onSubmit={(event) => {
				event.preventDefault()
				void handleSubmit()
			}}
		>
			<Autocomplete
				multiple
				freeSolo
				options={tagHints}
				value={tags}
				selectOnFocus
				clearOnBlur
				handleHomeEndKeys
				filterSelectedOptions
				onChange={(_, nextValue) => setTags(nextValue.map((tag) => String(tag)))}
				renderTags={(value, getTagProps) =>
					value.map((tag, index) => (
						<Chip
							{...getTagProps({ index })}
							key={tag}
							size="small"
							variant="outlined"
							color="primary"
							label={tag}
							onDelete={() => {
								void (async () => {
									if (await onConfirmDelete(`Delete tag "${tag}"?`)) {
										setTags((previous) => previous.filter((itemTag) => itemTag !== tag))
									}
								})()
							}}
						/>
					))}
				renderInput={(params) => <TextField {...params} size="small" label="Tags" placeholder="Add one or more tags" />}
			/>
			<Stack spacing={1}>
				<Stack direction="row" justifyContent="space-between" alignItems="center">
					<Typography variant="subtitle2">Info entries</Typography>
					<Button size="small" onClick={() => setInfoEntries((previous) => [...previous, { ...EMPTY_INFO_ENTRY, id: createFormId() }])}>
						Add entry
					</Button>
				</Stack>
				{infoEntries.map((entry) => (
					<Stack direction="row" spacing={0.75} key={entry.id} alignItems="center">
						<Autocomplete
							freeSolo
							options={infoLabelHints}
							value={entry.label}
							selectOnFocus
							clearOnBlur
							handleHomeEndKeys
							onChange={(_, nextValue) => {
								const nextLabel = typeof nextValue === 'string' ? nextValue : (nextValue ?? '')
								if (mainInfoField === entry.label) {
									setMainInfoField(nextLabel)
								}
								setInfoEntries((previous) => previous.map((itemEntry) => (itemEntry.id === entry.id ? { ...itemEntry, label: nextLabel } : itemEntry)))
							}}
							onInputChange={(_, nextValue) => {
								if (mainInfoField === entry.label) {
									setMainInfoField(nextValue)
								}
								setInfoEntries((previous) => previous.map((itemEntry) => (itemEntry.id === entry.id ? { ...itemEntry, label: nextValue } : itemEntry)))
							}}
							renderInput={(params) => <TextField {...params} size="small" label="Label" fullWidth />}
							sx={{ minWidth: 160 }}
						/>
						<TextField
							size="small"
							label="Value"
							value={entry.value}
							onChange={(event) => {
								const nextValue = event.target.value
								setInfoEntries((previous) => previous.map((itemEntry) => (itemEntry.id === entry.id ? { ...itemEntry, value: nextValue } : itemEntry)))
							}}
							fullWidth
						/>
						<IconButton
							aria-label="Set main info entry"
							onClick={() => setMainInfoField(entry.label)}
							size="small"
						>
							{mainInfoField === entry.label ? <Star color="warning" fontSize="small" /> : <StarBorder fontSize="small" />}
						</IconButton>
						<IconButton
							aria-label="Remove info entry"
							onClick={() => {
								void (async () => {
									const label = entry.label.trim().length > 0 ? entry.label : '(empty label)'
									if (!(await onConfirmDelete(`Delete info entry "${label}"?`))) {
										return
									}
									setInfoEntries((previous) => previous.filter((itemEntry) => itemEntry.id !== entry.id))
									if (mainInfoField === entry.label) {
										setMainInfoField('')
									}
								})()
							}}
						>
							<DeleteOutline />
						</IconButton>
					</Stack>
				))}
				{infoEntries.length === 0 && (
					<Typography variant="body2" color="text.secondary">
						No info entries yet.
					</Typography>
				)}
			</Stack>
			<Stack spacing={1}>
				<Stack direction="row" justifyContent="space-between" alignItems="center">
					<Typography variant="subtitle2">DT fields</Typography>
					<Button
						size="small"
						onClick={() => setDateTimeEntries((previous) => [...previous, { id: createFormId(), label: '', value: Date.now() }])}
					>
						Add DT field
					</Button>
				</Stack>
				{dateTimeEntries.map((entry) => (
					<Stack direction="row" spacing={0.75} key={entry.id} alignItems="center">
						<TextField
							size="small"
							label="Label"
							value={entry.label}
							onChange={(event) => {
								const nextValue = event.target.value
								setDateTimeEntries((previous) => previous.map((field) => (field.id === entry.id ? { ...field, label: nextValue } : field)))
							}}
							sx={{ minWidth: 180 }}
						/>
						<TextField
							size="small"
							label="Date time"
							type="datetime-local"
							value={(() => {
								const date = new Date(entry.value)
								if (Number.isNaN(date.getTime())) {
									return ''
								}
								const offsetMs = date.getTimezoneOffset() * 60 * 1000
								return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
							})()}
							onChange={(event) => {
								const parsed = new Date(event.target.value)
								setDateTimeEntries((previous) =>
									previous.map((field) => field.id === entry.id ? { ...field, value: Number.isNaN(parsed.getTime()) ? field.value : parsed.getTime() } : field)
								)
							}}
							fullWidth
						/>
						<IconButton
							aria-label="Remove DT field"
							onClick={() => setDateTimeEntries((previous) => previous.filter((field) => field.id !== entry.id))}
						>
							<DeleteOutline />
						</IconButton>
					</Stack>
				))}
				{dateTimeEntries.length === 0 && (
					<Typography variant="body2" color="text.secondary">
						No DT fields yet.
					</Typography>
				)}
			</Stack>
			<Stack spacing={1}>
				<Stack direction="row" justifyContent="space-between" alignItems="center">
					<Typography variant="subtitle2">Relationships</Typography>
					<Button size="small" onClick={() => setRelationshipDialogOpen(true)}>
						Add relationship
					</Button>
				</Stack>
				{relationships.map((relationship) => (
					<Stack direction="row" spacing={0.75} key={relationship.id} alignItems="center">
						<Autocomplete
							freeSolo
							options={relationshipTypeHints}
							value={relationship.type}
							onInputChange={(_, nextValue) => {
								setRelationships((previous) =>
									previous.map((itemRelationship) => (itemRelationship.id === relationship.id ? { ...itemRelationship, type: nextValue } : itemRelationship))
								)
							}}
							renderInput={(params) => <TextField {...params} size="small" label="Type" fullWidth />}
							sx={{ minWidth: 170, maxWidth: 220 }}
						/>
						<Stack sx={{ flex: 1 }}>
							<Typography variant="body2">
								{(() => {
									const target = relationshipTargetsById.get(relationship.targetId)
									return target ? getItemDisplayValue(target) : 'Unknown target'
								})()}
							</Typography>
						</Stack>
						<IconButton
							aria-label="Remove relationship"
							onClick={() => {
								void (async () => {
									const label = relationship.type.trim().length > 0 ? relationship.type : '(empty type)'
									if (await onConfirmDelete(`Delete relationship "${label}"?`)) {
										setRelationships((previous) => previous.filter((itemRelationship) => itemRelationship.id !== relationship.id))
									}
								})()
							}}
						>
							<DeleteOutline />
						</IconButton>
					</Stack>
				))}
				{relationships.length === 0 && (
					<Typography variant="body2" color="text.secondary">
						No relationships yet.
					</Typography>
				)}
			</Stack>
			<Stack spacing={1}>
				<Stack direction="row" justifyContent="space-between" alignItems="center">
					<Typography variant="subtitle2">Timers</Typography>
					<Button
						size="small"
						onClick={() => {
							setEditingTimer(undefined)
							setTimerDialogOpen(true)
						}}
					>
						Add timer
					</Button>
				</Stack>
				{item?.id && availableTimers.length > 0 && (
					<Stack direction="row" spacing={1} alignItems="center">
						<Autocomplete
							options={availableTimers}
							getOptionLabel={(option) => option.name}
							value={selectedTimerToLink}
							onChange={(_, next) => setSelectedTimerIdToLink(next?.id ?? null)}
							renderInput={(params) => <TextField {...params} size="small" label="Link existing timer" />}
							sx={{ flex: 1 }}
						/>
						<Button
							variant="outlined"
							startIcon={<LinkOutlined />}
							disabled={!selectedTimerToLink}
							onClick={() => {
								void (async () => {
									if (!item?.id || !selectedTimerToLink) {
										return
									}
									await onLinkTimer(item.id, selectedTimerToLink.id)
									setSelectedTimerIdToLink(null)
								})()
							}}
						>
							Link
						</Button>
					</Stack>
				)}
				{linkedTimers.map(({ timer, link }) => (
					<Stack direction="row" spacing={0.75} key={timer.id} alignItems="center">
						<Stack sx={{ flex: 1 }}>
							<Typography variant="body2">
								{timer.name} ({timer.isActive ? 'active' : 'inactive'})
							</Typography>
							<Typography variant="caption" color="text.secondary">
								{formatTimerBaseAt(timer.baseAt)}
								{timer.schedule ? ` · every ${timer.schedule.every} ${timer.schedule.unit}` : ' · one-time'}
							</Typography>
						</Stack>
						<IconButton
							aria-label="Edit timer"
							onClick={() => {
								setEditingTimer(timer)
								setTimerDialogOpen(true)
							}}
						>
							<EditOutlined />
						</IconButton>
						<IconButton
							aria-label="Remove timer"
							onClick={() => {
								void (async () => {
									if (!(await onConfirmDelete(`Unlink timer "${timer.name}"?`))) {
										return
									}
									await onUnlinkTimer(link.id)
								})()
							}}
						>
							<DeleteOutline />
						</IconButton>
					</Stack>
				))}
				{!item?.id && (
					<Typography variant="body2" color="text.secondary">
						Save item first to link timers.
					</Typography>
				)}
				{item?.id && linkedTimers.length === 0 && (
					<Typography variant="body2" color="text.secondary">
						No timers yet.
					</Typography>
				)}
				{item?.id && availableTimers.length === 0 && (
					<Typography variant="body2" color="text.secondary">
						All timers are already linked to this item.
					</Typography>
				)}
			</Stack>
			<Box>
				<Typography variant="caption" color="text.secondary">
					Empty or incomplete rows are removed automatically when saving. Star marks the main info entry.
				</Typography>
			</Box>
			{submitError && (
				<Typography variant="body2" color="error">
					{submitError}
				</Typography>
			)}
			<RelationshipTargetDialog
				open={isRelationshipDialogOpen}
				items={relationshipTargetOptions}
				existingTargetIds={relationships.map((relationship) => relationship.targetId)}
				onClose={() => setRelationshipDialogOpen(false)}
				onAdd={addRelationships}
			/>
			<TimerDialog
				open={isTimerDialogOpen}
				timer={editingTimer}
				onClose={() => {
					setTimerDialogOpen(false)
					setEditingTimer(undefined)
				}}
				onSave={(nextTimer) => {
					void (async () => {
						if (editingTimer) {
							await onUpdateTimer(editingTimer.id, nextTimer)
						} else {
							const createdTimer = await onCreateTimer(nextTimer)
							if (item?.id) {
								await onLinkTimer(item.id, createdTimer.id)
							}
						}
						setTimerDialogOpen(false)
						setEditingTimer(undefined)
					})()
				}}
			/>
		</Stack>
	)
}
