import { Box, Button, Stack } from '@mui/material'
import type { ReactNode } from 'react'
import { backToMain, closeReportWindow } from 'src/ui-core/platform/openReportWindow'

const CHROME_HEIGHT = 48

/**
 * Thin top bar rendered only inside a report webview:
 * "← Back" focuses the main window and closes the report; "✕ Close" just
 * closes it. Hidden while printing so reports print without the window chrome.
 */
export function ReportChrome({ children }: { children: ReactNode }) {
	return (
		<>
			<style>
				{`
					.report-chrome {
						position: fixed;
						top: 0;
						left: 0;
						right: 0;
						z-index: 1300;
						height: ${CHROME_HEIGHT}px;
					}

					.report-chrome-content {
						padding-top: ${CHROME_HEIGHT}px;
					}

					/* The relationships report is a fixed 100vh layout; shrink it
					   so the chrome bar does not push its bottom edge off-screen. */
					.report-chrome-content .relationships-report-root {
						height: calc(100vh - ${CHROME_HEIGHT}px) !important;
					}

					@media print {
						.report-chrome {
							display: none !important;
						}

						.report-chrome-content {
							padding-top: 0 !important;
						}

						.report-chrome-content .relationships-report-root {
							height: auto !important;
						}
					}
				`}
			</style>
			<Stack
				className="report-chrome"
				direction="row"
				alignItems="center"
				justifyContent="space-between"
				sx={{ px: 1.5, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}
			>
				<Button size="small" onClick={() => void backToMain()}>
					← Back
				</Button>
				<Button size="small" onClick={() => void closeReportWindow()}>
					Close ✕
				</Button>
			</Stack>
			<Box className="report-chrome-content">{children}</Box>
		</>
	)
}
