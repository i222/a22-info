// NotificationService.ts

/**
 * NotificationService maintains a process-wide queue of alerts.
 * - `NotificationProvider` calls `register(handler)` once to receive every queue update.
 * - Trigger new alerts anywhere with `notificationService.show(message, severity?)`; each call pushes onto the stack.
 * - Remove a specific alert via `notificationService.dismiss(id)` (used on close buttons).
 * - Reset the entire stack with `notificationService.clear()` if you need to wipe all notifications at once.
 */
export type AlertSeverity = 'success' | 'info' | 'warning' | 'error'

export interface NotificationPayload {
	id: string
	message: string
	severity?: AlertSeverity
}

type NotificationHandler = (payloads: Array<NotificationPayload>) => void

class NotificationServiceClass {
	private handler: NotificationHandler | null = null
	private queue: Array<NotificationPayload> = []

	register(handler: NotificationHandler) {
		this.handler = handler
		handler(this.queue)
	}

	show(message: string, severity: AlertSeverity = 'info'): string {
		if (!this.handler) {
			console.warn('NotificationService: handler is not registered')
			return ''
		}
		const notification: NotificationPayload = {
			id: crypto.randomUUID(),
			message,
			severity,
		}
		this.queue = [...this.queue, notification]
		this.handler(this.queue)
		return notification.id
	}

	dismiss(id: string) {
		this.queue = this.queue.filter((notification) => notification.id !== id)
		if (this.handler) {
			this.handler(this.queue)
		}
	}

	clear() {
		this.queue = []
		if (this.handler) {
			this.handler(this.queue)
		}
	}
}

export const notificationService = new NotificationServiceClass()
