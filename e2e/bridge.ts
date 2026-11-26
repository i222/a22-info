// Node-side direct calls to the Rust bridge: used for precise assertions that
// are awkward from the DOM (engine visualState, exact payloads) and for
// cross-checking what the UI submitted.
import { BRIDGE_URL } from './env'

export async function invoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
	const response = await fetch(`${BRIDGE_URL}/invoke`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ cmd, args }),
	})
	const data = (await response.json()) as { result?: T; error?: string }
	if (!response.ok || data.error !== undefined) {
		throw new Error(data.error || `bridge HTTP ${response.status}`)
	}
	return data.result as T
}
