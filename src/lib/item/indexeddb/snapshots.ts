import type { DatabaseSnapshot } from '@/models/item/types'
import { itemDb } from './db'

export async function compressToGzipBase64(payload: string): Promise<{ encoding: DatabaseSnapshot['encoding']; data: string }> {
	console.log('[Snapshots:Compress]', 'Starting compression...')
	if (typeof CompressionStream === 'undefined') {
		console.log('[Snapshots:Compress]', 'CompressionStream not supported, using plain text')
		return { encoding: 'plain', data: payload }
	}
	try {
		const encoder = new TextEncoder()
		const bytes = encoder.encode(payload)
		const gzipStream = new CompressionStream('gzip')
		const writer = gzipStream.writable.getWriter()

		console.log('[Snapshots:Compress]', 'Writing to stream...')
		// Не ждем await здесь напрямую, чтобы не заблокировать чтение, если реализация стримов в браузере специфична
		writer.write(bytes).catch(e => console.error('[Snapshots:Compress] Write error:', e))
		writer.close().catch(e => console.error('[Snapshots:Compress] Close error:', e))

		console.log('[Snapshots:Compress]', 'Reading from stream...')
		const compressedBuffer = await new Response(gzipStream.readable).arrayBuffer()
		console.log('[Snapshots:Compress]', `Compressed buffer size: ${compressedBuffer.byteLength} bytes`)

		const compressedBytes = new Uint8Array(compressedBuffer)
		let binary = ''
		if (compressedBytes.length < 10000) {
			binary = String.fromCharCode(...compressedBytes)
		} else {
			for (let i = 0; i < compressedBytes.length; i++) {
				binary += String.fromCharCode(compressedBytes[i])
			}
		}

		console.log('[Snapshots:Compress]', 'Encoding to base64...')
		const result = btoa(binary)
		console.log('[Snapshots:Compress]', 'Compression finished')
		return { encoding: 'gzip-base64', data: result }
	} catch (error) {
		console.error('[Snapshots:Compress]', 'Critical compression error:', error)
		return { encoding: 'plain', data: payload }
	}
}

export async function createDatabaseSnapshot(sourceVersion: string): Promise<DatabaseSnapshot> {
	console.log('[Snapshots]', 'Fetching data for snapshot...')
	const [items, timers, itemLinks, itemTimerLinks] = await Promise.all([
		itemDb.items.toArray(),
		itemDb.timers.toArray(),
		itemDb.itemLinks.toArray(),
		itemDb.itemTimerLinks.toArray(),
	])
	console.log('[Snapshots]', `Data fetched: ${items.length} items. Stringifying...`)
	const createdAt = new Date().toISOString()
	const archivePayload = JSON.stringify({
		metadata: {
			version: sourceVersion,
			date: createdAt,
			source: 'pre-import-backup',
		},
		items,
		timers,
		itemLinks,
		itemTimerLinks,
	})
	console.log('[Snapshots]', `Payload size: ${(archivePayload.length / 1024 / 1024).toFixed(2)} MB. Compressing...`)
	const compressed = await compressToGzipBase64(archivePayload)
	console.log('[Snapshots]', `Compression done. Encoding: ${compressed.encoding}`)
	return {
		id: crypto.randomUUID(),
		createdAt,
		sourceVersion,
		encoding: compressed.encoding,
		payload: compressed.data,
		itemCount: items.length,
		timerCount: timers.length,
		itemLinkCount: itemLinks.length,
		itemTimerLinkCount: itemTimerLinks.length,
	}
}

export async function saveSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
	if (!itemDb.isOpen()) {
		await itemDb.open()
	}
	const hasSnapshotsTable = itemDb.tables.some((table) => table.name === 'snapshots')
	if (!hasSnapshotsTable) {
		console.error('[Snapshots]', 'Archive table "snapshots" is missing.')
		return
	}
	await itemDb.snapshots.put(snapshot)
}
