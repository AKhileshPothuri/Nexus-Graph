import { watch, FSWatcher } from 'chokidar';
import * as path from 'path';
import { NexusDB } from './db';
import { indexFile } from './indexFile';

export function watchProject(projectRoot: string, db: NexusDB): FSWatcher {
  const watcher = watch('**/*.{py,ts,tsx,js,jsx}', {
    cwd: projectRoot,
    ignored: /(^|[/\\])(\.git|__pycache__|\.venv|venv|node_modules|dist|build)[/\\]/,
    persistent: true,
    ignoreInitial: true,
  });

  watcher
    .on('add', (rel) => {
      const abs = path.join(projectRoot, rel);
      console.error(`[nexus] file added: ${rel}`);
      indexFile(abs, projectRoot, db, new Map());
    })
    .on('change', (rel) => {
      const abs = path.join(projectRoot, rel);
      console.error(`[nexus] file changed: ${rel}`);
      // Delete old symbols for this file then re-index
      db.deleteSymbolsByFile(abs);
      indexFile(abs, projectRoot, db, new Map());
    })
    .on('unlink', (rel) => {
      const abs = path.join(projectRoot, rel);
      console.error(`[nexus] file removed: ${rel}`);
      db.deleteSymbolsByFile(abs);
    });

  return watcher;
}
