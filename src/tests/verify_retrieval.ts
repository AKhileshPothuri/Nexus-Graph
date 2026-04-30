
import { NexusDB } from '../indexer/db';
import { indexFile } from '../indexer/indexFile';
import { createSession, scoreNodes } from '../graph/scorer';
import { ToolDeps, applyEditAndUpdateGraph, getContextForQuery } from '../mcp/tools';
import * as path from 'path';
import * as fs from 'fs';

async function runTest() {
  const projectRoot = '/tmp/nexus-test';
  const dbPath = path.join(projectRoot, '.nexus', 'test.db');
  
  // Cleanup
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  
  console.log('--- Phase 1: Initial Indexing ---');
  const db = new NexusDB(dbPath);
  const session = createSession();
  const deps: ToolDeps = { db, projectRoot, session };

  const testFile = path.join(projectRoot, 'src', 'hello.ts');
  indexFile(testFile, projectRoot, db, new Map());

  let symbols = db.getSymbolsByFile(testFile);
  console.log(`Indexed ${symbols.length} symbols.`);
  console.log('Symbol 0 metadata:', {
    name: symbols[0].symbol_name,
    last_edited: symbols[0].last_edited,
    edit_count: symbols[0].edit_count
  });

  if (symbols[0].edit_count !== 0) throw new Error('Initial edit_count should be 0');

  console.log('\n--- Phase 2: Simulating Edit ---');
  // Edit the file (just trigger the tool)
  applyEditAndUpdateGraph(deps, testFile);

  symbols = db.getSymbolsByFile(testFile);
  console.log('Symbol 0 metadata after 1st edit:', {
    name: symbols[0].symbol_name,
    last_edited: symbols[0].last_edited,
    edit_count: symbols[0].edit_count
  });

  if (symbols[0].edit_count !== 1) throw new Error('edit_count should be 1');
  if (symbols[0].last_edited === 0) throw new Error('last_edited should be updated');

  const firstEditTime = symbols[0].last_edited!;

  console.log('\n--- Phase 3: Simulating Second Edit ---');
  // Wait a bit to ensure timestamp changes
  await new Promise(resolve => setTimeout(resolve, 10));
  applyEditAndUpdateGraph(deps, testFile);

  symbols = db.getSymbolsByFile(testFile);
  console.log('Symbol 0 metadata after 2nd edit:', {
    name: symbols[0].symbol_name,
    last_edited: symbols[0].last_edited,
    edit_count: symbols[0].edit_count
  });

  if (symbols[0].edit_count !== 2) throw new Error('edit_count should be 2');
  if (symbols[0].last_edited! <= firstEditTime) throw new Error('last_edited should have increased');

  console.log('\n--- Phase 4: Scoring Verification ---');
  const context = getContextForQuery(deps, 'hello', 1000, 1);
  console.log('Context retrieval result preview:');
  console.log(context.substring(0, 200) + '...');

  if (!context.includes('function hello')) throw new Error('Context should include hello function');

  console.log('\n✅ All tests passed!');
  db.close();
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
