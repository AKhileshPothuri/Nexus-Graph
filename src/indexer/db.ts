import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface Symbol {
  id: string;
  symbol_name: string;
  symbol_type: 'function' | 'class' | 'variable' | 'import' | 'method';
  file_path: string;
  start_line: number;
  end_line: number;
  signature: string;
  docstring: string;
  visibility: 'public' | 'private';
  body_hash: string;
  last_edited?: number;
  edit_count?: number;
}

export interface Edge {
  from_id: string;
  to_id: string;
  edge_type: 'imports' | 'calls' | 'extends' | 'implements' | 'defines';
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS symbols (
  id          TEXT PRIMARY KEY,
  symbol_name TEXT NOT NULL,
  symbol_type TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  signature   TEXT NOT NULL DEFAULT '',
  docstring   TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL DEFAULT 'public',
  body_hash   TEXT NOT NULL DEFAULT '',
  last_edited INTEGER NOT NULL DEFAULT 0,
  edit_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS edges (
  from_id   TEXT NOT NULL,
  to_id     TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_edges_from   ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to     ON edges(to_id);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  symbol_name,
  file_path,
  signature,
  docstring,
  content=symbols,
  content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
  INSERT INTO symbols_fts(rowid, symbol_name, file_path, signature, docstring)
  VALUES (new.rowid, new.symbol_name, new.file_path, new.signature, new.docstring);
END;

CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, symbol_name, file_path, signature, docstring)
  VALUES ('delete', old.rowid, old.symbol_name, old.file_path, old.signature, old.docstring);
END;

CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, symbol_name, file_path, signature, docstring)
  VALUES ('delete', old.rowid, old.symbol_name, old.file_path, old.signature, old.docstring);
  INSERT INTO symbols_fts(rowid, symbol_name, file_path, signature, docstring)
  VALUES (new.rowid, new.symbol_name, new.file_path, new.signature, new.docstring);
END;
`;

export class NexusDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  private migrate(): void {
    // Add docstring column to existing DBs that predate this field
    const cols = (this.db.pragma('table_info(symbols)') as { name: string }[]).map(c => c.name);
    if (!cols.includes('docstring')) {
      this.db.exec(`ALTER TABLE symbols ADD COLUMN docstring TEXT NOT NULL DEFAULT ''`);
      // Rebuild FTS index to include the new column
      this.db.exec(`INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild')`);
    }
    if (!cols.includes('last_edited')) {
      this.db.exec(`ALTER TABLE symbols ADD COLUMN last_edited INTEGER NOT NULL DEFAULT 0`);
      this.db.exec(`ALTER TABLE symbols ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0`);
    }
  }

  updateSymbolMetadata(id: string, last_edited: number, edit_count: number): void {
    this.db.prepare(`UPDATE symbols SET last_edited = ?, edit_count = ? WHERE id = ?`).run(last_edited, edit_count, id);
  }

  upsertSymbol(sym: Symbol): void {
    const existing = this.db.prepare('SELECT body_hash FROM symbols WHERE id = ?').get(sym.id) as { body_hash: string } | undefined;
    if (existing?.body_hash === sym.body_hash) return; // unchanged

    this.db.prepare(`
      INSERT INTO symbols (id, symbol_name, symbol_type, file_path, start_line, end_line, signature, docstring, visibility, body_hash, last_edited, edit_count)
      VALUES (@id, @symbol_name, @symbol_type, @file_path, @start_line, @end_line, @signature, @docstring, @visibility, @body_hash, COALESCE(@last_edited, 0), COALESCE(@edit_count, 0))
      ON CONFLICT(id) DO UPDATE SET
        symbol_name = excluded.symbol_name,
        symbol_type = excluded.symbol_type,
        start_line  = excluded.start_line,
        end_line    = excluded.end_line,
        signature   = excluded.signature,
        docstring   = excluded.docstring,
        visibility  = excluded.visibility,
        body_hash   = excluded.body_hash,
        last_edited = excluded.last_edited,
        edit_count  = excluded.edit_count
    `).run({
      ...sym,
      last_edited: sym.last_edited ?? 0,
      edit_count: sym.edit_count ?? 0
    });
  }

  upsertSymbols(symbols: Symbol[]): void {
    const insert = this.db.transaction((syms: Symbol[]) => {
      for (const s of syms) this.upsertSymbol(s);
    });
    insert(symbols);
  }

  deleteSymbolsByFile(filePath: string): void {
    // Remove edges where from_id belongs to this file
    const ids = (this.db.prepare('SELECT id FROM symbols WHERE file_path = ?').all(filePath) as { id: string }[]).map(r => r.id);
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM edges WHERE from_id IN (${placeholders})`).run(...ids);
    this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
  }

  upsertEdge(edge: Edge): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO edges (from_id, to_id, edge_type) VALUES (?, ?, ?)
    `).run(edge.from_id, edge.to_id, edge.edge_type);
  }

  upsertEdges(edges: Edge[]): void {
    const insert = this.db.transaction((es: Edge[]) => {
      for (const e of es) this.upsertEdge(e);
    });
    insert(edges);
  }

  getSymbolById(id: string): Symbol | undefined {
    return this.db.prepare('SELECT * FROM symbols WHERE id = ?').get(id) as Symbol | undefined;
  }

  getSymbolsByFile(filePath: string): Symbol[] {
    return this.db.prepare('SELECT * FROM symbols WHERE file_path = ?').all(filePath) as Symbol[];
  }

  getOutgoingEdges(symbolId: string): { to_id: string; edge_type: string }[] {
    return this.db.prepare('SELECT to_id, edge_type FROM edges WHERE from_id = ?').all(symbolId) as { to_id: string; edge_type: string }[];
  }

  getIncomingEdges(symbolId: string): { from_id: string; edge_type: string }[] {
    return this.db.prepare('SELECT from_id, edge_type FROM edges WHERE to_id = ?').all(symbolId) as { from_id: string; edge_type: string }[];
  }

  searchSymbols(query: string, limit = 20): Symbol[] {
    return this.db.prepare(`
      SELECT s.* FROM symbols s
      JOIN symbols_fts fts ON s.rowid = fts.rowid
      WHERE symbols_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query + '*', limit) as Symbol[];
  }

  searchSymbolsByFilePath(keywords: string[], limit = 20): Symbol[] {
    if (keywords.length === 0) return [];
    // Match any keyword against file_path (LIKE), return one representative symbol per file
    const conditions = keywords.map(() => `file_path LIKE ?`).join(' OR ');
    const params = keywords.map(k => `%${k}%`);
    return this.db.prepare(`
      SELECT * FROM symbols
      WHERE (${conditions})
        AND symbol_type IN ('function', 'class', 'method')
      ORDER BY file_path, start_line
      LIMIT ?
    `).all(...params, limit) as Symbol[];
  }

  getAllSymbols(): Symbol[] {
    return this.db.prepare('SELECT * FROM symbols').all() as Symbol[];
  }

  getAllEdges(): { from_id: string; to_id: string; edge_type: string }[] {
    return this.db.prepare('SELECT from_id, to_id, edge_type FROM edges').all() as { from_id: string; to_id: string; edge_type: string }[];
  }

  getStats(): { symbols: number; edges: number; files: number } {
    const symbols = (this.db.prepare('SELECT COUNT(*) as n FROM symbols').get() as { n: number }).n;
    const edges = (this.db.prepare('SELECT COUNT(*) as n FROM edges').get() as { n: number }).n;
    const files = (this.db.prepare('SELECT COUNT(DISTINCT file_path) as n FROM symbols').get() as { n: number }).n;
    return { symbols, edges, files };
  }

  close(): void {
    this.db.close();
  }
}
