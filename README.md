# Nexus

**Code graph context engine for AI coding assistants.**

Nexus indexes your codebase as a directed symbol graph (functions, classes, imports, call edges) stored in an embedded SQLite database. It exposes the graph via an MCP server so AI assistants like Claude Code fetch only the *relevant* code for each query — instead of reading whole files — cutting token usage dramatically.

```
Your codebase → Nexus indexer → SQLite symbol graph
                                      ↓
              Claude Code ← MCP server (stdio or HTTP)
                    ↓
           get_context_for_query("how does auth work?")
                    ↓
           Ranked, budget-constrained code snippets (≤8 000 tokens)
```

---

## Features

- **Multi-language**: Python, TypeScript, JavaScript (JSX/TSX)
- **Symbol graph**: functions, classes, methods, variables, interfaces, type aliases — with import/call/extends edges
- **Token-budgeted context**: BFS from anchor symbols, scored by proximity + recency, degraded gracefully (full → definition-only) to stay within budget
- **Full-text search**: FTS5 over symbol names and signatures
- **File watcher**: incremental re-index on save (`--watch`)
- **Two transports**: stdio (Claude Code native) and HTTP (Streamable MCP)
- **Interactive visualization**: neon graph UI — directory overview, drill into file/symbol clusters

---

## Installation

```bash
npm install -g nexus-graph
```

Or run without installing:

```bash
npx nexus-graph --project /path/to/your/project
```

---

## Quick Start

**1. Index your project and start the MCP server (stdio)**

```bash
nexus-mcp --project /path/to/your/project
```

Nexus indexes all `.py`, `.ts`, `.tsx`, `.js`, `.jsx` files on first run, writes `<project>/.nexus/graph.db`, then listens on stdio.

**2. Add to Claude Code**

```jsonc
// ~/.claude/settings.json
{
  "mcpServers": {
    "nexus": {
      "command": "nexus-mcp",
      "args": ["--project", "/path/to/your/project"]
    }
  }
}
```

**3. Use in Claude Code**

Claude will automatically call `get_context_for_query` before answering questions about your codebase. You can also call it explicitly:

```
use get_context_for_query for "how does the auth middleware work?"
```

---

## CLI Reference

### `nexus-mcp` — stdio MCP server

```
nexus-mcp [options]

Options:
  --project, -p <path>   Project root to index (default: cwd)
  --db <path>            SQLite db path (default: <project>/.nexus/graph.db)
  --watch, -w            Watch for file changes and re-index incrementally
```

### `nexus-mcp-http` — HTTP MCP server

```
nexus-mcp-http [options]

Options:
  --project, -p <path>   Project root to index (default: cwd)
  --db <path>            SQLite db path (default: <project>/.nexus/graph.db)
  --port <n>             Port to listen on (default: 3333)
  --watch, -w            Watch for file changes
```

Connect from Claude Code:

```jsonc
{
  "mcpServers": {
    "nexus": {
      "type": "http",
      "url": "http://localhost:3333/mcp"
    }
  }
}
```

### `nexus-viz` — Interactive graph visualization

```
nexus-viz [options]

Options:
  --project, -p <path>   Project root (for relative file paths)
  --db <path>            SQLite db path (default: <project>/.nexus/graph.db)
  --out, -o <path>       Output HTML path (default: /tmp/nexus-graph.html)
```

Opens an interactive neon-themed graph in your browser. Directory-level overview with drill-down into file and symbol clusters.

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_context_for_query` | Natural-language query → BFS from matching symbols → ranked, token-budgeted context block |
| `search_symbols` | FTS5 search across symbol names and signatures |
| `get_symbol_context` | BFS from a named symbol, returns its context within token budget |
| `apply_edit_and_update_graph` | Re-index a single file after an edit (invalidates stale nodes) |
| `get_stats` | Returns symbol/edge/file counts for the current index |

### `get_context_for_query`

```typescript
get_context_for_query({
  query: string,          // natural-language description
  budget_tokens?: number, // token limit (default: 8000)
  k_steps?: number,       // BFS depth (default: 3)
})
```

Returns a text block with the most relevant function/class bodies and signatures, trimmed to fit the token budget.

### `search_symbols`

```typescript
search_symbols({
  query: string,   // full-text search (FTS5)
  limit?: number,  // max results (default: 20)
})
```

---

## Programmatic API

Nexus can also be used as a library:

```typescript
import { NexusDB } from 'nexus-graph/indexer/db';
import { indexProject } from 'nexus-graph/indexer/indexFile';
import { findAnchors, bfsTraversal } from 'nexus-graph/graph/traversal';
import { buildContext, formatContextResult } from 'nexus-graph/context/budget';
import { createSession, scoreNodes } from 'nexus-graph/graph/scorer';

const db = new NexusDB('/path/to/graph.db');

// Index a project
indexProject('/path/to/project', db);

// Query the graph
const session = createSession();
const anchors = findAnchors('authentication middleware', db, 5);
const nodes   = bfsTraversal(anchors, db, 3);
const scored  = scoreNodes(nodes, session);
const context = buildContext(scored, { maxTokens: 8000 });

console.log(formatContextResult(context));
```

---

## How It Works

### Indexer

1. Walks the project with `glob`, skipping `node_modules`, `.venv`, `dist`, etc.
2. Parses each file with **tree-sitter** (Python / TypeScript / JavaScript grammars)
3. Extracts symbols (name, type, signature, docstring, start/end line, body hash)
4. Resolves cross-file imports and writes `imports`/`calls`/`extends` edges
5. Stores everything in SQLite with an FTS5 virtual table for fast search

### Context Engine

1. **Anchor finding**: FTS5 full-phrase → word-by-word → file-path substring fallback
2. **BFS traversal**: `k`-step breadth-first from anchor symbols across import edges
3. **Scoring**: `0.4 × recency + 0.3 × proximity + 0.2 × edit_frequency + 0.1 × semantic_sim`
4. **Budget manager**: greedy fill (full bodies) → definition-only → drop leaf nodes until within token budget

### Storage

```sql
-- Symbols table
CREATE TABLE symbols (
  id          TEXT PRIMARY KEY,  -- sha1(file:name:line)
  symbol_name TEXT,
  symbol_type TEXT,              -- function | class | method | variable | interface
  file_path   TEXT,
  start_line  INTEGER,
  end_line    INTEGER,
  signature   TEXT,
  docstring   TEXT,
  visibility  TEXT,
  body_hash   TEXT
);

-- Directed edges
CREATE TABLE edges (
  from_id   TEXT,
  to_id     TEXT,
  edge_type TEXT,                -- imports | calls | extends | implements
  PRIMARY KEY (from_id, to_id, edge_type)
);

-- Full-text search
CREATE VIRTUAL TABLE symbols_fts USING fts5(
  symbol_name, file_path, signature,
  content=symbols, content_rowid=rowid
);
```

---

## Requirements

- Node.js ≥ 18
- The indexed project can be Python, TypeScript, or JavaScript (any mix)

---

## License

MIT
