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
 * Keyed by a WORKSPACE-SCOPED key (`<workspace>\0<relpath>`), not the bare relative
 * path: two workspaces can hold the same relative path (`notes.md`), and keying by
 * path alone would share ONE doc between them — leaking one root's content into the
 * other and writing edits to the wrong file.
 *
 * Why the per-file SAVE state (frontmatter, the id-keyed reuse index, last-known
 * disk bytes) lives HERE and not per-view: the reuse index is keyed by the seeded
 * block ids — which only the shared doc knows — so a second view couldn't rebuild
 * it from disk. One view is the OWNER (runs autosave + the watcher + the conflict
 * gate); editable views have priority, while read-only canvas previews can own
 * only as a fallback so they still refresh from disk when no editor is open.
 */

export interface LiveDocView {
  /** The workspace-scoped registry key (NOT the relative path) — see module note. */
  readonly key: string;
  /** Higher priority wins persistence/watch ownership. Panel editors and active
   *  canvas editors use the default 1; read-only canvas preview surfaces use 0 so
   *  they can refresh from disk when alone but yield as soon as an editor appears. */
  ownerPriority?(): number;
  /** Become (true) the OWNER — the single view that runs autosave + the file
   *  watcher + the conflict gate. Called with `false` when a higher-priority view
   *  takes over or this owner unmounts. */
  setOwner(isOwner: boolean): void;
}

export interface SharedDoc {
  readonly key: string;
  readonly doc: YDoc;
  readonly fragment: XmlFragment;
  /** Live views bound to this doc. */
  views: Set<LiveDocView>;
  /** The single owner (saver / watcher), or null between owners. */
  owner: LiveDocView | null;
  /** Has a view seeded this doc from disk yet? Claimed synchronously (claimSeed)
   *  so a concurrent mount — e.g. StrictMode's double effect — can't double-seed. */
  seeded: boolean;
  /** True once the seeder's disk content has actually been APPLIED to the doc (not
   *  merely claimed). Views stay non-editable until then, so a fast joiner can't
   *  type into the still-empty doc and have its edits overwritten when the async
   *  seed lands. */
  ready: boolean;
  readyWaiters: Set<() => void>;
  /** Set by a "Discard & close" on a write-failure when OTHER views are open: the
   *  failed edits live in this shared doc, so the next owner reloads from disk to
   *  drop them everywhere (else a sibling would keep showing unsaved content that a
   *  later no-op flush silently loses). */
  discardRequested: boolean;
  /** Per-file save state, shared across views. */
  frontmatter: string;
  byId: Map<string, ReuseEntry>;
  lastDisk: string;
  /** Pending grace-destroy timer — tolerates StrictMode's synchronous
   *  unmount→remount (the remount's acquire cancels it). */
  destroyTimer: ReturnType<typeof setTimeout> | null;
}

const docs = new Map<string, SharedDoc>();

function priorityOf(view: LiveDocView): number {
  return view.ownerPriority?.() ?? 1;
}

function bestOwner(shared: SharedDoc): LiveDocView | null {
  let best: LiveDocView | null = null;
  let bestPriority = Number.NEGATIVE_INFINITY;
  for (const view of shared.views) {
    const priority = priorityOf(view);
    if (priority > bestPriority) {
      best = view;
      bestPriority = priority;
    }
  }
  if (shared.owner && shared.views.has(shared.owner) && priorityOf(shared.owner) === bestPriority) {
    return shared.owner;
  }
  return best;
}

function assignOwner(shared: SharedDoc, next: LiveDocView | null): void {
  const prev = shared.owner;
  if (prev === next) return;
  shared.owner = next;
  if (prev) prev.setOwner(false);
  if (next) next.setOwner(true);
}

function rebalanceOwner(shared: SharedDoc): void {
  assignOwner(shared, bestOwner(shared));
}

/** Get-or-create a shared doc for a (scoped) key WITHOUT taking a hold — render-safe
 *  (idempotent across StrictMode's double render). `useCreateBlockNote` binds to
 *  `.fragment`; the hold (acquire/release) is taken in the mount effect. */
