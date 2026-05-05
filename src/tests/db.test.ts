import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NexusDB } from '../indexer/db'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

describe('NexusDB', () => {
  let dbPath: string
  let db: NexusDB

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `nexus-test-${Date.now()}.db`)
    db = new NexusDB(dbPath)
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  it('initializes without errors', () => {
    expect(db).toBeDefined()
  })

  it('returns empty array for unknown file', () => {
    const symbols = db.getSymbolsByFile('/nonexistent/file.ts')
    expect(symbols).toEqual([])
  })
})
