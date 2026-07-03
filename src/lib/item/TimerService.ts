import type { Timer, TimerInput, TimerUpdateInput } from '@/models/item/types'

export interface TimerService {
	list(): Promise<Array<Timer>>
	getById(id: string): Promise<Timer | undefined>
	create(input: TimerInput): Promise<Timer>
	update(id: string, input: TimerUpdateInput): Promise<Timer>
	remove(id: string): Promise<void>
}
