// SPDX-License-Identifier: Apache-2.0
// The MCP adapter — a SECOND thin handle over the same core "door".
//
// This exists to make one point concrete: MCP is not a different architecture
// from the CLI. It is another skin over src/core. The actions and the ledger
// live in core/ and are never re-implemented here. Wiring this to the real
// @modelcontextprotocol/sdk is a few lines (see the bottom of this file).
//
// Rule: expose each action as its own typed tool. Never expose a generic
// "run_command" passthrough — that would throw away MCP's per-tool typing and
// per-tool permission prompts, and hand an agent raw shell access.

import { createKb } from './core/index.mjs';

const kb = createKb();

export const tools = [
  { name: 'kb_add', description: 'Add a note. Attach `source` to ground a factual claim.',
    inputSchema: { type: 'object', required: ['text'], properties: {
      text: { type: 'string' }, source: { type: 'string' },
      type: { type: 'string', enum: ['note', 'canvas'] }, x: { type: 'number' }, y: { type: 'number' } } } },
  { name: 'kb_search', description: 'Search notes. Results include their sources.',
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } },
  { name: 'kb_context', description: 'Grounded context bundle for a task.',
    inputSchema: { type: 'object', required: ['task'], properties: { task: { type: 'string' } } } },
  { name: 'kb_get', description: 'Read one item by id.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'kb_list', description: 'List items.',
    inputSchema: { type: 'object', properties: { all: { type: 'boolean' } } } },
  { name: 'kb_edit', description: "Edit an item's text.",
    inputSchema: { type: 'object', required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } } },
  { name: 'kb_move', description: 'Move a canvas item to (x, y).',
    inputSchema: { type: 'object', required: ['id', 'x', 'y'], properties: { id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } } },
  { name: 'kb_link', description: 'Link a source to an item.',
    inputSchema: { type: 'object', required: ['id', 'source'], properties: { id: { type: 'string' }, source: { type: 'string' } } } },
  { name: 'kb_rm', description: 'Soft-delete an item (recoverable).',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'kb_log', description: 'Show the audit history.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'kb_undo', description: 'Undo one change (eventId) or a whole action (commandId).',
    inputSchema: { type: 'object', required: ['target'], properties: { target: { type: 'string' } } } },
];

// Agent writes are tagged actor:'agent', so the ledger always records who acted.
export function handleToolCall(name, args = {}) {
  const actor = 'agent';
  switch (name) {
    case 'kb_add': return kb.add({ ...args, actor });
    case 'kb_search': return kb.search(args.query);
    case 'kb_context': return kb.context(args.task);
    case 'kb_get': return kb.get(args.id);
    case 'kb_list': return kb.list({ includeDeleted: !!args.all });
    case 'kb_edit': return kb.edit({ ...args, actor });
    case 'kb_move': return kb.move({ ...args, actor });
    case 'kb_link': return kb.link({ ...args, actor });
    case 'kb_rm': return kb.remove({ ...args, actor });
    case 'kb_log': return kb.log({ limit: args.limit });
    case 'kb_undo': return kb.undo({ target: args.target, actor });
    default: throw new Error(`unknown tool: ${name}`);
  }
}

/*
Turn this into a real MCP server (after: npm i @modelcontextprotocol/sdk):

  import { Server } from '@modelcontextprotocol/sdk/server/index.js';
  import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
  import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

  const server = new Server({ name: 'kb', version: '0.0.1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => ({
    content: [{ type: 'text', text: JSON.stringify(handleToolCall(req.params.name, req.params.arguments)) }],
  }));
  await server.connect(new StdioServerTransport());

Same core, second handle. The door (writes -> events -> audit) is never duplicated.
*/
