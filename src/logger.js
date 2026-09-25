'use strict';

const ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || (ENV === 'production' ? 'info' : 'debug');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LEVELS[LOG_LEVEL] || LEVELS.info;

function timestamp() {
  return new Date().toISOString().slice(11, 23);
}

function colorize(level) {
  const colors = {
    debug: '\x1b[36m',  // cyan
    info: '\x1b[32m',   // green
    warn: '\x1b[33m',   // yellow
    error: '\x1b[31m',  // red
    reset: '\x1b[0m',
  };
  return colors[level] || colors.reset;
}

function format(level, context, message, data) {
  const color = colorize(level);
  const reset = colorize('reset');
  const levelStr = level.toUpperCase().padEnd(5);
  const contextStr = context ? `[${context}]` : '';
  
  let output = `${color}${timestamp()} ${levelStr}${reset} ${contextStr}`;
  if (message) output += ` ${message}`;
  
  return output;
}

const logger = {
  debug(context, message, data) {
    if (CURRENT_LEVEL <= LEVELS.debug) {
      const log = format('debug', context, message, data);
      console.log(log, data || '');
    }
  },

  info(context, message, data) {
    if (CURRENT_LEVEL <= LEVELS.info) {
      const log = format('info', context, message, data);
      console.log(log, data || '');
    }
  },

  warn(context, message, data) {
    if (CURRENT_LEVEL <= LEVELS.warn) {
      const log = format('warn', context, message, data);
      console.warn(log, data || '');
    }
  },

  error(context, message, data) {
    if (CURRENT_LEVEL <= LEVELS.error) {
      const log = format('error', context, message, data);
      console.error(log, data || '');
    }
  },

  // Specialized logging for tools
  tools(toolNames) {
    if (CURRENT_LEVEL <= LEVELS.info) {
      const names = Array.isArray(toolNames) ? toolNames : [toolNames];
      const output = format('info', 'TOOLS', `enabled [${names.length}]`);
      if (names.length > 0) {
        console.log(output);
        names.forEach((name) => console.log(`  → ${name}`));
      }
    }
  },

  // Specialized logging for tool calls
  toolCall(toolName, args) {
    if (CURRENT_LEVEL <= LEVELS.debug) {
      const output = format('debug', 'TOOL', `calling`);
      console.log(output);
      console.log(`  name: ${toolName}`);
      if (args) {
        const argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
        const lines = argsStr.split('\n').slice(0, 5); // Limit to 5 lines
        console.log(`  args: ${lines.join('\n        ')}`);
        if (argsStr.split('\n').length > 5) console.log(`        ...`);
      }
    }
  },

  // Specialized logging for tool results
  toolResult(toolName, result, success = true) {
    if (CURRENT_LEVEL <= LEVELS.debug) {
      const status = success ? '✓' : '✗';
      const output = format('debug', 'TOOL', `result ${status}`);
      console.log(output);
      console.log(`  name: ${toolName}`);
      if (result) {
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        const lines = resultStr.split('\n').slice(0, 3); // Limit to 3 lines
        console.log(`  result: ${lines.join('\n          ')}`);
        if (resultStr.split('\n').length > 3) console.log(`          ...`);
      }
    }
  },

  // Specialized logging for API requests/responses
  api(method, path, statusOrMessage) {
    if (CURRENT_LEVEL <= LEVELS.info) {
      const output = format('info', 'API', `${method.padEnd(6)} ${path}`);
      console.log(output, statusOrMessage || '');
    }
  },
};

module.exports = logger;
