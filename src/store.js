'use strict';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) {
    return getDefaultStore();
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return getDefaultStore();
  }
}

function getDefaultStore() {
  return {
    conversations: [],
    llmProviders: [],
    mcpServers: [],
  };
}

let store = loadStore();

function saveStore() {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// ── Conversations ─────────────────────────────────────────────────────────────

function listConversations() {
  return store.conversations
    .map(({ id, title, model, createdAt, updatedAt, messageCount }) => ({
      id,
      title,
      model,
      createdAt,
      updatedAt,
      messageCount,
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getConversation(id) {
  return store.conversations.find((c) => c.id === id) || null;
}

function createConversation({ title = 'New Chat', model = '' } = {}) {
  const now = new Date().toISOString();
  const conv = {
    id: uuidv4(),
    title,
    model,
    messages: [],
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  store.conversations.push(conv);
  saveStore();
  return conv;
}

function updateConversation(id, updates) {
  const conv = store.conversations.find((c) => c.id === id);
  if (!conv) return null;
  Object.assign(conv, updates, { updatedAt: new Date().toISOString() });
  saveStore();
  return conv;
}

function deleteConversation(id) {
  const idx = store.conversations.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  store.conversations.splice(idx, 1);
  saveStore();
  return true;
}

function addMessage(conversationId, { role, content, toolCalls, toolCallId, name }) {
  const conv = store.conversations.find((c) => c.id === conversationId);
  if (!conv) return null;
  const msg = {
    id: uuidv4(),
    role,
    content: content ?? null,
    createdAt: new Date().toISOString(),
  };
  if (toolCalls) msg.toolCalls = toolCalls;
  if (toolCallId) msg.toolCallId = toolCallId;
  if (name) msg.name = name;
  conv.messages.push(msg);
  conv.messageCount = conv.messages.length;
  conv.updatedAt = new Date().toISOString();
  // Auto-title from first user message
  if (conv.messages.filter((m) => m.role === 'user').length === 1 && role === 'user') {
    conv.title = (content || '').slice(0, 60) || 'New Chat';
  }
  saveStore();
  return msg;
}

// ── LLM Providers ─────────────────────────────────────────────────────────────

function listLLMProviders() {
  return store.llmProviders;
}

function getLLMProvider(id) {
  return store.llmProviders.find((p) => p.id === id) || null;
}

function createLLMProvider({ name, baseURL, apiKey = '', defaultModel = '', description = '' }) {
  const provider = {
    id: uuidv4(),
    name,
    baseURL,
    apiKey,
    defaultModel,
    description,
    createdAt: new Date().toISOString(),
  };
  store.llmProviders.push(provider);
  saveStore();
  return provider;
}

function updateLLMProvider(id, updates) {
  const provider = store.llmProviders.find((p) => p.id === id);
  if (!provider) return null;
  Object.assign(provider, updates);
  saveStore();
  return provider;
}

function deleteLLMProvider(id) {
  const idx = store.llmProviders.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  store.llmProviders.splice(idx, 1);
  saveStore();
  return true;
}

// ── MCP Servers ───────────────────────────────────────────────────────────────

function listMCPServers() {
  return store.mcpServers;
}

function getMCPServer(id) {
  return store.mcpServers.find((s) => s.id === id) || null;
}

function createMCPServer({ name, url, description = '', enabled = true, authToken = '' }) {
  const server = {
    id: uuidv4(),
    name,
    url,
    description,
    enabled,
    authToken,
    tools: [],
    createdAt: new Date().toISOString(),
  };
  store.mcpServers.push(server);
  saveStore();
  return server;
}

function updateMCPServer(id, updates) {
  const server = store.mcpServers.find((s) => s.id === id);
  if (!server) return null;
  Object.assign(server, updates);
  saveStore();
  return server;
}

function deleteMCPServer(id) {
  const idx = store.mcpServers.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  store.mcpServers.splice(idx, 1);
  saveStore();
  return true;
}

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  addMessage,
  listLLMProviders,
  getLLMProvider,
  createLLMProvider,
  updateLLMProvider,
  deleteLLMProvider,
  listMCPServers,
  getMCPServer,
  createMCPServer,
  updateMCPServer,
  deleteMCPServer,
};
