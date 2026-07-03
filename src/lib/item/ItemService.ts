import type { Item, ItemInput, ItemUpdateInput } from '@/models/item/types'

export interface ItemService {
	list(): Promise<Array<Item>>
	getById(id: string): Promise<Item | undefined>
	create(input: ItemInput): Promise<Item>
	update(id: string, input: ItemUpdateInput): Promise<Item>
	remove(id: string): Promise<void>
	listTags(): Promise<Array<string>>
	listInfoLabels(): Promise<Array<string>>
	listRelationshipTypes(): Promise<Array<string>>
}
