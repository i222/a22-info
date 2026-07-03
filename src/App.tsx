import { Container } from '@mui/material'
import { ItemsPage } from './ui/items/ItemsPage'
import { BasicReportPage } from './ui/reports/BasicReportPage'
import { ReportsPage } from './ui/reports/ReportsPage'
import { TimersPage } from './ui/timers/TimersPage'

export default function App() {
	const pathname = window.location.pathname
	if (pathname === '/reports/basic') {
		return <BasicReportPage />
	}

	if (pathname === '/reports') {
		return (
			<Container maxWidth="lg" sx={{ py: 4 }}>
				<ReportsPage />
			</Container>
		)
	}
	if (pathname === '/timers') {
		return (
			<Container maxWidth="lg" sx={{ py: 4 }}>
				<TimersPage />
			</Container>
		)
	}

	return (
		<Container maxWidth="lg" sx={{ py: 4 }}>
			<ItemsPage />
		</Container>
	)
}
