# Nexus — Setup Guide

## Build

```bash
npm install
npm run build
```

## Add to Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": [
        "/Users/pothak3/Documents/Code_Graph/dist/mcp/server.js",
        "--project", "/path/to/your/python/project",
        "--watch"
      ]
    }
  }
}
```

Replace `/path/to/your/python/project` with your actual project root.

## Available MCP Tools

| Tool | When to use |
|------|-------------|
| `get_context_for_query` | Ask "what's the checkout flow?" — returns relevant code within token budget |
| `get_symbol_context` | Know the symbol name, want its full dependency graph |
| `search_symbols` | Find where a function/class is defined |
| `apply_edit_and_update_graph` | After editing a file, keep the graph fresh |
| `get_graph_stats` | Check index status |

## Options

```
--project, -p   Path to Python project root (default: cwd)
--db            Path to SQLite DB (default: <project>/.nexus/graph.db)
--watch, -w     Watch for file changes and auto-reindex
```
