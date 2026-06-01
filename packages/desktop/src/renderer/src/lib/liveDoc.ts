/**
 * Live shared document across views of the SAME file.
 *
 * The same file can be open in more than one editor at once — the canvas float
 * plus a right-panel tab, or two panel splits. Without coordination those are
 * independent editors that only reconcile through disk + the watcher (a ~1s lag,
 * and a conflict if both are edited at once). This bus makes them ONE logical
 * document instead:
 *
 *   - one WRITER per file (the most-recently-focused view) is editable and
 *     autosaves; every other view is a live, read-only MIRROR;
 *   - the writer BROADCASTS each save to the mirrors, which adopt it instantly
 *     (no disk round-trip) — so the views never drift apart;
 *   - a newly-joining view ADOPTS the current writer's live content (including
 *     unsaved edits), so opening a second view never shows a stale copy.
 *
 * Single-writer is deliberate: it means two views of one file can never be edited
 * at the same instant, so they can never self-conflict — and the editable view
 * stays a plain BlockNote editor, leaving the byte-verbatim splice-save untouched
 * (the reason we don't route the document through a CRDT). Clicking a mirror makes
 * it the writer (see claimWriter), so "read-only" is never a dead end.
 */

export interface LiveDocView {
  readonly file: string;
  /** Become (true) / stop being (false) the writer — toggles this view's editor
   *  editability. The bus calls this when the writer changes. */
  setWriter(isWriter: boolean): void;
  /** This view's CURRENT content as markdown (the live document serialized,
   *  including unsaved edits) — a joining view adopts this instead of stale disk.
   *  Must never reject; fall back to the last-known disk bytes on failure. */
  getContent(): Promise<string>;
  /** Adopt content the writer broadcast (or that was fetched on join): replace the
   *  body + reset the disk baseline, with no disk read. */
  adopt(md: string): Promise<void>;
  /** Persist pending edits now — used before this view yields the writer role so
   *  an edit isn't stranded in a view about to go read-only. */
  flush(): Promise<void>;
}

const viewsByFile = new Map<string, Set<LiveDocView>>();
const writerByFile = new Map<string, LiveDocView>();

/** Add a view to its file's set (does NOT change the writer — call claimWriter
 *  once the view has loaded). Returns an unregister fn that removes it and, if it
 *  was the writer, hands the role to a remaining view. */
export function registerView(view: LiveDocView): () => void {
  let set = viewsByFile.get(view.file);
  if (!set) {
    set = new Set();
    viewsByFile.set(view.file, set);
  }
  set.add(view);
  return () => {
    const s = viewsByFile.get(view.file);
    if (!s) return;
    s.delete(view);
    if (writerByFile.get(view.file) === view) {
      writerByFile.delete(view.file);
      const next = s.values().next().value as LiveDocView | undefined;
      if (next) claimWriter(next); // hand the writer role to a survivor
    }
    if (s.size === 0) viewsByFile.delete(view.file);
  };
}

/** Make `view` the sole writer for its file; every other view of that file goes
 *  read-only. The outgoing writer flushes first so no pending edit is stranded. */
export function claimWriter(view: LiveDocView): void {
  const set = viewsByFile.get(view.file);
  if (!set || !set.has(view)) return;
  const prev = writerByFile.get(view.file);
  if (prev === view) return; // already the writer → nothing to do
  writerByFile.set(view.file, view);
  for (const v of set) v.setWriter(v === view);
  if (prev) void prev.flush(); // persist the outgoing writer's edits before it locks
}

/** The current writer for a file (a joining view adopts its live content). */
export function currentWriter(file: string): LiveDocView | undefined {
  return writerByFile.get(file);
}

/** Is any view of this file already live? (The first view loads from disk; a
 *  later one adopts the writer's live content instead.) */
export function hasLiveDoc(file: string): boolean {
  return (viewsByFile.get(file)?.size ?? 0) > 0;
}

/** The writer broadcasts content it just saved → every OTHER view adopts it. */
export function broadcast(writer: LiveDocView, md: string): void {
  const set = viewsByFile.get(writer.file);
  if (!set) return;
  for (const v of set) {
    if (v !== writer) void v.adopt(md);
  }
}

/** Test-only: drop all registered views + writers. */
export function __resetLiveDoc(): void {
  viewsByFile.clear();
  writerByFile.clear();
}
