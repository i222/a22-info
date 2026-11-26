import HubRounded from '@mui/icons-material/HubRounded'
import { Box, Stack, Typography } from '@mui/material'
import React, { useEffect, useRef, useState } from 'react'
import { getItemDisplayValue } from 'src/ui-core/models/item/helpers'
import type { Item, ItemLink } from 'src/ui-core/models/item/types'
import { GraphNode } from './GraphNode'
import { useForceLayout } from './useForceLayout'

interface RelationshipGraphProps {
	items: Array<Item>
	itemLinks: Array<ItemLink>
	selectedTags: Array<string>
	typeFilters: Array<string>
	focusItemId: string | null
	onSelectNode: (id: string | null) => void
}

function getNodeIntersection(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	nodeWidth = 140,
	nodeHeight = 44,
): { x: number; y: number } {
	const dx = toX - fromX
	const dy = toY - fromY

	if (dx === 0 && dy === 0) return { x: toX, y: toY }

	const halfW = nodeWidth / 2
	const halfH = nodeHeight / 2

	const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity
	const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity
	const scale = Math.min(scaleX, scaleY)

	return {
		x: toX - dx * scale,
		y: toY - dy * scale,
	}
}

export function RelationshipGraph({
	items,
	itemLinks,
	selectedTags: _selectedTags,
	typeFilters,
	focusItemId,
	onSelectNode,
}: RelationshipGraphProps) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const canvasRef = useRef<HTMLCanvasElement | null>(null)

	const [size, setSize] = useState({ width: 800, height: 600 })

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const { width, height } = entry.contentRect
				if (width > 0 && height > 0) {
					setSize({
						width: Math.floor(width),
						height: Math.floor(height),
					})
				}
			}
		})

		observer.observe(container)
		return () => observer.disconnect()
	}, [])

	// Фильтрация ребер по типам
	const typeFilteredLinks = React.useMemo(() => {
		if (typeFilters.length === 0) return itemLinks
		return itemLinks.filter((link) => typeFilters.includes(link.type))
	}, [itemLinks, typeFilters])

	// Показываем ТОЛЬКО выбранный элемент и его прямые связи
	const { visibleItems, visibleLinks } = React.useMemo(() => {
		if (!focusItemId) {
			return { visibleItems: [], visibleLinks: [] }
		}

		const neighborIds = new Set<string>([focusItemId])
		const activeLinks: Array<ItemLink> = []

		typeFilteredLinks.forEach((link) => {
			if (link.itemId === focusItemId) {
				neighborIds.add(link.targetId)
				activeLinks.push(link)
			} else if (link.targetId === focusItemId) {
				neighborIds.add(link.itemId)
				activeLinks.push(link)
			}
		})

		const activeItems = items.filter((item) => neighborIds.has(item.id))
		return { visibleItems: activeItems, visibleLinks: activeLinks }
	}, [items, typeFilteredLinks, focusItemId])

	const { positions, startDrag, updateDrag, endDrag } = useForceLayout({
		items: visibleItems,
		links: visibleLinks,
		width: size.width,
		height: size.height,
	})

	// Отрисовка стрелок
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const ctx = canvas.getContext('2d')
		if (!ctx) return

		ctx.clearRect(0, 0, size.width, size.height)

		visibleLinks.forEach((link) => {
			const p1 = positions.get(link.itemId)
			const p2 = positions.get(link.targetId)
			if (!p1 || !p2) return

			const dx = p2.x - p1.x
			const dy = p2.y - p1.y
			if (Math.hypot(dx, dy) < 10) return

			const end = getNodeIntersection(p1.x, p1.y, p2.x, p2.y, 150, 48)
			const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)

			ctx.beginPath()
			ctx.moveTo(p1.x, p1.y)
			ctx.lineTo(end.x, end.y)
			ctx.strokeStyle = '#94a3b8'
			ctx.lineWidth = 1.5
			ctx.stroke()

			const ARROW_SIZE = 8
			ctx.beginPath()
			ctx.moveTo(end.x, end.y)
			ctx.lineTo(
				end.x - ARROW_SIZE * Math.cos(angle - Math.PI / 6),
				end.y - ARROW_SIZE * Math.sin(angle - Math.PI / 6),
			)
			ctx.lineTo(
				end.x - ARROW_SIZE * Math.cos(angle + Math.PI / 6),
				end.y - ARROW_SIZE * Math.sin(angle + Math.PI / 6),
			)
			ctx.closePath()
			ctx.fillStyle = '#94a3b8'
			ctx.fill()
		})
	}, [positions, visibleLinks, size])

	const handleMouseMove = (e: React.MouseEvent) => {
		if (!containerRef.current) return
		const rect = containerRef.current.getBoundingClientRect()
		updateDrag(e.clientX - rect.left, e.clientY - rect.top)
	}

	const handleMouseUp = () => {
		endDrag()
	}

	return (
		<Box
			ref={containerRef}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseUp}
			sx={{
				width: '100%',
				height: '100%',
				position: 'relative',
				overflow: 'hidden',
				bgcolor: '#fafafa',
			}}
		>
			{/* Заглушка, когда ничего не выбрано */}
			{!focusItemId && (
				<Stack
					alignItems="center"
					justifyContent="center"
					spacing={1}
					sx={{
						position: 'absolute',
						top: '50%',
						left: '50%',
						transform: 'translate(-50%, -50%)',
						zIndex: 0,
						pointerEvents: 'none',
						color: 'text.disabled',
					}}
				>
					<HubRounded sx={{ fontSize: 48, opacity: 0.4 }} />
					<Typography variant="body2" sx={{ fontWeight: 500, opacity: 0.7 }}>
						Выберите элемент из списка слева, чтобы увидеть его связи
					</Typography>
				</Stack>
			)}

			<canvas
				ref={canvasRef}
				width={size.width}
				height={size.height}
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					pointerEvents: 'none',
					zIndex: 1,
				}}
			/>

			{visibleItems.map((item) => {
				const pos = positions.get(item.id)
				if (!pos) return null

				const cleanTitle = getItemDisplayValue(item) || 'Без названия'
				const isSelected = focusItemId === item.id

				return (
					<GraphNode
						key={item.id}
						id={item.id}
						title={cleanTitle}
						value=""
						x={pos.x}
						y={pos.y}
						isSelected={isSelected}
						isDimmed={false}
						onClick={() => onSelectNode(item.id)}
						onMouseDown={(e) => {
							if (!containerRef.current) return
							const rect = containerRef.current.getBoundingClientRect()
							startDrag(
								item.id,
								e.clientX - rect.left,
								e.clientY - rect.top,
								pos.x,
								pos.y,
							)
						}}
					/>
				)
			})}
		</Box>
	)
}