export function ensureDoc(key: string): SharedDoc {
  let shared = docs.get(key);
  if (!shared) {
    const doc = new YDoc();
    shared = {
      key,
      doc,
      fragment: doc.getXmlFragment('bn'),
      views: new Set(),
      owner: null,
      seeded: false,
      ready: false,
      readyWaiters: new Set(),
      discardRequested: false,
      frontmatter: '',
      byId: new Map(),
      lastDisk: '',
      destroyTimer: null,
    };
    docs.set(key, shared);
  }
  return shared;
}

/** Take a hold (mount): add the view, rebalance owner priority, and cancel any
 *  pending grace-destroy. Pair with releaseDoc in the effect cleanup. */
export function acquireDoc(view: LiveDocView): SharedDoc {
  const shared = ensureDoc(view.key);
  if (shared.destroyTimer) {
    clearTimeout(shared.destroyTimer);
    shared.destroyTimer = null;
  }
  shared.views.add(view);
  rebalanceOwner(shared);
  return shared;
}

/** Drop a hold (unmount): hand the owner role to a survivor, and schedule a
 *  grace-destroy when the last view leaves (a synchronous re-acquire — StrictMode's
 *  remount — cancels it before it fires). */
export function releaseDoc(view: LiveDocView): void {
  const shared = docs.get(view.key);
  if (!shared) return;
  shared.views.delete(view);
  if (shared.owner === view) {
    assignOwner(shared, bestOwner(shared));
  }
  if (shared.views.size === 0 && !shared.destroyTimer) {
    shared.destroyTimer = setTimeout(() => {
      docs.delete(view.key);
      shared.doc.destroy();
    }, 0);
  }
}

/** Atomically claim the right to seed this doc from disk — returns true for exactly
 *  ONE caller (the first), false thereafter, so concurrent mounts of the same key
 *  never double-seed. */
export function claimSeed(view: LiveDocView): boolean {
  const shared = docs.get(view.key);
  if (!shared || shared.seeded) return false;
  shared.seeded = true;
  return true;
}

export function isOwner(view: LiveDocView): boolean {
  return docs.get(view.key)?.owner === view;
}

/** Re-evaluate owner priority for a mounted view. Used when a canvas card flips
 *  between read-only preview (priority 0) and inline edit (priority 1) without
 *  remounting the shared BlockNote document. */
export function refreshOwner(view: LiveDocView): void {
  const shared = docs.get(view.key);
  if (!shared || !shared.views.has(view)) return;
  rebalanceOwner(shared);
}

/** Mark a doc's seed as APPLIED → wake every view waiting to become editable. The
 *  seeder calls this after its disk read + applyContent completes. Ignored if the
 *  view no longer belongs to this doc: the doc may have been destroyed + recreated
 *  under the same key (file closed then reopened) while a STALE seeder's read was
 *  still in flight — it must not mark the fresh doc ready before its own seed lands. */
export function markReady(view: LiveDocView): void {
  const shared = docs.get(view.key);
  if (!shared || shared.ready || !shared.views.has(view)) return;
  shared.ready = true;
  for (const w of shared.readyWaiters) w();
  shared.readyWaiters.clear();
}

/** Run `cb` once the doc's seed is applied (immediately if it already is). Returns
 *  an unsubscribe to drop the waiter on unmount. */
export function onReady(view: LiveDocView, cb: () => void): () => void {
  const shared = docs.get(view.key);
  if (!shared || shared.ready) {
    cb();
    return () => {};
  }
  shared.readyWaiters.add(cb);
  return () => {
    shared.readyWaiters.delete(cb);
  };
}

/** Build the registry key for a file, scoped by the workspace ROOT PATH (not its
 *  name): `repath()` keeps a workspace's name but points it at a new folder, so
 *  keying by name would reuse the OLD folder's doc. The NUL separator can't appear
 *  in a path, so keys never collide. */
export function docKeyFor(workspaceRoot: string | null, file: string): string {
  return `${workspaceRoot ?? ''}${String.fromCharCode(0)}${file}`;
}

/** Test-only: drop all docs + timers. */
export function __resetSharedDocs(): void {
  for (const s of docs.values()) {
    if (s.destroyTimer) clearTimeout(s.destroyTimer);
    s.doc.destroy();
  }
  docs.clear();
}
