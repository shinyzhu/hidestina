'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const rateLimit = require('express-rate-limit');

const conversationsRouter = require('./routes/conversations');
const chatRouter = require('./routes/chat');
const llmRouter = require('./routes/llm');
const mcpRouter = require('./routes/mcp');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Rate limiting ─────────────────────────────────────────────────────────────

// General API limiter — 300 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Stricter limiter for chat completions (calls external LLM APIs)
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Chat rate limit exceeded, please slow down.' },
});

// Static file limiter
const staticLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/conversations', apiLimiter, conversationsRouter);
app.use('/api/chat', chatLimiter, chatRouter);
app.use('/api/llm', apiLimiter, llmRouter);
app.use('/api/mcp', apiLimiter, mcpRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// ── Config (env-based defaults) ───────────────────────────────────────────────
app.get('/api/config', apiLimiter, (req, res) => {
  res.json({
    defaultModel: process.env.MODEL_NAME || '',
  });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('/{*path}', staticLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🦆 vduck running at http://localhost:${PORT}`);
});

module.exports = app;
