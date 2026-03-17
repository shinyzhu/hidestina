'use strict';

const { Router } = require('express');
const store = require('../store');
const mcpService = require('../services/mcpService');

const router = Router();

// GET /api/mcp
router.get('/', (req, res) => {
  res.json(store.listMCPServers());
});

// POST /api/mcp
router.post('/', (req, res) => {
  const { name, url, description, enabled } = req.body || {};
  if (!name || !url) {
    return res.status(400).json({ error: 'name and url are required' });
  }
  const server = store.createMCPServer({ name, url, description, enabled });
  res.status(201).json(server);
});

// GET /api/mcp/:id
router.get('/:id', (req, res) => {
  const server = store.getMCPServer(req.params.id);
  if (!server) return res.status(404).json({ error: 'Not found' });
  res.json(server);
});

// PATCH /api/mcp/:id
router.patch('/:id', (req, res) => {
  const updated = store.updateMCPServer(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.status(200).json(updated);
});

// DELETE /api/mcp/:id
router.delete('/:id', (req, res) => {
  mcpService.disconnectClient(req.params.id);
  const ok = store.deleteMCPServer(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

// POST /api/mcp/:id/refresh — probe the server and refresh its tool list
router.post('/:id/refresh', async (req, res) => {
  try {
    const tools = await mcpService.listTools(req.params.id);
    res.json({ tools });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
