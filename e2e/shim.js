/* Development-only E2E Tauri runtime shim.
 *
 * Injected into every page of the Playwright context. Makes `isTauri()` true
 * and routes:
 *  - app commands (`db_load_all`, `items_*`, ...) → the Rust HTTP bridge
 *    (a22-core/examples/http_invoke_bridge.rs — same ops as a22-app/src/commands.rs);
 *  - `plugin:*` window/webview commands → the Node-side fake-webview registry
 *    (exposed as `window.a22e2e`), so openReportWindow's real code path
 *    (getByLabel / new WebviewWindow / show / setFocus / close) runs unchanged.
 *
 * Report "windows" are extra Playwright pages of the same context opened at
 * `/?a22e2e_webview=<label>`; the label drives metadata.currentWebview.label,
 * which is exactly what App.tsx uses to render reports + ReportChrome.
 */
;(() => {
	const params = new URLSearchParams(window.location.search)
	const webviewLabel = params.get('a22e2e_webview') || 'main'
	const bridgeUrl = 'http://127.0.0.1:9787'

	const internals = {
		metadata: {
			currentWindow: { label: webviewLabel },
			currentWebview: { label: webviewLabel },
		},
		transformCallback(callback) {
			// Not used by the app; keep a registry so the event API cannot crash if touched.
			internals.__callbacks = internals.__callbacks || {}
			const id = `cb${(internals.__callbackSeq = (internals.__callbackSeq || 0) + 1)}`
			internals.__callbacks[id] = callback
			return id
		},
		async invoke(cmd, args) {
			if (typeof cmd === 'string' && cmd.startsWith('plugin:')) {
				return handlePluginCommand(cmd, args || {})
			}
			const response = await fetch(`${bridgeUrl}/invoke`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ cmd, args: args || {} }),
			})
			let data = null
			try {
				data = await response.json()
			} catch {
				throw new Error(`bridge returned non-JSON (HTTP ${response.status})`)
			}
			if (!response.ok || data.error !== undefined) {
				throw new Error(data.error || `bridge HTTP ${response.status}`)
			}
			return data.result
		},
	}

	async function handlePluginCommand(cmd, args) {
		switch (cmd) {
			case 'plugin:window|get_all_windows': {
				// Tauri returns plain label strings; @tauri-apps/api does
				// `windows.map(w => new WebviewWindow(w, { skip: true }))`.
				return window.a22e2e('listWindows')
			}
			case 'plugin:webview|create_webview_window':
				await window.a22e2e('openWebview', args.options || {})
				return null
			case 'plugin:window|show':
			case 'plugin:window|set_focus':
				await window.a22e2e('focusWindow', args.label)
				return null
			case 'plugin:window|close':
				await window.a22e2e('closeWindow', args.label)
				return null
			default:
				throw new Error(`shim: unsupported plugin command ${cmd}`)
		}
	}

	window.__TAURI_INTERNALS__ = internals
})()
