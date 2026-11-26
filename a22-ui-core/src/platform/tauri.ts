import { invoke as tauriInvoke } from '@tauri-apps/api/core'

/** True when running inside the Tauri webview (false in a plain browser tab). */
export function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * IPC bridge to the Rust command surface.
 * Tauri rejects with the command's `Err(String)` payload; normalize every
 * failure into a plain `Error` with a readable message.
 */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	if (!isTauri()) {
		throw new Error(`Tauri runtime is not available (command "${command}"). Run the app with "npm run tauri dev".`)
	}
	try {
		return await tauriInvoke(command, args)
	} catch (error) {
		if (typeof error === 'string') {
			throw new Error(error)
		}
		throw error instanceof Error ? error : new Error(String(error))
	}
}
