#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { NexusDB } from '../indexer/db';
import { indexProject } from '../indexer/indexFile';
import { watchProject } from '../indexer/watcher';
import { createSession, recordFileAccess } from '../graph/scorer';
import {
  searchSymbols,
  getContextForQuery,
  getSymbolContext,
  applyEditAndUpdateGraph,
  getStats,
  ToolDeps,
} from './tools';

// ── CLI arg parsing ───────────────────────────────────────────────────────────

function parseArgs(): { projectRoot: string; dbPath: string; watch: boolean } {
  const args = process.argv.slice(2);
  let projectRoot = process.cwd();
  let dbPath: string | null = null;
  let watch = false;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--project' || args[i] === '-p') && args[i + 1]) {
      projectRoot = path.resolve(args[++i]);
    } else if ((args[i] === '--db') && args[i + 1]) {
      dbPath = path.resolve(args[++i]);
    } else if (args[i] === '--watch' || args[i] === '-w') {
      watch = true;
    }
  }

  if (!fs.existsSync(projectRoot)) {
    console.error(`[nexus] project root not found: ${projectRoot}`);
    process.exit(1);
  }

  dbPath = dbPath ?? path.join(projectRoot, '.nexus', 'graph.db');
  return { projectRoot, dbPath, watch };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { projectRoot, dbPath, watch } = parseArgs();

  const db = new NexusDB(dbPath);
  const session = createSession();

  // Index the project on startup
  indexProject(projectRoot, db);

  // Optionally watch for file changes
  if (watch) {
    watchProject(projectRoot, db);
    console.error(`[nexus] watching ${projectRoot} for changes`);
  }

  const deps: ToolDeps = { db, projectRoot, session };

  // ── MCP Server setup ────────────────────────────────────────────────────────

  const server = new McpServer({
    name: 'nexus',
    version: '0.1.0',
  });

  server.tool(
    'search_symbols',
    'Search for symbols (functions, classes, variables) in the codebase by name or signature.',
    {
      query: z.string().describe('Search query — symbol name or partial name'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
    },
    async ({ query, limit }) => {
      const result = searchSymbols(deps, query, limit ?? 20);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_context_for_query',
    'Given a natural-language query about the codebase, returns the most relevant code context within a token budget. Use this before asking questions about code to avoid reading entire files.',
    {
      query: z.string().describe('What you are looking for — e.g. "checkout flow", "user authentication", "database connection"'),
      budget_tokens: z.number().int().min(500).max(32000).optional().describe('Max tokens to return (default 8000)'),
      k_steps: z.number().int().min(1).max(5).optional().describe('Graph traversal depth (default 3)'),
    },
    async ({ query, budget_tokens, k_steps }) => {
      recordFileAccess(session, query); // track query as recency signal
      const text = getContextForQuery(deps, query, budget_tokens, k_steps ?? 3);
      return { content: [{ type: 'text', text }] };
    },
  );

  server.tool(
    'get_symbol_context',
    'Get code context centered on a specific symbol name, traversing its dependencies and callers.',
    {
      symbol_name: z.string().describe('Exact or partial symbol name'),
      k_steps: z.number().int().min(1).max(5).optional().describe('Graph traversal depth (default 3)'),
      budget_tokens: z.number().int().min(500).max(32000).optional().describe('Max tokens to return (default 8000)'),
    },
    async ({ symbol_name, k_steps, budget_tokens }) => {
      const text = getSymbolContext(deps, symbol_name, k_steps ?? 3, budget_tokens);
      return { content: [{ type: 'text', text }] };
    },
  );

  server.tool(
    'apply_edit_and_update_graph',
    'Re-index a file after it has been edited, keeping the code graph up to date.',
    {
      file_path: z.string().describe('Absolute path to the modified file'),
    },
    async ({ file_path }) => {
      recordFileAccess(session, file_path);
      const result = applyEditAndUpdateGraph(deps, file_path);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_graph_stats',
    'Return statistics about the current code graph index.',
    {},
    async () => {
      const stats = getStats(deps);
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    },
  );

  // ── Start transport ─────────────────────────────────────────────────────────

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[nexus] MCP server running on stdio');
}

main().catch(err => {
  console.error('[nexus] fatal:', err);
  process.exit(1);
});
