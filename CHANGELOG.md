# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-05-09

### Improved
- Indexer now prints progress every 50 files during both parse and edge-resolution phases — no more silent waits on large codebases
- Indexing summary now shows how many files were skipped (node_modules, dist, .git, etc.)

### Fixed
- CLI `index` and `server` commands now catch errors and print a clear message instead of crashing with an unhandled rejection
- Indexer now properly closes the database handle after completing

## [0.1.0] - 2026-05-04

### Added
- Initial release of Nexus-Graph
- Symbol graph indexer for Python, TypeScript, and JavaScript via tree-sitter
- SQLite-backed graph database (`NexusDB`) for storing symbols and edges
- Token-budgeted context retrieval engine for AI coding assistants
- MCP (Model Context Protocol) server for Claude and other AI tools
- CLI commands: `index`, `server`, `viz`
- Graph traversal and scoring (`createSession`, `scoreNodes`)
- File watcher for incremental re-indexing (`chokidar`)
- Express-based visualization server

[0.1.0]: https://github.com/AKhileshPothuri/Nexus-Graph/releases/tag/v0.1.0
