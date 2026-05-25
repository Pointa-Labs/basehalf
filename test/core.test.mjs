// SPDX-License-Identifier: Apache-2.0
// These tests double as an executable spec of the architecture:
// events are the truth, every change is attributed, and everything is reversible.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKb } from '../src/core/index.mjs';

const freshKb = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-test-'));
  return { kb: createKb(dir), dir };
};

test('add creates a note you can get and list', () => {
  const { kb } = freshKb();
  const { id } = kb.add({ text: 'we chose Postgres' });
  assert.equal(kb.get(id).text, 'we chose Postgres');
  assert.equal(kb.list().length, 1);
});

test('search finds by text and returns sources (grounding)', () => {
  const { kb } = freshKb();
  kb.add({ text: 'we chose Postgres for reliability', source: 'decision-log.md' });
  const results = kb.search('postgres');
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].sources, ['decision-log.md']);
});

test('provenance: every change records who made it', () => {
  const { kb } = freshKb();
  const { id } = kb.add({ text: 'note', actor: 'agent' });
  assert.equal(kb.get(id).createdBy, 'agent');
});

test('move updates a canvas position', () => {
  const { kb } = freshKb();
  const { id } = kb.add({ text: 'box', type: 'canvas', x: 0, y: 0 });
  kb.move({ id, x: 300, y: 120, actor: 'agent' });
  const n = kb.get(id);
  assert.equal(n.x, 300);
  assert.equal(n.y, 120);
});

test('undo by eventId reverts a single change', () => {
  const { kb } = freshKb();
  const { id } = kb.add({ text: 'box', type: 'canvas', x: 0, y: 0 });
  const { eventId } = kb.move({ id, x: 300, y: 120 });
  kb.undo({ target: eventId });
  assert.equal(kb.get(id).x, 0); // back to the original position
});

test('undo by commandId reverts a whole action (note + its source)', () => {
  const { kb } = freshKb();
  const { commandId } = kb.add({ text: 'temp', source: 's.md' });
  assert.equal(kb.list().length, 1);
  kb.undo({ target: commandId });
  assert.equal(kb.list().length, 0); // the create AND the source link are gone
});

test('delete is a recoverable tombstone', () => {
  const { kb } = freshKb();
  const { id } = kb.add({ text: 'bye' });
  kb.remove({ id });
  assert.equal(kb.list().length, 0);
  assert.equal(kb.list({ includeDeleted: true }).length, 1);
  assert.ok(kb.get(id).deletedAt != null);
});

test('the ledger is the source of truth: a fresh instance recomputes the same state', () => {
  const { kb, dir } = freshKb();
  const { id } = kb.add({ text: 'a' });
  kb.edit({ id, text: 'b' });
  const kb2 = createKb(dir); // brand new instance, same store
  assert.equal(kb2.get(id).text, 'b');
  assert.ok(kb2.log().length >= 2);
});

test('writes refuse to touch a missing or deleted item', () => {
  const { kb } = freshKb();
  assert.throws(() => kb.edit({ id: 'n_nope', text: 'x' }), /no such item/);
  const { id } = kb.add({ text: 'x' });
  kb.remove({ id });
  assert.throws(() => kb.edit({ id, text: 'y' }), /deleted/);
});
