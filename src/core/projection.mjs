// SPDX-License-Identifier: Apache-2.0
// The PROJECTION.
//
// Fold the event log into "current state" — the picture you read on screen.
// Projections are derived and disposable: throw it away and recompute it from
// the ledger at any time. The ledger (events.mjs) is the truth; this is a cache.

export function project(events) {
  // 1) Which events were undone? `undo` appends an EventReverted marker rather
  //    than deleting anything, so history stays intact.
  const reverted = new Set();
  for (const e of events) {
    if (e.type === 'EventReverted') reverted.add(e.payload.targetEventId);
  }

  // 2) Replay the surviving events, in order, into a map of notes.
  const notes = new Map();
  for (const e of events) {
    if (e.type === 'EventReverted') continue; // a marker, not a fact about notes
    if (reverted.has(e.eventId)) continue; // this fact was undone
    apply(notes, e);
  }
  return { notes };
}

function apply(notes, e) {
  const p = e.payload;
  switch (e.type) {
    case 'NoteCreated':
      notes.set(p.id, {
        id: p.id,
        type: p.type || 'note',
        text: p.text || '',
        x: p.x ?? null,
        y: p.y ?? null,
        sources: [],
        createdBy: e.actor,
        createdAt: e.ts,
        updatedBy: e.actor,
        updatedAt: e.ts,
        deletedAt: null,
        deletedBy: null,
      });
      break;
    case 'NoteEdited':
      touch(notes, p.id, e, (n) => { n.text = p.text; });
      break;
    case 'NoteMoved':
      touch(notes, p.id, e, (n) => { n.x = p.x; n.y = p.y; });
      break;
    case 'SourceLinked':
      touch(notes, p.id, e, (n) => { n.sources.push(p.source); });
      break;
    case 'NoteDeleted':
      touch(notes, p.id, e, (n) => { n.deletedAt = e.ts; n.deletedBy = e.actor; });
      break;
    default:
      break; // unknown event types are ignored (forward-compatible)
  }
}

function touch(notes, id, e, mutate) {
  const n = notes.get(id);
  if (!n) return; // the note may have been undone/never created; ignore safely
  mutate(n);
  n.updatedBy = e.actor;
  n.updatedAt = e.ts;
}
