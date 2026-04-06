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

  const { message, files, providerId, model: reqModel, useTools = true, enabledMcpServers, enabledSkills, options = {} } = req.body || {};
  const model = reqModel || conv.model || '';
  const effectiveProviderId = providerId || conv.providerId || undefined;
  if ((!message && (!files || files.length === 0)) || !model) {
    return res.status(400).json({ error: 'message (or files) and model are required' });
  }

  // Validate and sanitise attached files
  const validFiles = [];
  const rejectedFiles = [];
  if (Array.isArray(files)) {
    for (const f of files) {
      if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') {
        continue;
      }
      if (f.content.length > 1024 * 1024) {
        rejectedFiles.push(f.name);
        continue;
      }
      validFiles.push({ name: f.name.slice(0, 255), content: f.content });
    }
    if (rejectedFiles.length > 0) {
      console.warn(`Rejected files exceeding size limit: ${rejectedFiles.join(', ')}`);
    }
  }

  // Persist model/provider on the conversation so UI can display it
  const convUpdates = {};
  if (model && model !== conv.model) convUpdates.model = model;
  if (effectiveProviderId && effectiveProviderId !== conv.providerId) convUpdates.providerId = effectiveProviderId;
  if (enabledMcpServers !== undefined) {
    const prev = conv.enabledMcpServers;
    const changed = enabledMcpServers === null !== (prev === null || prev === undefined) ||
      (Array.isArray(enabledMcpServers) && Array.isArray(prev) &&
        (enabledMcpServers.length !== prev.length || enabledMcpServers.some((id, i) => id !== prev[i])));
    if (changed) convUpdates.enabledMcpServers = enabledMcpServers;
  }
  if (enabledSkills !== undefined) {
    const prev = conv.enabledSkills;
    const changed = (enabledSkills === null) !== (prev === null || prev === undefined) ||
      (Array.isArray(enabledSkills) && Array.isArray(prev) &&
        (enabledSkills.length !== prev.length || enabledSkills.some((id, i) => id !== prev[i])));
    if (changed) convUpdates.enabledSkills = enabledSkills;
  }
  if (Object.keys(convUpdates).length > 0) {
    store.updateConversation(conversationId, convUpdates);
  }

  // Persist the user message (store file metadata, not full content, to keep store lean)
  const filesMeta = validFiles.length > 0 ? validFiles.map((f) => ({ name: f.name })) : undefined;
  store.addMessage(conversationId, { role: 'user', content: message || '', files: filesMeta });

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
      const msg = {
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      };
      if (m.toolCalls) msg.tool_calls = m.toolCalls;
      if (m.toolCallId) msg.tool_call_id = m.toolCallId;
      if (m.name) msg.name = m.name;
      return msg;
    });

    // Inject file content into the last user message for the LLM
    if (validFiles.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const fileBlocks = validFiles.map(
        (f) => `[File: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``
      ).join('\n\n');
      const userText = lastMsg.content || '';
      lastMsg.content = fileBlocks + (userText ? '\n\n' + userText : '');
    }

    // Get MCP tools if requested
    let openaiTools = [];
    let toolToServer = {};
    // Determine which MCP servers to use: per-conversation selection or all enabled
    const effectiveMcpServers = Array.isArray(enabledMcpServers) ? enabledMcpServers : conv.enabledMcpServers;
    if (useTools) {
      try {
        ({ openaiTools, toolToServer } = await mcpService.getAllEnabledTools(
          Array.isArray(effectiveMcpServers) ? effectiveMcpServers : undefined
        ));
      } catch {
        // Tools unavailable, continue without them
      }
    }

    // Inject skill instructions from standalone skills collection
    const effectiveSkills = Array.isArray(enabledSkills) ? enabledSkills : conv.enabledSkills;
    const selectedSkillIds = Array.isArray(effectiveSkills) ? effectiveSkills : null;
    const activeSkills = store.listSkills().filter((s) => {
      if (!s.enabled || !s.content) return false;
      if (selectedSkillIds) return selectedSkillIds.includes(s.id);
      return true;
    });
    if (activeSkills.length > 0) {
      const skillContent = activeSkills
        .map((s) => `## ${s.name}\n\n${s.content}`)
        .join('\n\n---\n\n');
      messages.unshift({
        role: 'system',
        content: `The following are skill instructions:\n\n${skillContent}`,
      });
    }

    let assistantMessage = null;

    // Agentic loop: allow multiple tool call rounds
    const MAX_ROUNDS = 10;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let done = false;

      await llmService.streamCompletion({
        providerId: effectiveProviderId,
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
      const assistantContent = typeof assistantMessage.content === 'string' ? assistantMessage.content : '';
      assistantMessage.content = assistantContent;

      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls → final answer
        store.addMessage(conversationId, {
          role: 'assistant',
          content: assistantContent,
        });
        send({ type: 'done', message: assistantMessage });
        break;
      }

      // Persist assistant message with tool calls
      store.addMessage(conversationId, {
        role: 'assistant',
        content: assistantContent,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      messages.push({
        role: 'assistant',
        content: assistantContent,
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
