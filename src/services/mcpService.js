'use strict';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const store = require('../store');

// Cache of connected MCP clients by server id
const clientCache = new Map();
const MAX_TOOL_NAME_LENGTH = 64;

function sanitizeToolNameSegment(value, fallback) {
  const sanitized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || fallback;
}

function uniquifyToolName(baseName, usedNames) {
  let candidate = baseName.slice(0, MAX_TOOL_NAME_LENGTH);
  let suffix = 1;

  while (usedNames.has(candidate)) {
    const dedupeSuffix = `_${suffix++}`;
    candidate = `${baseName.slice(0, MAX_TOOL_NAME_LENGTH - dedupeSuffix.length)}${dedupeSuffix}`;
  }

  usedNames.add(candidate);
  return candidate;
}

function buildServerAliasSegment(server) {
  const serverSegment = sanitizeToolNameSegment(server.name, 'server');
  const serverIdSegment = String(server.id || '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 8) || 'server';

  return `${serverSegment}_${serverIdSegment}`;
}

function buildQualifiedToolName(server, tool, toolIndex, usedNames) {
  const toolSegment = sanitizeToolNameSegment(tool.name, `tool_${toolIndex + 1}`);
  const baseName = `mcp_${buildServerAliasSegment(server)}_${toolSegment}`;
  return uniquifyToolName(baseName, usedNames);
}

function buildMcpUrlCandidates(rawUrl) {
  const candidates = new Set();

  if (!rawUrl || typeof rawUrl !== 'string') {
    return [];
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) return [];

  try {
    const url = new URL(trimmed);
    candidates.add(url.toString());

    const normalizedBase = url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
    const fallbackBase = normalizedBase.replace(/\/(sse|mcp|messages)$/i, '');

    for (const candidatePath of ['', '/mcp', '/messages']) {
      const candidate = new URL(`${fallbackBase}${candidatePath}`);
      candidate.search = url.search;
      candidate.hash = url.hash;
      candidates.add(candidate.toString());
    }

    // Also try the host root if the user entered a base URL instead of a transport endpoint.
    const hostRoot = new URL(url.origin);
    hostRoot.search = url.search;
    hostRoot.hash = url.hash;
    candidates.add(hostRoot.toString());
  } catch {
    // Keep the original raw value so callers can see the exact input that failed.
    candidates.add(trimmed);
  }

  return [...candidates];
}

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
    transportOpts.requestInit = {
      headers: { Authorization: `Bearer ${safeToken}` },
    };
  }

  const urlCandidates = buildMcpUrlCandidates(server.url);
  const failures = [];

  for (const candidateUrl of urlCandidates) {
    try {
      const url = new URL(candidateUrl);
      const transport = new StreamableHTTPClientTransport(url, transportOpts);
      await client.connect(transport);
      clientCache.set(serverId, client);
      client.onclose = () => clientCache.delete(serverId);
      return client;
    } catch (err) {
      failures.push(`streamable:${candidateUrl} -> ${err && err.message ? err.message : String(err)}`);
    }
  }

  const details = failures.length ? failures.slice(0, 5).join('; ') : 'No transport attempts were made';
  throw new Error(`Cannot connect to MCP server "${server.name}". Tried: ${details}`);
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
 * Gather all tools from enabled MCP servers, formatted for chat-completions tool calling.
 * If serverIds is provided (array), only those servers are used; otherwise all enabled servers.
 * Returns { openaiTools, toolToServer } where toolToServer maps tool name -> { serverId, toolName }.
 */
async function getAllEnabledTools(serverIds) {
  let servers;
  if (Array.isArray(serverIds)) {
    servers = serverIds
      .map((id) => store.getMCPServer(id))
      .filter((s) => s && s.enabled);
  } else {
    servers = store.listMCPServers().filter((s) => s.enabled);
  }
  const openaiTools = [];
  const toolToServer = {};
  const usedToolNames = new Set();

  const toolResults = await Promise.allSettled(
    servers.map(async (server) => ({ server, tools: await listTools(server.id) }))
  );

  for (const result of toolResults) {
    if (result.status !== 'fulfilled') {
      continue;
    }

    const { server, tools } = result.value;
    for (const [toolIndex, tool] of tools.entries()) {
      const qualifiedName = buildQualifiedToolName(server, tool, toolIndex, usedToolNames);
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
  }

  return { openaiTools, toolToServer };
}

/**
 * Execute a tool call returned by the LLM.
 * The tool name is a provider-safe alias generated for the current request.
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
