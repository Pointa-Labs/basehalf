#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The CLI — one thin handle over the core "door".
//
// Humans type these commands; local coding agents (Claude Code / Codex) run the
// exact same commands. Pass --json from an agent, and --actor agent so the audit
// trail shows who did what. This file only parses arguments and calls core; it
// contains no knowledge logic of its own.

import { parseArgs } from 'node:util';
import { createKb } from './core/index.mjs';

const HELP = `kb — a local, auditable, agent-operable knowledge base (reference impl)

Read (eyes):
  kb search "<query>"            find notes; results carry their sources
  kb context "<task>"            grounded context bundle for an agent
  kb get <id>
  kb list [--all]

Change (hands — recorded & reversible):
  kb add "<text>" [--source <s>] [--type note|canvas] [--x <n> --y <n>]
  kb edit <id> "<new text>"
  kb move <id> --x <n> --y <n>
  kb link <id> --source <s>
  kb rm  <id>                     soft delete (recoverable)

History (the ledger):
  kb log [--limit <n>]
  kb undo <eventId|commandId>     undo one change, or a whole action / agent run

Global flags:
  --json            machine-readable output (use this from agents)
  --actor <who>     who is changing things: user (default) or agent

Store: ./.kb/events.jsonl  (override with KB_DIR=/path). Every change goes through
these commands, so every change is recorded and can be undone.`;

function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      actor: { type: 'string' },
      source: { type: 'string' },
      type: { type: 'string' },
      x: { type: 'string' },
      y: { type: 'string' },
      limit: { type: 'string' },
    },
  });

  const [cmd, ...rest] = positionals;
  const kb = createKb();
  const actor = values.actor || 'user';
  const out = (human, data) => console.log(values.json ? JSON.stringify(data, null, 2) : human);
  const num = (v) => (v != null ? Number(v) : null);

  switch (cmd) {
    case undefined:
    case 'help':
      console.log(HELP);
      return;

    case 'add': {
      const res = kb.add({ text: rest.join(' '), source: values.source, type: values.type, x: num(values.x), y: num(values.y), actor });
      out(`added ${res.id}`, res);
      return;
    }
    case 'edit': {
      const [id, ...textParts] = rest;
      const res = kb.edit({ id, text: textParts.join(' '), actor });
      out(`edited ${id}`, res);
      return;
    }
    case 'move': {
      const res = kb.move({ id: rest[0], x: values.x, y: values.y, actor });
      out(`moved ${rest[0]} -> (${values.x}, ${values.y})`, res);
      return;
    }
    case 'link': {
      const res = kb.link({ id: rest[0], source: values.source, actor });
      out(`linked source to ${rest[0]}`, res);
      return;
    }
    case 'rm': {
      const res = kb.remove({ id: rest[0], actor });
      out(`deleted ${rest[0]} (recoverable: kb undo ${res.eventId})`, res);
      return;
    }
    case 'get': {
      const n = kb.get(rest[0]);
      if (!n) { console.error(`not found: ${rest[0]}`); process.exit(1); }
      out(renderNote(n), n);
      return;
    }
    case 'list': {
      const notes = kb.list({ includeDeleted: values.all });
      out(notes.length ? notes.map(renderNote).join('\n') : '(empty)', notes);
      return;
    }
    case 'search': {
      const results = kb.search(rest.join(' '));
      out(results.length ? results.map(renderResult).join('\n') : '(no matches)', results);
      return;
    }
    case 'context': {
      const bundle = kb.context(rest.join(' '));
      out(bundle.results.length ? bundle.results.map(renderResult).join('\n') : '(no relevant knowledge)', bundle);
      return;
    }
    case 'log': {
      const events = kb.log({ limit: values.limit });
      out(events.length ? events.map(renderEvent).join('\n') : '(no history)', events);
      return;
    }
    case 'undo': {
      const res = kb.undo({ target: rest[0], actor });
      out(`undone ${res.reverted.length} event(s)`, res);
      return;
    }
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.error(HELP);
      process.exit(1);
  }
}

function renderNote(n) {
  const pos = n.x != null ? ` @(${n.x},${n.y})` : '';
  const src = n.sources.length ? `  [src: ${n.sources.join(', ')}]` : '';
  const del = n.deletedAt ? ' (deleted)' : '';
  return `${n.id}${pos}  ${n.text}${src}  <by ${n.createdBy}>${del}`;
}
function renderResult(r) {
  return `${r.id}  ${r.text}  [src: ${r.sources.length ? r.sources.join(', ') : 'none'}]`;
}
function renderEvent(e) {
  return `${e.ts}  ${e.eventId}  ${e.type}  by ${e.actor}  (cmd ${e.commandId})${e.reverted ? '  (reverted)' : ''}`;
}

try {
  main();
} catch (err) {
  console.error('error: ' + err.message);
  process.exit(1);
}
