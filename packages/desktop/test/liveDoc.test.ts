import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type LiveDocView,
  __resetSharedDocs,
  acquireDoc,
  claimSeed,
  docKeyFor,
  ensureDoc,
  isOwner,
  markReady,
  onReady,
  refreshOwner,
  releaseDoc,
} from '../src/workbench/services/editor/browser/liveDoc.js';

// A fake view recording owner-role changes. `key` is the (workspace-scoped) doc key.
function fakeView(key: string, ownerPriority?: () => number) {
  let owner = false;
  const view: LiveDocView = {
    key,
    ...(ownerPriority ? { ownerPriority } : {}),
    setOwner: (o) => {
      owner = o;
    },
  };
  return { view, isOwner: () => owner };
}

afterEach(() => {
  __resetSharedDocs();
  vi.useRealTimers();
});

describe('liveDoc — per-file shared Y.Doc registry', () => {
  it('ensureDoc returns the SAME doc for a file (one shared document)', () => {
    const a = ensureDoc('x.md');
    const b = ensureDoc('x.md');
    expect(b).toBe(a);
    expect(ensureDoc('y.md')).not.toBe(a); // different file → different doc
  });

  it('the first acquirer becomes the owner; later views bind but do not steal it', () => {
    const a = fakeView('x.md');
    const b = fakeView('x.md');
    const sharedA = acquireDoc(a.view);
    const sharedB = acquireDoc(b.view);
    expect(sharedB).toBe(sharedA); // same shared doc
    expect(a.isOwner()).toBe(true);
    expect(b.isOwner()).toBe(false);
    expect(isOwner(a.view)).toBe(true);
    expect(sharedA.views.size).toBe(2);
  });

  it('higher-priority editors take ownership from read-only preview surfaces', () => {
    const passive = fakeView('x.md', () => 0);
    const editor = fakeView('x.md');
    acquireDoc(passive.view);
    expect(passive.isOwner()).toBe(true); // preview still watches disk when alone
    acquireDoc(editor.view);
    expect(passive.isOwner()).toBe(false);
    expect(editor.isOwner()).toBe(true);
    expect(isOwner(editor.view)).toBe(true);
  });

  it('refreshOwner rebalances when a canvas card toggles between preview and edit', () => {
    let priority = 0;
    const card = fakeView('x.md', () => priority);
    const panel = fakeView('x.md');
    acquireDoc(card.view);
    acquireDoc(panel.view);
    expect(card.isOwner()).toBe(false);
    expect(panel.isOwner()).toBe(true);

    releaseDoc(panel.view);
    expect(card.isOwner()).toBe(true);

    const otherPanel = fakeView('x.md');
    acquireDoc(otherPanel.view);
    expect(card.isOwner()).toBe(false);
    expect(otherPanel.isOwner()).toBe(true);

    priority = 1;
    refreshOwner(card.view);
    expect(card.isOwner()).toBe(false); // equal priority does not steal
    expect(otherPanel.isOwner()).toBe(true);

    releaseDoc(otherPanel.view);
    expect(card.isOwner()).toBe(true);
  });

  it('claimSeed returns true exactly once (no double-seed across concurrent mounts)', () => {
    const a = fakeView('x.md');
    const b = fakeView('x.md');
    acquireDoc(a.view);
    acquireDoc(b.view);
    expect(claimSeed(a.view)).toBe(true);
    expect(claimSeed(b.view)).toBe(false);
    expect(claimSeed(a.view)).toBe(false);
  });

  it('releasing the owner hands the role to a surviving view', () => {
    const a = fakeView('x.md');
    const b = fakeView('x.md');
    acquireDoc(a.view);
    acquireDoc(b.view);
    releaseDoc(a.view); // owner leaves
    expect(isOwner(b.view)).toBe(true);
    expect(b.isOwner()).toBe(true);
  });

  it('shared save state survives an owner handoff (byId/frontmatter/lastDisk)', () => {
    const a = fakeView('x.md');
    const b = fakeView('x.md');
    const shared = acquireDoc(a.view);
    acquireDoc(b.view);
    // The seeder populates the shared state…
    shared.frontmatter = '---\nt: 1\n---\n';
    shared.byId.set('blk1', { key: 'k', raw: 'r', prefix: '', sep: '\n\n' });
    shared.lastDisk = 'DISK';
    releaseDoc(a.view); // …then the seeder leaves — state must remain for the new owner.
    const still = ensureDoc('x.md');
    expect(still.frontmatter).toBe('---\nt: 1\n---\n');
    expect(still.byId.get('blk1')?.raw).toBe('r');
    expect(still.lastDisk).toBe('DISK');
  });

  it('the same relative path in DIFFERENT workspaces is two separate docs', () => {
    const kA = docKeyFor('workspaceA', 'notes.md');
    const kB = docKeyFor('workspaceB', 'notes.md');
    expect(kA).not.toBe(kB);
    const a = ensureDoc(kA);
    const b = ensureDoc(kB);
    expect(b).not.toBe(a); // no cross-workspace leak onto one shared doc
    // …and the same key resolves to the same doc.
    expect(ensureDoc(docKeyFor('workspaceA', 'notes.md'))).toBe(a);
  });

  it('a synchronous release→acquire (StrictMode remount) keeps the doc alive', () => {
    vi.useFakeTimers();
    const a = fakeView('x.md');
    const doc1 = acquireDoc(a.view).doc;
    releaseDoc(a.view); // schedules grace-destroy (setTimeout 0)
    const doc2 = acquireDoc(a.view).doc; // re-acquire BEFORE the timer fires
    vi.runAllTimers();
    expect(doc2).toBe(doc1); // same doc — not destroyed
    expect(acquireDoc(a.view).doc).toBe(doc1);
  });

  it('onReady waits for markReady (then fires immediately for late subscribers)', () => {
    const a = fakeView('x.md');
    acquireDoc(a.view);
    let fired = 0;
    onReady(a.view, () => {
      fired++;
    });
    expect(fired).toBe(0); // seed not applied yet → editor stays non-editable
    markReady(a.view);
    expect(fired).toBe(1); // applied → waiter fires
    // a view that joins AFTER the seed is ready becomes editable immediately
    let late = 0;
    onReady(a.view, () => {
      late++;
    });
    expect(late).toBe(1);
  });

  it('the last real release destroys the doc after the grace tick', () => {
    vi.useFakeTimers();
    const a = fakeView('x.md');
    const doc1 = acquireDoc(a.view).doc;
    releaseDoc(a.view);
    vi.runAllTimers(); // grace elapses, no re-acquire
    const doc2 = ensureDoc('x.md').doc; // a fresh doc (the old was disposed + dropped)
    expect(doc2).not.toBe(doc1);
  });
});
