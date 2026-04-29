import * as fs from 'fs';
import { Symbol } from '../indexer/db';

export type FormatMode = 'full' | 'definition' | 'summary';

/**
 * Format a symbol for inclusion in context.
 *
 * full       — include the exact source lines from file
 * definition — include only the signature line
 * summary    — one-line symbol description
 */
export function formatSymbol(sym: Symbol, mode: FormatMode): string {
  switch (mode) {
    case 'full': {
      const body = readLines(sym.file_path, sym.start_line, sym.end_line);
      if (!body) return formatSymbol(sym, 'definition');
      return `## ${sym.symbol_name} (${sym.symbol_type}) — ${sym.file_path}:${sym.start_line}\n\`\`\`python\n${body}\n\`\`\``;
    }
    case 'definition':
      return `## ${sym.symbol_name} — ${sym.file_path}:${sym.start_line}\n\`\`\`python\n${sym.signature}\n\`\`\``;
    case 'summary':
      return `- **${sym.symbol_name}** (${sym.symbol_type}) @ ${sym.file_path}:${sym.start_line}`;
  }
}

function readLines(filePath: string, startLine: number, endLine: number): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    // Convert 1-based to 0-based index
    return lines.slice(startLine - 1, endLine).join('\n');
  } catch {
    return null;
  }
}
