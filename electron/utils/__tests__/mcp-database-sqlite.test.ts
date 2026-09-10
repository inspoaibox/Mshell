import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { buildMcpDatabaseQuery } from '../mcp-database-query'

const available =
  spawnSync('sqlite3', ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0

describe.skipIf(!available)('SQLite CLI integration', () => {
  it('executes bounded queries on a real database while read-only mode rejects writes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mshell-db-query-'))
    const database = join(directory, 'test.sqlite')
    const init = join(directory, 'empty.sql')
    writeFileSync(init, '')
    try {
      const created = spawnSync('sqlite3', ['-batch', '-bail', '-init', init, database], {
        input:
          "CREATE TABLE logs(id INTEGER, message TEXT); INSERT INTO logs VALUES (1, 'first'), (2, 'second'), (3, 'third');",
        encoding: 'utf8',
        timeout: 5000
      })
      expect(created.status, created.stderr).toBe(0)
      const args = [
        '-safe',
        '-readonly',
        '-batch',
        '-bail',
        '-init',
        init,
        '-header',
        '-csv',
        database
      ]
      const plan = buildMcpDatabaseQuery({
        engine: 'sqlite',
        database: '/unused-test-path',
        query: 'WITH recent AS (SELECT * FROM logs) SELECT * FROM recent ORDER BY id DESC',
        maxRows: 2
      })
      const queried = spawnSync('sqlite3', args, {
        input: plan.stdin,
        encoding: 'utf8',
        timeout: 5000
      })
      expect(queried.status, queried.stderr).toBe(0)
      expect(queried.stdout.trim().split(/\r?\n/)).toEqual(['id,message', '3,third', '2,second'])
      const denied = spawnSync('sqlite3', args, {
        input: 'DELETE FROM logs;',
        encoding: 'utf8',
        timeout: 5000
      })
      expect(denied.status).not.toBe(0)
      expect(denied.stderr).toMatch(/readonly/i)
      const intact = spawnSync('sqlite3', args, {
        input: 'SELECT COUNT(*) AS remaining FROM logs;',
        encoding: 'utf8',
        timeout: 5000
      })
      expect(intact.stdout.trim().split(/\r?\n/)).toEqual(['remaining', '3'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
