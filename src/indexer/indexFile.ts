import { NexusDB, Symbol } from './db';
import { parseFile } from './parser';
import { buildImportEdges } from './resolver';
import * as path from 'path';

const IGNORE_PATTERNS = [
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
];

/**
 * Parse and index a single file (Python, TypeScript, or JavaScript).
 * `allSymbolsByFile` is used for cross-file edge resolution — pass an empty Map
 * when doing single-file updates (edges will be rebuilt on next full index).
 */
export function indexFile(
  filePath: string,
  projectRoot: string,
  db: NexusDB,
  allSymbolsByFile: Map<string, Symbol[]>,
): void {
  try {
    const { symbols, imports } = parseFile(filePath);
    db.upsertSymbols(symbols);

    const edges = buildImportEdges(imports, symbols, filePath, projectRoot, allSymbolsByFile);
    db.upsertEdges(edges);
  } catch (err) {
    console.error(`[nexus] error indexing ${filePath}: ${err}`);
  }
}

/**
 * Full project index: walk all supported files, parse them, then resolve cross-file edges.
 * Supports: .py, .ts, .tsx, .js, .jsx
 */
export function indexProject(projectRoot: string, db: NexusDB): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { globSync } = require('glob');

  const allFiles: string[] = globSync('**/*.{py,ts,tsx,js,jsx}', {
    cwd: projectRoot,
    absolute: true,
  });

  const files: string[] = globSync('**/*.{py,ts,tsx,js,jsx}', {
    cwd: projectRoot,
    absolute: true,
    ignore: IGNORE_PATTERNS,
  });

  const skipped = allFiles.length - files.length;
  const total = files.length;
  console.error(`[nexus] indexing ${total} files (py/ts/js)...`);

  // Phase 1: parse all files, collect symbols
  const allSymbolsByFile = new Map<string, Symbol[]>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const { symbols } = parseFile(f);
      db.upsertSymbols(symbols);
      allSymbolsByFile.set(f, symbols);
    } catch (err) {
      console.error(`[nexus] parse error ${f}: ${err}`);
    }
    if ((i + 1) % 50 === 0 || i + 1 === total) {
      console.error(`[nexus] parsed ${i + 1}/${total} files...`);
    }
  }

  // Phase 2: resolve import edges now that all symbols are known
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const { imports } = parseFile(f);
      const symbols = allSymbolsByFile.get(f) ?? [];
      const edges = buildImportEdges(imports, symbols, f, projectRoot, allSymbolsByFile);
      db.upsertEdges(edges);
    } catch (err) {
      console.error(`[nexus] edge error ${f}: ${err}`);
    }
    if ((i + 1) % 50 === 0 || i + 1 === total) {
      console.error(`[nexus] resolved edges ${i + 1}/${total} files...`);
    }
  }

  const stats = db.getStats();
  console.error(`[nexus] index complete: ${stats.symbols} symbols, ${stats.edges} edges, ${stats.files} files (${skipped} files skipped)`);
}

/**
 * Entry point for CLI to run the indexer.
 */
export async function runIndexer(projectRoot: string): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
  const dbPath = path.join(resolvedRoot, '.nexus', 'graph.db');
  const db = new NexusDB(dbPath);
  try {
    indexProject(resolvedRoot, db);
  } finally {
    db.close();
  }
}
