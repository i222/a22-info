import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import type { Timer, TimerInput, TimerIntervalUnit } from 'src/ui-core/models/item/types'

const TIMER_UNIT_OPTIONS: Array<{ value: TimerIntervalUnit; label: string }> = [
	{ value: 'hours', label: 'Hours' },
	{ value: 'days', label: 'Days' },
	{ value: 'weeks', label: 'Weeks' },
	{ value: 'months', label: 'Months' },
	{ value: 'years', label: 'Years' },
]

interface TimerDialogProps {
	open: boolean
	timer?: Timer
	onClose: () => void
	onSave: (timer: TimerInput) => void
}

function toLocalDateParts(isoString: string): { date: string; time: string; hasTime: boolean } {
	const parsed = new Date(isoString)
	if (Number.isNaN(parsed.getTime())) {
		return { date: '', time: '', hasTime: false }
	}
	const offsetMs = parsed.getTimezoneOffset() * 60 * 1000
	const local = new Date(parsed.getTime() - offsetMs)
	const localIso = local.toISOString()
	const date = localIso.slice(0, 10)
	const time = localIso.slice(11, 16)
	const hasTime = time !== '00:00'
	return { date, time: hasTime ? time : '', hasTime }
}

function toIsoFromLocalDateTime(date: string, time: string | undefined): string {
	const normalizedTime = time && time.trim().length > 0 ? time : '00:00'
	const parsed = new Date(`${date}T${normalizedTime}`)
	return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

export function TimerDialog({ open, timer, onClose, onSave }: TimerDialogProps) {
	const [name, setName] = useState('')
	const [baseDate, setBaseDate] = useState('')
	const [baseTime, setBaseTime] = useState('')
	const [hasTime, setHasTime] = useState(false)
	const [description, setDescription] = useState('')
	const [isActive, setIsActive] = useState(true)
	const [hasSchedule, setHasSchedule] = useState(false)
	const [every, setEvery] = useState('1')
	const [unit, setUnit] = useState<TimerIntervalUnit>('days')

	useEffect(() => {
		if (!open) {
			return
		}
		if (timer) {
			const parts = toLocalDateParts(timer.baseAt)
			setBaseDate(parts.date)
			setBaseTime(parts.time)
			setHasTime(parts.hasTime)
		} else {
			setBaseDate('')
			setBaseTime('')
			setHasTime(false)
		}
		setDescription(timer?.description ?? '')
		setName(timer?.name ?? '')
		setIsActive(timer?.isActive ?? true)
		setHasSchedule(Boolean(timer?.schedule))
		setEvery(String(timer?.schedule?.every ?? 1))
		setUnit(timer?.schedule?.unit ?? 'days')
	}, [open, timer])

	const isValid = useMemo(() => {
		const parsedEvery = Number.parseInt(every, 10)
		const scheduleValid = !hasSchedule || (Number.isFinite(parsedEvery) && parsedEvery > 0)
		const timeValid = !hasTime || baseTime.trim().length > 0
		return name.trim().length > 0 && baseDate.trim().length > 0 && description.trim().length > 0 && scheduleValid && timeValid
	}, [name, baseDate, baseTime, description, every, hasSchedule, hasTime])

	const title = timer ? 'Edit timer' : 'Add timer'

	return (
		<Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
			<DialogTitle>{title}</DialogTitle>
			<DialogContent>
				<Stack spacing={1.5} sx={{ pt: 0.5 }}>
					<TextField
						label="Name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						fullWidth
						size="small"
					/>
					<TextField
						label="Base date"
						type="date"
						value={baseDate}
						onChange={(event) => setBaseDate(event.target.value)}
						InputLabelProps={{ shrink: true }}
						fullWidth
						size="small"
					/>
					<FormControlLabel
						control={
							<Switch
								checked={hasTime}
								onChange={(_, next) => {
									setHasTime(next)
									if (!next) {
										setBaseTime('')
									}
								}}
							/>
						}
						label="Set time"
					/>
					<TextField
						label="Time (optional)"
						type="time"
						disabled={!hasTime}
						value={baseTime}
						onChange={(event) => setBaseTime(event.target.value)}
						InputLabelProps={{ shrink: true }}
						fullWidth
						size="small"
					/>
					<TextField
						label="Description"
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						fullWidth
						size="small"
					/>
					<FormControlLabel control={<Switch checked={isActive} onChange={(_, next) => setIsActive(next)} />} label="Active" />
					<FormControlLabel
						control={<Switch checked={hasSchedule} onChange={(_, next) => setHasSchedule(next)} />}
						label="Periodic schedule"
					/>
					{hasSchedule && (
						<Stack direction="row" spacing={1}>
							<TextField
								label="Every"
								type="number"
								value={every}
								onChange={(event) => setEvery(event.target.value)}
								size="small"
								inputProps={{ min: 1, step: 1 }}
								sx={{ maxWidth: 140 }}
							/>
							<TextField
								select
								label="Unit"
								value={unit}
								onChange={(event) => setUnit(event.target.value as TimerIntervalUnit)}
								size="small"
								sx={{ minWidth: 170 }}
							>
								{TIMER_UNIT_OPTIONS.map((option) => (
									<MenuItem key={option.value} value={option.value}>
										{option.label}
									</MenuItem>
								))}
							</TextField>
						</Stack>
					)}
				</Stack>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose}>Cancel</Button>
				<Button
					variant="contained"
					disabled={!isValid}
					onClick={() => {
						const parsedEvery = Number.parseInt(every, 10)
						onSave({
							name: name.trim(),
							baseAt: toIsoFromLocalDateTime(baseDate, hasTime ? baseTime : undefined),
							description: description.trim(),
							isActive,
							schedule: hasSchedule
								? {
									every: Number.isFinite(parsedEvery) && parsedEvery > 0 ? parsedEvery : 1,
									unit,
								}
								: undefined,
						})
					}}
				>
					Save
				</Button>
			</DialogActions>
		</Dialog>
	)
}
