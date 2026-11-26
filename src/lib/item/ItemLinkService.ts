import type { ItemLink, ItemLinkInput, ItemLinkUpdateInput } from '@/models/item/types'

export interface ItemLinkService {
	list(): Promise<Array<ItemLink>>
	listByItemId(itemId: string): Promise<Array<ItemLink>>
	create(input: ItemLinkInput): Promise<ItemLink>
	update(id: string, input: ItemLinkUpdateInput): Promise<ItemLink>
	remove(id: string): Promise<void>
	removeByItemId(itemId: string): Promise<void>
}
