import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NexusDB } from '../indexer/db'
import { indexProject, runIndexer } from '../indexer/indexFile'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'))
  fs.writeFileSync(path.join(dir, 'hello.ts'), `export function hello() { return 'hi'; }`)
  fs.writeFileSync(path.join(dir, 'world.py'), `def world():\n    return 'world'`)
  const nodeModules = path.join(dir, 'node_modules', 'pkg')
  fs.mkdirSync(nodeModules, { recursive: true })
  fs.writeFileSync(path.join(nodeModules, 'index.js'), `module.exports = {}`)
  return dir
}

function makeDb(dir: string): NexusDB {
  const dbDir = path.join(dir, '.nexus')
  fs.mkdirSync(dbDir, { recursive: true })
  return new NexusDB(path.join(dbDir, 'graph.db'))
}

describe('indexProject', () => {
  let projectDir: string
  let db: NexusDB
  const stderr: string[] = []

  beforeEach(() => {
    projectDir = makeTempProject()
    db = makeDb(projectDir)
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      stderr.push(args.join(' '))
    })
    stderr.length = 0
  })

  afterEach(() => {
    db.close()
    fs.rmSync(projectDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('indexes supported files and skips node_modules', () => {
    indexProject(projectDir, db)
    const stats = db.getStats()
    expect(stats.files).toBeGreaterThan(0)
  })

  it('prints progress output', () => {
    indexProject(projectDir, db)
    const output = stderr.join('')
    expect(output).toContain('[nexus] indexing')
    expect(output).toContain('[nexus] index complete')
  })

  it('reports skipped files in summary', () => {
    indexProject(projectDir, db)
    const summary = stderr.join('')
    expect(summary).toMatch(/\d+ files skipped/)
  })

  it('skipped count reflects node_modules exclusion', () => {
    indexProject(projectDir, db)
    const summary = stderr.join('')
    const match = summary.match(/\((\d+) files skipped\)/)
    expect(match).not.toBeNull()
    const skipped = parseInt(match![1])
    expect(skipped).toBeGreaterThanOrEqual(1)
  })
})

describe('runIndexer', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = makeTempProject()
  })

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('completes without throwing', async () => {
    await expect(runIndexer(projectDir)).resolves.toBeUndefined()
  })

  it('creates the .nexus/graph.db file', async () => {
    await runIndexer(projectDir)
    expect(fs.existsSync(path.join(projectDir, '.nexus', 'graph.db'))).toBe(true)
  })
})
