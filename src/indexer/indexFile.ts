import { NexusDB, Symbol } from './db';
import { parseFile } from './parser';
import { buildImportEdges } from './resolver';

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

  const files: string[] = globSync('**/*.{py,ts,tsx,js,jsx}', {
    cwd: projectRoot,
    absolute: true,
    ignore: IGNORE_PATTERNS,
  });

  console.error(`[nexus] indexing ${files.length} files (py/ts/js)...`);

  // Phase 1: parse all files, collect symbols
  const allSymbolsByFile = new Map<string, Symbol[]>();
  for (const f of files) {
    try {
      const { symbols } = parseFile(f);
      db.upsertSymbols(symbols);
      allSymbolsByFile.set(f, symbols);
    } catch (err) {
      console.error(`[nexus] parse error ${f}: ${err}`);
    }
  }

  // Phase 2: resolve import edges now that all symbols are known
  for (const f of files) {
    try {
      const { imports } = parseFile(f);
      const symbols = allSymbolsByFile.get(f) ?? [];
      const edges = buildImportEdges(imports, symbols, f, projectRoot, allSymbolsByFile);
      db.upsertEdges(edges);
    } catch (err) {
      console.error(`[nexus] edge error ${f}: ${err}`);
    }
  }

  const stats = db.getStats();
  console.error(`[nexus] index complete: ${stats.symbols} symbols, ${stats.edges} edges, ${stats.files} files`);
}
