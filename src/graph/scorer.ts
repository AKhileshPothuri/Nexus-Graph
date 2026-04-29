import { TraversalNode } from './traversal';

export interface ScoringWeights {
  recency: number;       // 0-1, default 0.4
  proximity: number;     // 0-1, default 0.3
  editFrequency: number; // 0-1, default 0.2
  semanticSim: number;   // 0-1, default 0.1
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  recency: 0.4,
  proximity: 0.3,
  editFrequency: 0.2,
  semanticSim: 0.1,
};

export interface SessionState {
  recentFiles: Map<string, number>;   // file_path → last access timestamp
  editCounts: Map<string, number>;    // file_path → edit count this session
}

export function createSession(): SessionState {
  return { recentFiles: new Map(), editCounts: new Map() };
}

export function recordFileAccess(session: SessionState, filePath: string): void {
  session.recentFiles.set(filePath, Date.now());
  session.editCounts.set(filePath, (session.editCounts.get(filePath) ?? 0) + 1);
}

function proximityScore(distance: number): number {
  // distance 0 → 1.0, distance 1 → 0.8, distance 2 → 0.5, distance 3 → 0.2, beyond → 0
  const decay = [1.0, 0.8, 0.5, 0.2];
  return decay[distance] ?? 0;
}

function recencyScore(session: SessionState, filePath: string): number {
  const lastAccess = session.recentFiles.get(filePath);
  if (!lastAccess) return 0;
  const ageMs = Date.now() - lastAccess;
  const ageMins = ageMs / 60_000;
  // Decays from 1.0 at 0 minutes to 0.0 at 60 minutes
  return Math.max(0, 1 - ageMins / 60);
}

function editFrequencyScore(session: SessionState, filePath: string, maxEdits: number): number {
  const count = session.editCounts.get(filePath) ?? 0;
  if (maxEdits === 0) return 0;
  return Math.min(count / maxEdits, 1);
}

export interface ScoredNode extends TraversalNode {
  score: number;
}

export function scoreNodes(
  nodes: TraversalNode[],
  session: SessionState,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): ScoredNode[] {
  const maxEdits = Math.max(...Array.from(session.editCounts.values()), 1);

  return nodes.map(node => {
    const recency   = recencyScore(session, node.symbol.file_path);
    const proximity = proximityScore(node.distance);
    const editFreq  = editFrequencyScore(session, node.symbol.file_path, maxEdits);
    // semantic similarity is optional (v1: skip, contribute 0)
    const semantic  = 0;

    const score =
      weights.recency       * recency   +
      weights.proximity     * proximity +
      weights.editFrequency * editFreq  +
      weights.semanticSim   * semantic;

    return { ...node, score };
  }).sort((a, b) => b.score - a.score);
}
