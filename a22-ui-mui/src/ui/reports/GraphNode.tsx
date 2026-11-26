import { Paper, Typography } from '@mui/material'
import React, { useRef } from 'react'

interface GraphNodeProps {
	id: string
	title: string
	value: string
	x: number
	y: number
	isSelected: boolean
	isDimmed?: boolean
	onClick: (e: React.MouseEvent, id: string) => void
	onMouseDown: (e: React.MouseEvent, id: string) => void
}

export const GraphNode = React.memo(function GraphNode({
	id,
	title,
	value,
	x,
	y,
	isSelected,
	isDimmed = false,
	onClick,
	onMouseDown,
}: GraphNodeProps) {
	const dragStartPos = useRef<{ x: number; y: number } | null>(null)
	const hasDragged = useRef(false)

	const handleMouseDown = (e: React.MouseEvent) => {
		dragStartPos.current = { x: e.clientX, y: e.clientY }
		hasDragged.current = false
		onMouseDown(e, id)
	}

	const handleMouseMove = (e: React.MouseEvent) => {
		if (dragStartPos.current) {
			const dx = Math.abs(e.clientX - dragStartPos.current.x)
			const dy = Math.abs(e.clientY - dragStartPos.current.y)
			if (dx > 4 || dy > 4) {
				hasDragged.current = true
			}
		}
	}

	const handleClick = (e: React.MouseEvent) => {
		// Если происходило перетаскивание — блокируем переход/клик
		if (hasDragged.current) {
			e.stopPropagation()
			e.preventDefault()
			hasDragged.current = false
			dragStartPos.current = null
			return
		}
		onClick(e, id)
	}

	return (
		<Paper
			elevation={isSelected ? 4 : 1}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onClick={handleClick}
			sx={{
				position: 'absolute',
				left: x,
				top: y,
				transform: 'translate(-50%, -50%)',
				p: 1,
				px: 1.5,
				borderRadius: 1.5,
				border: '1.5px solid',
				borderColor: isSelected ? 'primary.main' : 'divider',
				bgcolor: isSelected ? 'primary.50' : 'background.paper',
				cursor: 'grab',
				'&:active': { cursor: 'grabbing' },
				userSelect: 'none',
				zIndex: isSelected ? 10 : 2,
				opacity: isDimmed ? 0.2 : 1,
				transition: 'opacity 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
				maxWidth: 220,
				minWidth: 110,
			}}
		>
			<Typography
				variant="subtitle2"
				noWrap
				sx={{
					fontWeight: isSelected ? 700 : 600,
					fontSize: '0.8125rem',
					lineHeight: 1.2,
					color: isSelected ? 'primary.dark' : 'text.primary',
				}}
			>
				{title}
			</Typography>
			{value && (
				<Typography
					variant="caption"
					noWrap
					display="block"
					sx={{
						color: 'text.secondary',
						fontSize: '0.7rem',
						mt: 0.25,
					}}
				>
					{value}
				</Typography>
			)}
		</Paper>
	)
})
