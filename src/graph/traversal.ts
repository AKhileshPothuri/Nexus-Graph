import { NexusDB, Symbol } from '../indexer/db';

export interface TraversalNode {
  symbol: Symbol;
  distance: number; // graph hops from anchor
}

/**
 * k-step BFS from one or more anchor symbol IDs.
 * Returns all reachable nodes within `maxDepth` hops (inclusive of anchors).
 */
export function bfsTraversal(
  anchorIds: string[],
  db: NexusDB,
  maxDepth = 3,
): TraversalNode[] {
  const visited = new Map<string, TraversalNode>();
  const queue: { id: string; distance: number }[] = anchorIds.map(id => ({ id, distance: 0 }));

  while (queue.length > 0) {
    const { id, distance } = queue.shift()!;
    if (visited.has(id)) continue;

    const sym = db.getSymbolById(id);
    if (!sym) continue;

    visited.set(id, { symbol: sym, distance });

    if (distance < maxDepth) {
      // Outgoing edges (this symbol depends on)
      const outgoing = db.getOutgoingEdges(id);
      for (const { to_id } of outgoing) {
        if (!visited.has(to_id)) {
          queue.push({ id: to_id, distance: distance + 1 });
        }
      }
      // Incoming edges (who depends on this symbol)
      const incoming = db.getIncomingEdges(id);
      for (const { from_id } of incoming) {
        if (!visited.has(from_id)) {
          queue.push({ id: from_id, distance: distance + 1 });
        }
      }
    }
  }

  return Array.from(visited.values());
}

/**
 * Find anchor symbol IDs from a free-text query.
 *
 * Strategy (tries each until results are found):
 * 1. Exact FTS5 match on the full query
 * 2. Each individual word as a separate FTS5 query (union)
 * 3. File-path substring match — useful for "checkout flow", "query routing" etc.
 *    where the concept maps to a filename rather than a symbol name/docstring
 */
export function findAnchors(query: string, db: NexusDB, limit = 5): string[] {
  // 1. Full-phrase search
  const full = db.searchSymbols(query, limit);
  if (full.length > 0) return full.map(s => s.id);

  // 2. Word-by-word search — collect unique IDs, preserve relevance order
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const seen = new Set<string>();
  const byWord: string[] = [];
  for (const word of words) {
    const hits = db.searchSymbols(word, limit);
    for (const s of hits) {
      if (!seen.has(s.id)) { seen.add(s.id); byWord.push(s.id); }
    }
    if (byWord.length >= limit) break;
  }
  if (byWord.length > 0) return byWord.slice(0, limit);

  // 3. File-path keyword match — "query routing" → symbols in files whose path
  //    contains any query word
  const fileMatches = db.searchSymbolsByFilePath(words, limit);
  return fileMatches.map(s => s.id);
}
