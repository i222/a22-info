import { createTheme } from '@mui/material'

export const theme = createTheme({
	components: {
		MuiTableCell: {
			styleOverrides: {
				root: {
					padding: '10px 18px', // uncomment and adjust to override default 16px
				},
			},
		},
	},
	palette: {
		// Main interactive color (buttons, links, selected states)
		primary: {
			main: '#1976d2',
		},
		// Neutral secondary tone for less prominent actions
		secondary: {
			main: '#525252',
		},
		// Positive semantic states
		success: {
			main: '#10b981',
			dark: '#047857',
		},
		// Caution semantic states
		warning: {
			main: '#f59e0b',
		},
		// Error semantic states
		error: {
			main: '#ef4444',
		},
		// Global surface colors
		background: {
			paper: '#ffffff',
			default: '#f5f5f5',
		},
		// Subtle neutral shade for soft section backgrounds
		grey: {
			50: '#fafafa',
		},
	},
})
