'use strict';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const store = require('../store');

// Cache of connected MCP clients by server id
const clientCache = new Map();

async function getOrConnectClient(serverId) {
  if (clientCache.has(serverId)) {
    return clientCache.get(serverId);
  }

  const server = store.getMCPServer(serverId);
  if (!server) throw new Error(`MCP server "${serverId}" not found`);
  if (!server.enabled) throw new Error(`MCP server "${server.name}" is disabled`);

  const client = new Client({ name: 'HiDestina', version: '1.0.0' });

  // Build transport options with optional Bearer token auth
  const transportOpts = {};
  if (server.authToken) {
    // Sanitize token to prevent header injection (strip CR/LF characters)
    const safeToken = server.authToken.replace(/[\r\n]/g, '');
    const headers = { Authorization: `Bearer ${safeToken}` };
    transportOpts.requestInit = { headers };
    transportOpts.eventSourceInit = { headers };
  }

  // Try Streamable HTTP first, fall back to SSE
  let transport;
  try {
    transport = new StreamableHTTPClientTransport(new URL(server.url), transportOpts);
    await client.connect(transport);
  } catch {
    try {
      transport = new SSEClientTransport(new URL(server.url), transportOpts);
      await client.connect(transport);
    } catch (err) {
      throw new Error(`Cannot connect to MCP server "${server.name}": ${err.message}`);
    }
  }

  clientCache.set(serverId, client);

  // Remove client from cache if connection drops
  client.onclose = () => clientCache.delete(serverId);

  return client;
}

function disconnectClient(serverId) {
  const client = clientCache.get(serverId);
  if (client) {
    client.close().catch(() => {});
    clientCache.delete(serverId);
  }
}

/**
 * List tools from a single MCP server.
 * Updates the persisted tool list in the store.
 */
async function listTools(serverId) {
  const client = await getOrConnectClient(serverId);
  const { tools } = await client.listTools();

  // Persist tool definitions in the store for reference
  store.updateMCPServer(serverId, { tools });

  return tools;
}

/**
 * Call a tool on a specific MCP server.
 */
async function callTool(serverId, toolName, args) {
  const client = await getOrConnectClient(serverId);
  const result = await client.callTool({ name: toolName, arguments: args });
  return result;
}

/**
 * Gather all tools from all enabled MCP servers, formatted for the OpenAI tool format.
 * Returns { openaiTools, toolToServer } where toolToServer maps tool name -> server id.
 */
async function getAllEnabledTools() {
  const servers = store.listMCPServers().filter((s) => s.enabled);
  const openaiTools = [];
  const toolToServer = {};

  await Promise.allSettled(
    servers.map(async (server) => {
      try {
        const tools = await listTools(server.id);
        for (const tool of tools) {
          const qualifiedName = `${server.id}__${tool.name}`;
          toolToServer[qualifiedName] = { serverId: server.id, toolName: tool.name };
          openaiTools.push({
            type: 'function',
            function: {
              name: qualifiedName,
              description: tool.description || '',
              parameters: tool.inputSchema || { type: 'object', properties: {} },
            },
          });
        }
      } catch {
        // Skip unreachable servers
      }
    })
  );

  return { openaiTools, toolToServer };
}

/**
 * Execute a tool call returned by the LLM.
 * The tool name is in format `serverId__toolName`.
 */
async function executeToolCall(qualifiedName, argsJson, toolToServer) {
  const mapping = toolToServer[qualifiedName];
  if (!mapping) {
    return { error: `Unknown tool: ${qualifiedName}` };
  }

  let args;
  try {
    args = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson;
  } catch {
    args = {};
  }

  try {
    const result = await callTool(mapping.serverId, mapping.toolName, args);
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = {
  listTools,
  callTool,
  getAllEnabledTools,
  executeToolCall,
  disconnectClient,
};
