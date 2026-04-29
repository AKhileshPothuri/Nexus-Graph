import * as path from 'path';
import * as fs from 'fs';
import { ParsedImport } from './parser';
import { Edge, Symbol } from './db';

// ── Python stdlib (skip edge creation for these) ──────────────────────────────

const PY_STDLIB = new Set([
  'os', 'sys', 'io', 're', 'json', 'math', 'time', 'datetime', 'pathlib',
  'collections', 'itertools', 'functools', 'typing', 'abc', 'copy', 'enum',
  'logging', 'argparse', 'subprocess', 'threading', 'multiprocessing',
  'socket', 'http', 'urllib', 'email', 'html', 'xml', 'csv', 'sqlite3',
  'hashlib', 'hmac', 'secrets', 'base64', 'struct', 'pickle', 'shelve',
  'shutil', 'tempfile', 'glob', 'fnmatch', 'stat', 'contextlib', 'warnings',
  'unittest', 'dataclasses', 'inspect', 'ast', 'dis', 'tokenize', 'token',
  'traceback', 'pprint', 'textwrap', 'string', 'random', 'decimal', 'fractions',
  'statistics', 'heapq', 'bisect', 'array', 'queue', 'weakref', 'gc',
  'platform', 'signal', 'atexit', 'builtins', '__future__',
]);

function isPyStdlib(module: string): boolean {
  return PY_STDLIB.has(module.split('.')[0]);
}

// ── JS/TS extension resolution order ─────────────────────────────────────────

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.d.ts'];

function tryResolve(candidates: string[]): string | null {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ── Python import resolver ────────────────────────────────────────────────────

export function resolvePyImport(imp: ParsedImport, fromFile: string, projectRoot: string): string | null {
  const fromDir = path.dirname(fromFile);
  const mod = imp.module;

  if (isPyStdlib(mod)) return null;

  if (imp.isRelative || mod.startsWith('.')) {
    const dots = (mod.match(/^\.+/) ?? [''])[0].length;
    const rest = mod.replace(/^\.+/, '').replace(/\./g, path.sep);

    let base = fromDir;
    for (let i = 1; i < dots; i++) base = path.dirname(base);

    const candidates = rest
      ? [
          path.join(base, rest + '.py'),
          path.join(base, rest, '__init__.py'),
        ]
      : [
          path.join(base, '__init__.py'),
        ];
    return tryResolve(candidates);
  }

  const parts = mod.replace(/\./g, path.sep);
  const candidates = [
    path.join(projectRoot, parts + '.py'),
    path.join(projectRoot, parts, '__init__.py'),
    path.join(projectRoot, 'src', parts + '.py'),
    path.join(projectRoot, 'src', parts, '__init__.py'),
  ];
  return tryResolve(candidates);
}

// ── JS/TS import resolver ─────────────────────────────────────────────────────

export function resolveJsImport(imp: ParsedImport, fromFile: string, _projectRoot: string): string | null {
  // Only resolve relative imports; npm packages (no leading '.') are external
  if (!imp.isRelative) return null;

  const fromDir = path.dirname(fromFile);
  const base = path.resolve(fromDir, imp.module);

  // Already has an extension
  if (JS_EXTS.some(ext => imp.module.endsWith(ext)) && fs.existsSync(base)) return base;

  // Try adding extensions, then /index.<ext>
  const candidates = [
    ...JS_EXTS.map(ext => base + ext),
    ...JS_EXTS.map(ext => path.join(base, 'index' + ext)),
  ];
  return tryResolve(candidates);
}

// ── Unified edge builder ──────────────────────────────────────────────────────

const PY_EXT = '.py';
const JS_EXT_SET = new Set(['.ts', '.tsx', '.js', '.jsx']);

/**
 * Build import edges for both Python and JS/TS files.
 * Resolves import paths and creates 'imports' edges between symbols.
 */
export function buildImportEdges(
  imports: ParsedImport[],
  fromFileSymbols: Symbol[],
  fromFile: string,
  projectRoot: string,
  allSymbolsByFile: Map<string, Symbol[]>,
): Edge[] {
  const edges: Edge[] = [];
  if (fromFileSymbols.length === 0) return edges;

  const ext = path.extname(fromFile).toLowerCase();
  const isPy = ext === PY_EXT;
  const isJs = JS_EXT_SET.has(ext);
  if (!isPy && !isJs) return edges;

  // Use the first symbol in the file as the "file-level" representative
  const anchor = fromFileSymbols[0];

  for (const imp of imports) {
    const resolved = isPy
      ? resolvePyImport(imp, fromFile, projectRoot)
      : resolveJsImport(imp, fromFile, projectRoot);
    if (!resolved) continue;

    const targetSymbols = allSymbolsByFile.get(resolved);
    if (!targetSymbols || targetSymbols.length === 0) continue;

    // If specific names are imported, link to those symbols
    if (imp.names.length > 0 && imp.names[0] !== '*') {
      for (const name of imp.names) {
        const target = targetSymbols.find(s => s.symbol_name === name);
        edges.push({
          from_id: anchor.id,
          to_id: (target ?? targetSymbols[0]).id,
          edge_type: 'imports',
        });
      }
    } else {
      // Whole-module import: link to first symbol (file anchor)
      edges.push({ from_id: anchor.id, to_id: targetSymbols[0].id, edge_type: 'imports' });
    }
  }

  return edges;
}
