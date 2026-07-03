import type { ItemTimerLink, ItemTimerLinkInput, ItemTimerLinkUpdateInput } from '@/models/item/types'

export interface ItemTimerLinkService {
	list(): Promise<Array<ItemTimerLink>>
	listByItemId(itemId: string): Promise<Array<ItemTimerLink>>
	listByTimerId(timerId: string): Promise<Array<ItemTimerLink>>
	create(input: ItemTimerLinkInput): Promise<ItemTimerLink>
	update(id: string, input: ItemTimerLinkUpdateInput): Promise<ItemTimerLink>
	remove(id: string): Promise<void>
	removeByTimerId(timerId: string): Promise<void>
}
