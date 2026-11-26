import { Container } from '@mui/material'
import { currentReportKind } from 'src/ui-core/platform/openReportWindow'
import { ReportChrome } from './components/report/ReportChrome'
import { ItemsPage } from './ui/items/ItemsPage'
import { BasicReportPage } from './ui/reports/BasicReportPage'
import { RelationshipsReportPage } from './ui/reports/RelationshipsReportPage'
import { ReportsPage } from './ui/reports/ReportsPage'
import { TimersPage } from './ui/timers/TimersPage'

export default function App() {
	// Inside Tauri, report webviews are detected by their window label;
	// they load the app root and render as read-only reports with a chrome bar.
	const reportKind = currentReportKind()

	if (reportKind === 'basic') {
		return (
			<ReportChrome>
				<BasicReportPage />
			</ReportChrome>
		)
	}

	if (reportKind === 'relationships') {
		return (
			<ReportChrome>
				<RelationshipsReportPage />
			</ReportChrome>
		)
	}

	const pathname = window.location.pathname

	if (pathname === '/reports/basic') {
		return <BasicReportPage />
	}

	if (pathname === '/reports/relationships') {
		return <RelationshipsReportPage />
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
