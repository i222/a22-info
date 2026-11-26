import type { TimerService } from '@/lib/item/TimerService'
import type { Timer, TimerInput, TimerUpdateInput } from '@/models/item/types'
import { sortBy } from 'lodash-es'
import { itemDb } from './db'

export class IndexedDbTimerService implements TimerService {
	async list(): Promise<Array<Timer>> {
		const timers = await itemDb.timers.toArray()
		return sortBy(timers, (timer) => timer.updatedAt).reverse()
	}

	async getById(id: string): Promise<Timer | undefined> {
		return itemDb.timers.get(id)
	}

	async create(input: TimerInput): Promise<Timer> {
		const now = new Date().toISOString()
		const timer: Timer = {
			...input,
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now,
		}
		await itemDb.timers.put(timer)
		return timer
	}

	async update(id: string, input: TimerUpdateInput): Promise<Timer> {
		const previous = await itemDb.timers.get(id)
		if (!previous) {
			throw new Error(`Timer ${id} not found`)
		}
		const updated: Timer = {
			...previous,
			...input,
			id,
			createdAt: previous.createdAt,
			updatedAt: new Date().toISOString(),
		}
		await itemDb.timers.put(updated)
		return updated
	}

	async remove(id: string): Promise<void> {
		await itemDb.timers.delete(id)
	}
}

export const indexedDbTimerService = new IndexedDbTimerService()
