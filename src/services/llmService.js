'use strict';

const OpenAI = require('openai');
const store = require('../store');

/**
 * Build an OpenAI client for the given provider id.
 * Falls back to env vars when no provider is configured.
 */
function buildClient(providerId) {
  let baseURL, apiKey;

  if (providerId) {
    const provider = store.getLLMProvider(providerId);
    if (!provider) throw new Error(`LLM provider "${providerId}" not found`);
    baseURL = provider.baseURL || undefined;
    apiKey = provider.apiKey || 'not-set';
  } else {
    // Fall back to environment variables
    baseURL = process.env.OPENAI_BASE_URL || undefined;
    apiKey = process.env.OPENAI_API_KEY || 'not-set';
  }

  return new OpenAI({ apiKey, baseURL });
}

/**
 * Stream a chat completion.
 * @param {Object} opts
 * @param {string} opts.providerId
 * @param {string} opts.model
 * @param {Array}  opts.messages
 * @param {Array}  [opts.tools]
 * @param {Object} [opts.options]   extra params (temperature, max_tokens, …)
 * @param {function} opts.onChunk  called for each text delta (string)
 * @param {function} opts.onDone   called with final message object
 */
async function streamCompletion({ providerId, model, messages, tools, options = {}, onChunk, onDone }) {
  const client = buildClient(providerId);

  const params = {
    model,
    messages,
    stream: true,
    ...options,
  };

  if (tools && tools.length > 0) {
    params.tools = tools;
    params.tool_choice = 'auto';
  }

  const stream = await client.chat.completions.create(params);

  let fullContent = '';
  let toolCallsMap = {};  // index -> {id, type, function: {name, arguments}}

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    // Text delta
    if (delta.content) {
      fullContent += delta.content;
      onChunk && onChunk(delta.content);
    }

    // Tool call deltas
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallsMap[idx]) {
          toolCallsMap[idx] = { id: tc.id || '', type: tc.type || 'function', function: { name: '', arguments: '' } };
        }
        if (tc.id) toolCallsMap[idx].id = tc.id;
        if (tc.function?.name) toolCallsMap[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  const toolCalls = Object.values(toolCallsMap);

  onDone && onDone({
    role: 'assistant',
    content: fullContent || null,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  });
}

/**
 * Non-streaming completion (used for tool result follow-ups internally).
 */
async function complete({ providerId, model, messages, tools, options = {} }) {
  const client = buildClient(providerId);
  const params = { model, messages, ...options };
  if (tools && tools.length > 0) {
    params.tools = tools;
    params.tool_choice = 'auto';
  }
  const resp = await client.chat.completions.create(params);
  return resp.choices[0].message;
}

module.exports = { streamCompletion, complete, buildClient };
