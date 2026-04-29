#!/usr/bin/env node
import * as path from 'path';
import * as os from 'os';
import { runViz } from './generate';

const args = process.argv.slice(2);
let projectRoot = process.cwd();
let dbPath: string | null = null;
let outputPath: string | null = null;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--project' || args[i] === '-p') && args[i + 1]) {
    projectRoot = path.resolve(args[++i]);
  } else if (args[i] === '--db' && args[i + 1]) {
    dbPath = path.resolve(args[++i]);
  } else if ((args[i] === '--out' || args[i] === '-o') && args[i + 1]) {
    outputPath = path.resolve(args[++i]);
  }
}

dbPath     = dbPath     ?? path.join(projectRoot, '.nexus', 'graph.db');
outputPath = outputPath ?? path.join(os.tmpdir(), 'nexus-graph.html');

runViz(projectRoot, dbPath, outputPath);
