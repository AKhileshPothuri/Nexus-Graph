import { get_encoding, Tiktoken } from 'tiktoken';
import { ScoredNode } from '../graph/scorer';
import { formatSymbol, FormatMode } from './formatter';

// Singleton encoder — cl100k_base matches Claude's tokenizer
let _enc: Tiktoken | null = null;
function getEncoder(): Tiktoken {
  if (!_enc) _enc = get_encoding('cl100k_base');
  return _enc;
}

export interface BudgetConfig {
  maxTokens: number;          // default 8000
  fullModeThreshold: number;  // 0-1 fraction of budget for full mode, default 0.8
}

export const DEFAULT_BUDGET: BudgetConfig = {
  maxTokens: 8000,
  fullModeThreshold: 0.8,
};

function countTokens(text: string): number {
  try {
    const n = getEncoder().encode(text).length;
    // If WASM returned empty result, fall back to char-based estimate
    if (n === 0 && text.length > 0) return Math.ceil(text.length / 4);
    return n;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export interface ContextEntry {
  symbolId: string;
  symbolName: string;
  filePath: string;
  startLine: number;
  content: string;
  mode: FormatMode;
  tokens: number;
  score: number;
}

export interface ContextResult {
  entries: ContextEntry[];
  totalTokens: number;
  budget: number;
  truncated: boolean;
}

export function buildContext(
  scoredNodes: ScoredNode[],
  config: BudgetConfig = DEFAULT_BUDGET,
): ContextResult {
  const budget = config.maxTokens;
  const fullBudget = Math.floor(budget * config.fullModeThreshold);
  let usedTokens = 0;
  const entries: ContextEntry[] = [];
  let truncated = false;

  for (const node of scoredNodes) {
    if (usedTokens >= budget) {
      truncated = true;
      break;
    }

    const remaining = budget - usedTokens;

    // Try full mode first
    let mode: FormatMode = 'full';
    let content = formatSymbol(node.symbol, 'full');
    let tokens = countTokens(content);

    // Downgrade to definition-only if full mode would exceed the full-mode threshold
    if (usedTokens + tokens > fullBudget) {
      mode = 'definition';
      content = formatSymbol(node.symbol, 'definition');
      tokens = countTokens(content);
    }

    // Skip entirely if even definition doesn't fit
    if (tokens > remaining) {
      truncated = true;
      continue;
    }

    usedTokens += tokens;
    entries.push({
      symbolId: node.symbol.id,
      symbolName: node.symbol.symbol_name,
      filePath: node.symbol.file_path,
      startLine: node.symbol.start_line,
      content,
      mode,
      tokens,
      score: node.score,
    });
  }

  return { entries, totalTokens: usedTokens, budget, truncated };
}

export function formatContextResult(result: ContextResult): string {
  const lines: string[] = [];

  // Group by file for readability
  const byFile = new Map<string, ContextEntry[]>();
  for (const entry of result.entries) {
    const arr = byFile.get(entry.filePath) ?? [];
    arr.push(entry);
    byFile.set(entry.filePath, arr);
  }

  for (const [filePath, fileEntries] of byFile) {
    lines.push(`\n# ${filePath}`);
    for (const entry of fileEntries) {
      lines.push(entry.content);
    }
  }

  if (result.truncated) {
    lines.push(`\n# [nexus: context truncated — ${result.totalTokens}/${result.budget} tokens used]`);
  }

  return lines.join('\n');
}
