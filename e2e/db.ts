// SQLite assertions for the E2E suite: reads the same a22.db file the Rust
// bridge (and therefore the app under test) writes to.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DB_PATH } from './env'

const pExecFile = promisify(execFile)

export async function dbQuery(sql: string): Promise<string> {
	const { stdout } = await pExecFile('sqlite3', ['-batch', '-noheader', DB_PATH, sql])
	return stdout.trim()
}

export async function dbCount(table: string): Promise<number> {
	return Number(await dbQuery(`SELECT COUNT(*) FROM ${table}`))
}

export async function dbRows(sql: string): Promise<Array<Record<string, string>>> {
	const raw = await dbQuery(sql)
	if (raw.length === 0) {
		return []
	}
	const lines = raw.split('\n')
	const headers = lines[0].split('|')
	return lines.slice(1).map((line) => {
		const cells = line.split('|')
		return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
	})
}
