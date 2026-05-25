// SPDX-License-Identifier: Apache-2.0
// The CORE — "the one door".
//
// This is the only place knowledge changes. Users (via the CLI) and agents (via
// the CLI or the MCP adapter) all call these same functions. Each WRITE turns an
// intent into one or more events on the ledger; each READ computes an answer from
// the ledger. The CLI and the MCP server are thin skins over this file — the
// logic lives here exactly once.

import { randomUUID } from 'node:crypto';
import { openStore, appendEvent, readEvents } from './events.mjs';
import { project } from './projection.mjs';

const genId = (prefix) => prefix + randomUUID().slice(0, 8);

export function createKb(baseDir = process.env.KB_DIR || process.cwd()) {
  const store = openStore(baseDir);
  const state = () => project(readEvents(store));

  function requireNote(id) {
    const n = state().notes.get(id);
    if (!n) throw new Error(`no such item: ${id}`);
    if (n.deletedAt) throw new Error(`item is deleted: ${id}`);
    return n;
  }

  // ---- WRITES (the hands; every change becomes a recorded event) ----

  function add({ text, source, type = 'note', x = null, y = null, actor = 'user' } = {}) {
    if (!text || !String(text).trim()) throw new Error('add: text is required');
    const id = genId('n_');
    const commandId = genId('c_');
    appendEvent(store, { type: 'NoteCreated', payload: { id, text: String(text), type, x, y }, actor, commandId });
    if (source) {
      appendEvent(store, { type: 'SourceLinked', payload: { id, source: String(source) }, actor, commandId });
    }
    return { id, commandId };
  }

  function edit({ id, text, actor = 'user' } = {}) {
    requireNote(id);
    if (text == null) throw new Error('edit: text is required');
    const commandId = genId('c_');
    const ev = appendEvent(store, { type: 'NoteEdited', payload: { id, text: String(text) }, actor, commandId });
    return { id, eventId: ev.eventId, commandId };
  }

  function move({ id, x, y, actor = 'user' } = {}) {
    requireNote(id);
    if (x == null || y == null) throw new Error('move: x and y are required');
    const commandId = genId('c_');
    const ev = appendEvent(store, { type: 'NoteMoved', payload: { id, x: Number(x), y: Number(y) }, actor, commandId });
    return { id, eventId: ev.eventId, commandId };
  }

  function link({ id, source, actor = 'user' } = {}) {
    requireNote(id);
    if (!source) throw new Error('link: source is required');
    const commandId = genId('c_');
    const ev = appendEvent(store, { type: 'SourceLinked', payload: { id, source: String(source) }, actor, commandId });
    return { id, eventId: ev.eventId, commandId };
  }

  function remove({ id, actor = 'user' } = {}) {
    requireNote(id);
    const commandId = genId('c_');
    const ev = appendEvent(store, { type: 'NoteDeleted', payload: { id }, actor, commandId });
    return { id, eventId: ev.eventId, commandId };
  }

  // Undo never destroys history — it appends a revert marker. Pass an eventId to
  // undo one change, or a commandId to undo a whole action (e.g. a whole agent run).
  function undo({ target, actor = 'user' } = {}) {
    if (!target) throw new Error('undo: an eventId or commandId is required');
    const events = readEvents(store);
    const toRevert = events.filter(
      (e) => e.type !== 'EventReverted' && (e.eventId === target || e.commandId === target),
    );
    if (toRevert.length === 0) throw new Error(`undo: nothing matches ${target}`);
    const commandId = genId('c_');
    const reverted = [];
    for (const e of toRevert) {
      appendEvent(store, { type: 'EventReverted', payload: { targetEventId: e.eventId }, actor, commandId });
      reverted.push(e.eventId);
    }
    return { reverted, commandId };
  }

  // ---- READS (the eyes) ----

  function get(id) {
    return state().notes.get(id) || null;
  }

  function list({ includeDeleted = false } = {}) {
    return [...state().notes.values()].filter((n) => includeDeleted || !n.deletedAt);
  }

  function search(query) {
    const q = String(query || '').toLowerCase();
    return [...state().notes.values()]
      .filter((n) => !n.deletedAt && n.text.toLowerCase().includes(q))
      .map((n) => ({ id: n.id, text: n.text, sources: n.sources }));
  }

  // Grounded context an agent pulls before it starts a task. Same as search,
  // framed as a bundle — and answers always carry their sources.
  function context(query) {
    return { query: String(query || ''), results: search(query) };
  }

  // ---- THE LEDGER (history / audit) ----

  function log({ limit } = {}) {
    const events = readEvents(store);
    const reverted = new Set();
    for (const e of events) if (e.type === 'EventReverted') reverted.add(e.payload.targetEventId);
    const annotated = events.map((e) => ({ ...e, reverted: reverted.has(e.eventId) }));
    return limit ? annotated.slice(-Number(limit)) : annotated;
  }

  return { storePath: store.path, add, edit, move, link, remove, undo, get, list, search, context, log };
}
