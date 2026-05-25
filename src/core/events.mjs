// SPDX-License-Identifier: Apache-2.0
// The LEDGER.
//
// This append-only log of events is the single source of truth. Everything you
// see in the app is *computed* from these events (see projection.mjs). We never
// edit or delete a past event — to undo, we append a revert marker. This is what
// makes an agent's changes auditable and reversible.
//
// Storage here is a plain JSONL file so the reference impl runs with zero
// dependencies. The production target swaps this for SQLite — the rest of the
// code does not change, because nothing else knows how events are stored.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function openStore(baseDir) {
  return { path: join(baseDir, '.bh', 'events.jsonl') };
}

// Append one fact to the ledger. `commandId` ties together all events produced
// by a single action (so a whole action can be undone as one unit).
export function appendEvent(store, { type, payload, actor, commandId }) {
  const event = {
    eventId: 'e_' + randomUUID().slice(0, 8),
    type,
    payload,
    actor: actor || 'user',
    commandId: commandId || 'c_' + randomUUID().slice(0, 8),
    ts: new Date().toISOString(),
  };
  mkdirSync(dirname(store.path), { recursive: true });
  appendFileSync(store.path, JSON.stringify(event) + '\n');
  return event;
}

export function readEvents(store) {
  if (!existsSync(store.path)) return [];
  return readFileSync(store.path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}
