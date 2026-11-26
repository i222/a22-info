import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'a22-ui-mui/src'),
			'src/ui-core': path.resolve(__dirname, 'a22-ui-core/src'),
			'src/ui-mui': path.resolve(__dirname, 'a22-ui-mui/src'),
		},
	},
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
				protocol: 'ws',
				host,
				port: 5174,
			}
			: undefined,
		watch: {
			ignored: ['**/target/**', '**/dist/**'],
		},
	},
	envPrefix: ['VITE_', 'TAURI_'],
	build: {
		target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
		minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
		sourcemap: !!process.env.TAURI_ENV_DEBUG,
	},
})
