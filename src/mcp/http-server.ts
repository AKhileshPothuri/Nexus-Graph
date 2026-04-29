#!/usr/bin/env node
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let projectRoot = process.cwd();
  let dbPath: string | null = null;
  let port = 3333;
  let watch = false;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--project' || args[i] === '-p') && args[i + 1]) projectRoot = path.resolve(args[++i]);
    else if (args[i] === '--db' && args[i + 1])                         dbPath = path.resolve(args[++i]);
    else if (args[i] === '--port' && args[i + 1])                       port = parseInt(args[++i], 10);
    else if (args[i] === '--watch' || args[i] === '-w')                 watch = true;
  }

  if (!fs.existsSync(projectRoot)) {
    console.error(`[nexus-http] project root not found: ${projectRoot}`);
    process.exit(1);
  }

  dbPath = dbPath ?? path.join(projectRoot, '.nexus', 'graph.db');
  return { projectRoot, dbPath, port, watch };
}

// ── Tool registration (called per-request for stateless transport) ────────────

function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: 'nexus', version: '0.1.0' });

  server.tool('search_symbols',
    'Search for symbols (functions, classes, variables) in the codebase by name or signature.',
    { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
    async ({ query, limit }) => ({
      content: [{ type: 'text', text: JSON.stringify(searchSymbols(deps, query, limit ?? 20), null, 2) }],
    }),
  );

  server.tool('get_context_for_query',
    'Given a natural-language query, returns the most relevant code context within a token budget. Call this before reading files to reduce token usage.',
    {
      query: z.string().describe('What you are looking for — e.g. "checkout flow", "user authentication"'),
      budget_tokens: z.number().int().min(500).max(32000).optional(),
      k_steps: z.number().int().min(1).max(5).optional(),
    },
    async ({ query, budget_tokens, k_steps }) => {
      recordFileAccess(deps.session, query);
      return { content: [{ type: 'text', text: getContextForQuery(deps, query, budget_tokens, k_steps ?? 3) }] };
    },
  );

  server.tool('get_symbol_context',
    'Get code context centered on a specific symbol, traversing its dependencies and callers.',
    {
      symbol_name: z.string(),
      k_steps: z.number().int().min(1).max(5).optional(),
      budget_tokens: z.number().int().min(500).max(32000).optional(),
    },
    async ({ symbol_name, k_steps, budget_tokens }) => ({
      content: [{ type: 'text', text: getSymbolContext(deps, symbol_name, k_steps ?? 3, budget_tokens) }],
    }),
  );

  server.tool('apply_edit_and_update_graph',
    'Re-index a file after editing to keep the code graph fresh.',
    { file_path: z.string() },
    async ({ file_path }) => {
      recordFileAccess(deps.session, file_path);
      return { content: [{ type: 'text', text: JSON.stringify(applyEditAndUpdateGraph(deps, file_path), null, 2) }] };
    },
  );

  server.tool('get_graph_stats',
    'Return index statistics: symbol count, edge count, file count.',
    {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(getStats(deps), null, 2) }] }),
  );

  return server;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { projectRoot, dbPath, port, watch } = parseArgs();

  const db = new NexusDB(dbPath);
  const session = createSession();

  indexProject(projectRoot, db);
  if (watch) watchProject(projectRoot, db);

  const deps: ToolDeps = { db, projectRoot, session };

  const app = express();
  app.use(express.json());

  // CORS — allow all origins so Claude.ai / tunnels can reach it
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    next();
  });
  app.options('/{*splat}', (_req, res) => { res.sendStatus(204); });

  // MCP endpoint — new transport + server per request (stateless pattern)
  app.post('/mcp', async (req: Request, res: Response) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildServer(deps);

    res.on('finish', () => { transport.close(); server.close(); });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[nexus-http] request error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /mcp — required by MCP spec for SSE upgrade (return 405 with hint)
  app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Use POST /mcp for MCP requests' });
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', project: projectRoot, ...db.getStats() });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`[nexus-http] MCP server: http://localhost:${port}/mcp`);
    console.log(`[nexus-http] Project:    ${projectRoot}`);
    console.log(`[nexus-http] Health:     http://localhost:${port}/health`);
  });
}

main().catch(err => { console.error('[nexus-http] fatal:', err); process.exit(1); });
