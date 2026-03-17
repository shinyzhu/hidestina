'use strict';

const { Router } = require('express');
const store = require('../store');
const llmService = require('../services/llmService');
const mcpService = require('../services/mcpService');

const router = Router();

/**
 * POST /api/chat/:conversationId
 *
 * Body: { message, providerId, model, useTools, options }
 *
 * Streams back Server-Sent Events:
 *   data: {"type":"delta","content":"..."}
 *   data: {"type":"tool_call","toolCall":{...}}
 *   data: {"type":"tool_result","toolCall":{...},"result":{...}}
 *   data: {"type":"done","message":{...}}
 *   data: {"type":"error","error":"..."}
 */
router.post('/:conversationId', async (req, res) => {
  const { conversationId } = req.params;
  const conv = store.getConversation(conversationId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const { message, providerId, model, useTools = true, options = {} } = req.body || {};
  if (!message || !model) {
    return res.status(400).json({ error: 'message and model are required' });
  }

  // Persist the user message
  store.addMessage(conversationId, { role: 'user', content: message });

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  try {
    // Build message history
    const messages = conv.messages.map((m) => {
      const msg = { role: m.role, content: m.content };
      if (m.toolCalls) msg.tool_calls = m.toolCalls;
      if (m.toolCallId) msg.tool_call_id = m.toolCallId;
      if (m.name) msg.name = m.name;
      return msg;
    });

    // Get MCP tools if requested
    let openaiTools = [];
    let toolToServer = {};
    if (useTools) {
      try {
        ({ openaiTools, toolToServer } = await mcpService.getAllEnabledTools());
      } catch {
        // Tools unavailable, continue without them
      }
    }

    let assistantMessage = null;

    // Agentic loop: allow multiple tool call rounds
    const MAX_ROUNDS = 10;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let done = false;

      await llmService.streamCompletion({
        providerId,
        model,
        messages,
        tools: openaiTools,
        options,
        onChunk: (text) => send({ type: 'delta', content: text }),
        onDone: (msg) => {
          assistantMessage = msg;
          done = true;
        },
      });

      if (!done) break;

      const { toolCalls } = assistantMessage;

      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls → final answer
        store.addMessage(conversationId, {
          role: 'assistant',
          content: assistantMessage.content,
        });
        send({ type: 'done', message: assistantMessage });
        break;
      }

      // Persist assistant message with tool calls
      store.addMessage(conversationId, {
        role: 'assistant',
        content: assistantMessage.content,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      messages.push({
        role: 'assistant',
        content: assistantMessage.content,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      // Send tool call events and execute them
      for (const tc of toolCalls) {
        send({ type: 'tool_call', toolCall: { id: tc.id, name: tc.function.name, arguments: tc.function.arguments } });

        const result = await mcpService.executeToolCall(
          tc.function.name,
          tc.function.arguments,
          toolToServer
        );

        send({ type: 'tool_result', toolCallId: tc.id, result });

        const toolResultContent = typeof result === 'string' ? result : JSON.stringify(result);

        // Persist tool result message
        store.addMessage(conversationId, {
          role: 'tool',
          content: toolResultContent,
          toolCallId: tc.id,
          name: tc.function.name,
        });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: toolResultContent,
        });
      }

      // Reset streaming state for next round
      assistantMessage = null;
      send({ type: 'delta', content: '' }); // separator
    }
  } catch (err) {
    send({ type: 'error', error: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
