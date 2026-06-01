import { type XmlFragment, Doc as YDoc } from 'yjs';
import type { ReuseEntry } from './mdSegment.js';

/**
 * Per-file shared document registry — the in-memory "document model".
 *
 * The same file open in several views (canvas float + panel tabs/splits) binds to
 * ONE shared Yjs document, so edits sync live + character-level across every view:
 * both editable, no divergence, never a self-conflict. The Y.Doc is purely
 * in-memory — seeded from disk on first open, saved back via the byte-verbatim
 * splice-save, disposed on last close — so the FILE stays the source of truth. (It
 * is also collaboration-ready: this Y.Doc is exactly the unit a future sync layer
 * would share between devices/users.)
 *
 * Why the per-file SAVE state (frontmatter, the id-keyed reuse index, last-known
 * disk bytes) lives HERE and not per-view: the reuse index is keyed by the seeded
 * block ids — which only the shared doc knows — so a second view couldn't rebuild
 * it from disk. One view is the OWNER (runs autosave + the watcher + the conflict
 * gate); ownership hands off when the owner unmounts. All views stay editable.
 */

export interface LiveDocView {
  readonly file: string;
  /** Become (true) the OWNER — the single view that runs autosave + the file
   *  watcher + the conflict gate. (All views are editable; the owner just owns
   *  persistence.) Only ever called with `true`: a leaving owner is unmounting, and
   *  ownership only moves on unmount. */
  setOwner(isOwner: boolean): void;
}

export interface SharedDoc {
  readonly file: string;
  readonly doc: YDoc;
  readonly fragment: XmlFragment;
  /** Live views bound to this doc. */
  views: Set<LiveDocView>;
  /** The single owner (saver / watcher), or null between owners. */
  owner: LiveDocView | null;
  /** Has a view seeded this doc from disk yet? Claimed synchronously (claimSeed)
   *  so a concurrent mount — e.g. StrictMode's double effect — can't double-seed. */
  seeded: boolean;
  /** Per-file save state, shared across views. */
  frontmatter: string;
  byId: Map<string, ReuseEntry>;
  lastDisk: string;
  /** Pending grace-destroy timer — tolerates StrictMode's synchronous
   *  unmount→remount (the remount's acquire cancels it). */
  destroyTimer: ReturnType<typeof setTimeout> | null;
}

const docs = new Map<string, SharedDoc>();

/** Get-or-create a file's shared doc WITHOUT taking a hold — render-safe (idempotent
 *  across StrictMode's double render). `useCreateBlockNote` binds to `.fragment`;
 *  the hold (acquire/release) is taken in the mount effect. */
export function ensureDoc(file: string): SharedDoc {
  let shared = docs.get(file);
  if (!shared) {
    const doc = new YDoc();
    shared = {
      file,
      doc,
      fragment: doc.getXmlFragment('bn'),
      views: new Set(),
      owner: null,
      seeded: false,
      frontmatter: '',
      byId: new Map(),
      lastDisk: '',
      destroyTimer: null,
    };
    docs.set(file, shared);
  }
  return shared;
}

/** Take a hold (mount): add the view, claim the owner role if it's vacant, and
 *  cancel any pending grace-destroy. Pair with releaseDoc in the effect cleanup. */
export function acquireDoc(view: LiveDocView): SharedDoc {
  const shared = ensureDoc(view.file);
  if (shared.destroyTimer) {
    clearTimeout(shared.destroyTimer);
    shared.destroyTimer = null;
  }
  shared.views.add(view);
  if (!shared.owner) {
    shared.owner = view;
    view.setOwner(true);
  }
  return shared;
}

/** Drop a hold (unmount): hand the owner role to a survivor, and schedule a
 *  grace-destroy when the last view leaves (a synchronous re-acquire — StrictMode's
 *  remount — cancels it before it fires). */
export function releaseDoc(view: LiveDocView): void {
  const shared = docs.get(view.file);
  if (!shared) return;
  shared.views.delete(view);
  if (shared.owner === view) {
    const next = shared.views.values().next().value as LiveDocView | undefined;
    shared.owner = next ?? null;
    if (next) next.setOwner(true);
  }
  if (shared.views.size === 0 && !shared.destroyTimer) {
    shared.destroyTimer = setTimeout(() => {
      docs.delete(view.file);
      shared.doc.destroy();
    }, 0);
  }
}

/** Atomically claim the right to seed this file's doc from disk — returns true for
 *  exactly ONE caller (the first), false thereafter, so concurrent mounts of the
 *  same file never double-seed. */
export function claimSeed(view: LiveDocView): boolean {
  const shared = docs.get(view.file);
  if (!shared || shared.seeded) return false;
  shared.seeded = true;
  return true;
}

export function isOwner(view: LiveDocView): boolean {
  return docs.get(view.file)?.owner === view;
}

/** Test-only: drop all docs + timers. */
export function __resetSharedDocs(): void {
  for (const s of docs.values()) {
    if (s.destroyTimer) clearTimeout(s.destroyTimer);
    s.doc.destroy();
  }
  docs.clear();
}
