# Logging Guide

This application uses a centralized, structured logging system to track tool usage and application flow.

## Log Levels

Configure via `LOG_LEVEL` environment variable:

```bash
export LOG_LEVEL=debug    # Most verbose (default in development)
export LOG_LEVEL=info     # Default in production
export LOG_LEVEL=warn     # Warnings and errors only
export LOG_LEVEL=error    # Errors only
```

## Log Output Format

```
HH:MM:SS.mmm [LEVEL] [CONTEXT] message data
```

### Examples

```
16:42:33 INFO  [CHAT] started [conv-123]
16:42:34 INFO  [LLM] streamCompletion [model: gpt-4]
16:42:35 INFO  [TOOLS] enabled [3]
  → mcp_web_search_query
  → mcp_web_fetch_url
  → mcp_api_summarize
16:42:36 DEBUG [TOOL] calling
  name: mcp_web_search_query
  args: { q: "AI trends" }
16:42:37 DEBUG [TOOL] result ✓
  name: mcp_web_search_query
  result: [{ title: "AI Trends 2024", ... }]
16:42:38 INFO  [CHAT] completed [conv-123] [no tools]
```

## Tool Name Listing

When a chat request uses tools, the logger displays all enabled tools:

```
[TOOLS] enabled [N]
  → tool_name_1
  → tool_name_2
  → tool_name_3
```

Tool names are qualified with server/provider information:
- Prefix: `mcp_` (Model Context Protocol tools)
- Server name (sanitized)
- Server ID (abbreviated)
- Tool name

## MCP Connection Logs

```
16:42:20 INFO  [MCP] connecting to "Web Search Server"
16:42:21 INFO  [MCP] found 5 tools [server-id]
  search, fetch, parse, extract, rank
16:42:21 INFO  [MCP] connected to "Web Search Server" [server-id]
```

On connection failure:
```
16:42:20 ERROR [MCP] failed to connect to "Web Search Server"
```

## Chat Flow Timeline

```
1. [CHAT] started - Request received
2. [LLM] streamCompletion - LLM call initiated
3. [TOOLS] enabled - Available tools listed
4. [CHAT] executing tool - Tool about to be called
5. [TOOL] calling - Tool invocation details
6. [TOOL] result - Tool execution result
7. [CHAT] completed - Request finished
```

## Colored Output

- **Cyan**: DEBUG
- **Green**: INFO
- **Yellow**: WARN
- **Red**: ERROR

## Debugging

Enable debug logging to see detailed tool information:

```bash
LOG_LEVEL=debug npm start
```

This will show:
- Tool arguments (first 5 lines)
- Tool results (first 3 lines)
- Cache hits/misses
- MCP connection attempts
