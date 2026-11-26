import { useCallback, useEffect, useRef, useState } from 'react'
import type { Item, ItemLink } from 'src/ui-core/models/item/types'

interface NodePos {
	x: number
	y: number
	vx: number
	vy: number
}

interface UseForceLayoutProps {
	items: Array<Item>
	links: Array<ItemLink>
	width: number
	height: number
}

export function useForceLayout({ items, links, width, height }: UseForceLayoutProps) {
	const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map())
	const nodeStateRef = useRef<Map<string, NodePos>>(new Map())
	const dragNodeRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null)
	const animFrameRef = useRef<number | null>(null)
	const alphaRef = useRef<number>(1)

	// Функция перезапуска / разогрева физики
	const triggerPhysics = useCallback(() => {
		alphaRef.current = 1
	}, [])

	// 1. Инициализация и обновление узлов
	useEffect(() => {
		const nextMap = new Map<string, NodePos>()

		items.forEach((item, index) => {
			const existing = nodeStateRef.current.get(item.id)
			if (existing) {
				// Если узел уже был, даем ему небольшой импульс, чтобы физика при смене выбора заново оживала
				nextMap.set(item.id, {
					...existing,
					vx: (Math.random() - 0.5) * 2,
					vy: (Math.random() - 0.5) * 2,
				})
			} else {
				// Распределяем новые узлы по кругу
				const angle = (index / Math.max(items.length, 1)) * 2 * Math.PI
				const radius = Math.min(width, height) * 0.35
				nextMap.set(item.id, {
					x: width / 2 + Math.cos(angle) * radius,
					y: height / 2 + Math.sin(angle) * radius,
					vx: 0,
					vy: 0,
				})
			}
		})

		nodeStateRef.current = nextMap
		triggerPhysics()
	}, [items, width, height, triggerPhysics])

	// 2. Симуляция физики
	useEffect(() => {
		const step = () => {
			if (alphaRef.current > 0.005) {
				const nodes = Array.from(nodeStateRef.current.entries())
				const linkList = links.filter(
					(l) => nodeStateRef.current.has(l.itemId) && nodeStateRef.current.has(l.targetId),
				)

				const currentAlpha = alphaRef.current

				// 1. Сила отталкивания N-Body
				const REPULSION_STRENGTH = 12000
				for (let i = 0; i < nodes.length; i++) {
					for (let j = i + 1; j < nodes.length; j++) {
						const [id1, node1] = nodes[i]
						const [id2, node2] = nodes[j]

						const dx = node2.x - node1.x
						const dy = node2.y - node1.y
						const distSq = dx * dx + dy * dy + 100
						const force = (REPULSION_STRENGTH / distSq) * currentAlpha

						const fx = (dx / Math.sqrt(distSq)) * force
						const fy = (dy / Math.sqrt(distSq)) * force

						if (dragNodeRef.current?.id !== id1) {
							node1.vx -= fx
							node1.vy -= fy
						}
						if (dragNodeRef.current?.id !== id2) {
							node2.vx += fx
							node2.vy += fy
						}
					}
				}

				// 2. Сила упругости связей
				const TARGET_LINK_DISTANCE = 260
				const LINK_STRENGTH = 0.08
				linkList.forEach((link) => {
					const source = nodeStateRef.current.get(link.itemId)
					const target = nodeStateRef.current.get(link.targetId)
					if (!source || !target) return

					const dx = target.x - source.x
					const dy = target.y - source.y
					const dist = Math.sqrt(dx * dx + dy * dy) || 1
					const delta = dist - TARGET_LINK_DISTANCE
					const force = delta * LINK_STRENGTH * currentAlpha

					const fx = (dx / dist) * force
					const fy = (dy / dist) * force

					if (dragNodeRef.current?.id !== link.itemId) {
						source.vx += fx
						source.vy += fy
					}
					if (dragNodeRef.current?.id !== link.targetId) {
						target.vx -= fx
						target.vy -= fy
					}
				})

				// 3. Мягкое притягивание к центру
				const CENTER_STRENGTH = 0.015
				nodes.forEach(([id, node]) => {
					if (dragNodeRef.current?.id === id) return
					node.vx += (width / 2 - node.x) * CENTER_STRENGTH * currentAlpha
					node.vy += (height / 2 - node.y) * CENTER_STRENGTH * currentAlpha
				})

				// 4. Применение скоростей и затухание
				const DAMPING = 0.6
				const nextPositions = new Map<string, { x: number; y: number }>()

				nodes.forEach(([id, node]) => {
					if (dragNodeRef.current?.id !== id) {
						node.vx *= DAMPING
						node.vy *= DAMPING
						node.x += node.vx
						node.y += node.vy

						node.x = Math.max(60, Math.min(width - 60, node.x))
						node.y = Math.max(40, Math.min(height - 40, node.y))
					}
					nextPositions.set(id, { x: node.x, y: node.y })
				})

				setPositions(nextPositions)
				alphaRef.current *= 0.96
			}

			animFrameRef.current = requestAnimationFrame(step)
		}

		animFrameRef.current = requestAnimationFrame(step)

		return () => {
			if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
		}
	}, [items, links, width, height])

	const startDrag = (id: string, mouseX: number, mouseY: number, nodeX: number, nodeY: number) => {
		dragNodeRef.current = {
			id,
			offsetX: mouseX - nodeX,
			offsetY: mouseY - nodeY,
		}
		triggerPhysics()
	}

	const updateDrag = (mouseX: number, mouseY: number) => {
		if (!dragNodeRef.current) return
		const { id, offsetX, offsetY } = dragNodeRef.current
		const node = nodeStateRef.current.get(id)
		if (node) {
			node.x = Math.max(60, Math.min(width - 60, mouseX - offsetX))
			node.y = Math.max(40, Math.min(height - 40, mouseY - offsetY))
			node.vx = 0
			node.vy = 0

			// Не даем симуляции засыпать во время перетаскивания
			alphaRef.current = Math.max(alphaRef.current, 0.2)

			setPositions((prev) => {
				const next = new Map(prev)
				next.set(id, { x: node.x, y: node.y })
				return next
			})
		}
	}

	const endDrag = () => {
		dragNodeRef.current = null
	}

	return {
		positions,
		startDrag,
		updateDrag,
		endDrag,
	}
}
