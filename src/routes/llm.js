'use strict';

const { Router } = require('express');
const store = require('../store');
const { listModels } = require('../services/llmService');

const router = Router();

// GET /api/llm
router.get('/', (req, res) => {
  // Mask API keys in the response
  const providers = store.listLLMProviders().map((p) => ({
    ...p,
    apiKey: p.apiKey ? '***' : '',
  }));
  res.json(providers);
});

// POST /api/llm
router.post('/', (req, res) => {
  const { name, baseURL, apiKey, model, description } = req.body || {};
  if (!name || !baseURL) {
    return res.status(400).json({ error: 'name and baseURL are required' });
  }
  const provider = store.createLLMProvider({ name, baseURL, apiKey, model, description });
  res.status(201).json({ ...provider, apiKey: provider.apiKey ? '***' : '' });
});

// GET /api/llm/:id
router.get('/:id', (req, res) => {
  const provider = store.getLLMProvider(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Not found' });
  res.json({ ...provider, apiKey: provider.apiKey ? '***' : '' });
});

// GET /api/llm/:id/models — fetch available models from the provider
router.get('/:id/models', async (req, res) => {
  const providerId = req.params.id === 'default' ? null : req.params.id;
  if (providerId) {
    const provider = store.getLLMProvider(providerId);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
  }
  try {
    const models = await listModels(providerId);
    res.json(models);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: `Failed to fetch models: ${err.message}` });
  }
});

// PATCH /api/llm/:id
router.patch('/:id', (req, res) => {
  const updated = store.updateLLMProvider(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json({ ...updated, apiKey: updated.apiKey ? '***' : '' });
});

// DELETE /api/llm/:id
router.delete('/:id', (req, res) => {
  const ok = store.deleteLLMProvider(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

module.exports = router;
