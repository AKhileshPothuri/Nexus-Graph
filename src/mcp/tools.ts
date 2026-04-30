import { NexusDB } from '../indexer/db';
import { indexFile } from '../indexer/indexFile';
import { bfsTraversal, findAnchors } from '../graph/traversal';
import { scoreNodes, SessionState } from '../graph/scorer';
import { buildContext, formatContextResult, DEFAULT_BUDGET, BudgetConfig } from '../context/budget';

export interface ToolDeps {
  db: NexusDB;
  projectRoot: string;
  session: SessionState;
}

// ── search_symbols ────────────────────────────────────────────────────────────

export function searchSymbols(
  deps: ToolDeps,
  query: string,
  limit = 20,
): object {
  const results = deps.db.searchSymbols(query, limit);
  return {
    query,
    count: results.length,
    symbols: results.map(s => ({
      name: s.symbol_name,
      type: s.symbol_type,
      file: s.file_path,
      line: s.start_line,
      signature: s.signature,
    })),
  };
}

// ── get_context_for_query ─────────────────────────────────────────────────────

export function getContextForQuery(
  deps: ToolDeps,
  query: string,
  budgetTokens?: number,
  kSteps = 3,
): string {
  const config: BudgetConfig = {
    ...DEFAULT_BUDGET,
    maxTokens: budgetTokens ?? DEFAULT_BUDGET.maxTokens,
  };

  const anchorIds = findAnchors(query, deps.db, 5);
  if (anchorIds.length === 0) {
    return `[nexus: no matching symbols found for query "${query}"]`;
  }

  const nodes     = bfsTraversal(anchorIds, deps.db, kSteps);
  const scored    = scoreNodes(nodes, deps.session);
  const context   = buildContext(scored, config);

  return formatContextResult(context);
}

// ── get_symbol_context ────────────────────────────────────────────────────────

export function getSymbolContext(
  deps: ToolDeps,
  symbolName: string,
  kSteps = 3,
  budgetTokens?: number,
): string {
  const config: BudgetConfig = {
    ...DEFAULT_BUDGET,
    maxTokens: budgetTokens ?? DEFAULT_BUDGET.maxTokens,
  };

  const anchors = deps.db.searchSymbols(symbolName, 3);
  if (anchors.length === 0) {
    return `[nexus: symbol "${symbolName}" not found]`;
  }

  const anchorIds = anchors.map(s => s.id);
  const nodes     = bfsTraversal(anchorIds, deps.db, kSteps);
  const scored    = scoreNodes(nodes, deps.session);
  const context   = buildContext(scored, config);

  return formatContextResult(context);
}

// ── apply_edit_and_update_graph ───────────────────────────────────────────────

export function applyEditAndUpdateGraph(
  deps: ToolDeps,
  filePath: string,
): object {
  const oldSymbols = deps.db.getSymbolsByFile(filePath);

  deps.db.deleteSymbolsByFile(filePath);
  indexFile(filePath, deps.projectRoot, deps.db, new Map());

  const newSymbols = deps.db.getSymbolsByFile(filePath);
  for (const newSym of newSymbols) {
      const old = oldSymbols.find(s => s.symbol_name === newSym.symbol_name);
      const count = (old?.edit_count || 0) + 1;
      const lastEdited = Date.now();
      deps.db.updateSymbolMetadata(newSym.id, lastEdited, count);
  }

  return {
    updated: filePath,
    symbols_reindexed: newSymbols.length,
  };
}

// ── get_stats ─────────────────────────────────────────────────────────────────

export function getStats(deps: ToolDeps): object {
  return deps.db.getStats();
}
