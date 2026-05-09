#!/usr/bin/env node
import { Command } from 'commander';
import { runIndexer } from '../indexer/indexFile';
import { startMCPServer } from '../mcp/server';
import { runViz } from '../viz/generate';
import * as path from 'path';
import * as os from 'os';

const program = new Command();

program
  .name('nexus-graph')
  .description('Nexus-Graph: High-fidelity code graph context engine for AI')
  .version('0.1.1');

program
  .command('index')
  .description('Index the project symbols and build the graph')
  .option('-p, --project <path>', 'Path to the project root', '.')
  .action(async (options: { project: string }) => {
    console.log(`🔍 Scanning project at: ${options.project}`);
    await runIndexer(options.project).catch((err: Error) => {
      console.error(`[nexus] indexing failed: ${err.message}`);
      process.exit(1);
    });
  });

program
  .command('server')
  .description('Start the Nexus MCP Server')
  .option('-p, --project <path>', 'Path to the indexed project', '.')
  .option('--port <number>', 'Port to run the server on', '3000')
  .action((options: { project: string; port: string }) => {
    console.log(`🚀 Starting Nexus MCP Server on port ${options.port}`);
    Promise.resolve(startMCPServer(options.project, parseInt(options.port))).catch((err: Error) => {
      console.error(`[nexus] server failed to start: ${err.message}`);
      process.exit(1);
    });
  });

program
  .command('viz')
  .description('Launch the local graph visualization')
  .option('-p, --project <path>', 'Path to the project root', '.')
  .action((options: { project: string }) => {
    console.log('📊 Launching Nexus-Graph visualizer...');
    const projectRoot = path.resolve(options.project);
    const dbPath = path.join(projectRoot, '.nexus', 'graph.db');
    const outputPath = path.join(os.tmpdir(), 'nexus-graph.html');
    runViz(projectRoot, dbPath, outputPath);
  });

program.parse(process.argv);
