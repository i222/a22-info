import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import { useEffect, useMemo, useState } from 'react'
import { type NotificationPayload, notificationService } from './NotificationService'

interface Props {
	children: React.ReactNode
}

const MAX_VISIBLE_ALERTS = 3

export const NotificationProvider = ({ children }: Props) => {
	const [alerts, setAlerts] = useState<Array<NotificationPayload>>([])
	const visibleAlerts = useMemo(
		() => alerts.slice(0, MAX_VISIBLE_ALERTS),
		[alerts],
	)

	useEffect(() => {
		notificationService.register((payloads) => {
			setAlerts(payloads)
		})
	}, [])

	useEffect(() => {
		const timers = visibleAlerts.map(({ id }) => setTimeout(() => notificationService.dismiss(id), 5000))
		return () => {
			timers.forEach(clearTimeout)
		}
	}, [visibleAlerts])

	const handleClose = (id: string) => {
		notificationService.dismiss(id)
	}

	return (
		<>
			{children}

			<Box
				sx={{
					position: 'fixed',
					right: 24,
					bottom: 24,
					display: 'flex',
					flexDirection: 'column',
					gap: 1.5,
					width: { xs: 'calc(100vw - 32px)', sm: 380 },
					maxWidth: '100%',
					zIndex: (theme) => theme.zIndex.snackbar,
					pointerEvents: 'none',
				}}
			>
				{visibleAlerts.map(({ id, message, severity = 'info' }) => (
					<Alert
						key={id}
						severity={severity}
						variant="filled"
						onClose={() => handleClose(id)}
						sx={{
							width: 1,
							color: 'common.white',
							'& .MuiAlert-icon': { color: 'inherit' },
							'& .MuiAlert-action': { color: 'inherit' },
							pointerEvents: 'auto',
						}}
					>
						{message}
					</Alert>
				))}
			</Box>
		</>
	)
}
