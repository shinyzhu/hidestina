'use strict';

const { Router } = require('express');
const store = require('../store');

const router = Router();

// GET /api/conversations
router.get('/', (req, res) => {
  res.json(store.listConversations());
});

// POST /api/conversations
router.post('/', (req, res) => {
  const { title, model } = req.body || {};
  const conv = store.createConversation({ title, model });
  res.status(201).json(conv);
});

// GET /api/conversations/:id
router.get('/:id', (req, res) => {
  const conv = store.getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  res.json(conv);
});

// PATCH /api/conversations/:id
router.patch('/:id', (req, res) => {
  const updated = store.updateConversation(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// DELETE /api/conversations/:id
router.delete('/:id', (req, res) => {
  const ok = store.deleteConversation(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

module.exports = router;
