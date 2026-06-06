import { join } from 'node:path';
import {
  type Handler,
  assertReadContained,
  createKeyedMutex,
  readMaybeNoFollow,
} from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import {
  focusPath,
  readBriefServedAt,
  readFocusBrief,
  stampBriefServed,
  writeFocus,
} from './store.js';
import type {
  FocusBriefArgs,
  FocusBriefResult,
  FocusClearArgs,
  FocusClearResult,
  FocusGetArgs,
  FocusGetResult,
  FocusInitArgs,
  FocusInitResult,
  FocusItem,
  FocusPruneDanglingArgs,
  FocusPruneDanglingResult,
  FocusReconcileNewFileArgs,
  FocusReconcileNewFileResult,
  FocusRefreshFolderIntentArgs,
  FocusRefreshFolderIntentResult,
  FocusRenameActiveFileArgs,
  FocusRenameActiveFileResult,
  FocusRenameActiveFolderArgs,
  FocusRenameActiveFolderResult,
  FocusResyncArgs,
  FocusResyncResult,
  FocusSetArgs,
  FocusSetIntentArgs,
  FocusSetIntentResult,
  FocusSetResult,
  FocusSource,
  FocusToggleActiveFileArgs,
  FocusToggleActiveFileResult,
} from './types.js';

async function currentWorkspaceRoot(ctx: Parameters<Handler>[1]): Promise<string> {
  const current = await ctx.run<Record<string, never>, WorkspaceCurrentResult>(
    'workspace.current',
    {},
  );
  if (current.current === null) {
    throw new Error('No current workspace; call workspace.use first');
  }
  return current.current.path;
}

// Serialize every WRITE to a workspace's focus.md. focus.resync is a genuine
// read-modify-write (read the active list, re-render with fresh badge data,
// write back), so two concurrent badge edits racing resync could interleave a
// stale read with a fresh write and lose the newer brief. set/clear take the
// same lock so a resync can't clobber a just-issued set (or vice versa). Same
// kernel mutex the inbound index uses for its RMW. [[bh-json-rmw-race]]
const withFocusLock = createKeyedMutex();

/**
 * Assemble the brief items for a desired active list — the SINGLE liveness choke
 * point. Each surviving file inlines its curated MEANING (prompt + outbound
 * ref-notes) so the agent reads the whole brief in one pass instead of re-reading
 * N badge JSONs. Composed via ctx.run only (module isolation); a file with no
 * badge (or a folder) contributes its bare path. Shared by EVERY writer (set /
 * resync / toggle / rename / folder) so they assemble identical, live briefs.
 *
 * Liveness invariant (by construction): a file the badge graph KNOWS is gone —
 * orphan-flagged by the watcher's markOrphan — is EXCLUDED here, so no writer can
 * publish a brief that points at a deleted file. A file with no badge or a
 * non-orphan badge is kept. Disk deletes the graph hasn't flagged yet (app was
 * closed / git checkout) carry no orphan flag, so they're healed on re-entry by
 * focus.pruneDangling (stat-based) instead.
 */
async function assembleItems(
  ctx: Parameters<Handler>[1],
  files: readonly string[],
): Promise<FocusItem[]> {
  const items: FocusItem[] = [];
  for (const file of files) {
    let badge: BadgeGetMinimal | null = null;
    try {
      badge = await ctx.run<{ file: string }, BadgeGetMinimal | null>('badge.get', { file });
    } catch {
      badge = null;
    }
    if (badge?.orphan === true) continue; // known-deleted → never reaches the brief
    const refs = (badge?.references ?? [])
      .filter((r) => r.to)
      .map((r) => ({ to: r.to, ...(r.note !== undefined && r.note !== '' && { note: r.note }) }));
    items.push({
      file,
      ...(badge?.prompt !== undefined && badge.prompt !== '' && { prompt: badge.prompt }),
      ...(refs.length > 0 && { refs }),
    });
  }
  return items;
}

/**
 * Assemble + write a brief through assembleItems (the liveness choke point) in one
 * step, so EVERY writer drops known-deleted (orphan) files identically and reports
 * the drop count for the heal note. Returns the LIVE active set actually written
 * (orphans removed) so callers echo the real result. The one place focus.md is
 * produced from a desired active list — there is no second assembly path.
 */
async function writeBrief(
  ctx: Parameters<Handler>[1],
  root: string,
  files: readonly string[],
  intent: string | undefined,
  source: FocusSource | undefined,
): Promise<string[]> {
  const items = await assembleItems(ctx, files);
  await writeFocus(ctx.fs, root, items, intent, source, files.length - items.length);
  return items.map((i) => i.file);
}

// Minimal shapes for the cross-module reads focus.set composes via ctx.run
// (never imports another module's internals — keeps the dep arrow one-way).
interface BadgeGetMinimal {
  readonly prompt?: string;
  readonly orphan?: boolean;
  readonly references?: readonly { readonly to: string; readonly note?: string }[];
}
interface BadgeListMinimal {
  readonly badges: readonly { readonly file: string }[];
}

/**
 * Gather every supported FILE under a folder — the folder IS the grouping, so
 * its members are derived (no manual selection). Reads the materialized file
 * badges (one per supported file, eagerly created on workspace open) and keeps
 * those whose path sits under the folder prefix, including nested descendants
 * (matching what the canvas shows when scoped into the folder). Sorted for a
 * deterministic brief.
 */
async function filesUnderFolder(
  ctx: Parameters<Handler>[1],
  folder: string,
): Promise<readonly string[]> {
  const prefix = folder.endsWith('/') ? folder : `${folder}/`;
  const { badges } = await ctx.run<{ kind: 'file' }, BadgeListMinimal>('badge.list', {
    kind: 'file',
  });
  return badges
    .map((b) => b.file)
    .filter((f) => f.startsWith(prefix))
    .sort();
}

/** Read a folder badge's prompt — the folder's agent-facing intent. */
async function folderPrompt(
  ctx: Parameters<Handler>[1],
  folder: string,
): Promise<string | undefined> {
  const badge = await ctx.run<{ file: string; kind: 'folder' }, BadgeGetMinimal | null>(
    'badge.get',
    { file: folder, kind: 'folder' },
  );
  return badge?.prompt !== undefined && badge.prompt.trim() !== '' ? badge.prompt : undefined;
}

export const set: Handler<FocusSetArgs, FocusSetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  let files: readonly string[];
  let intent: string | undefined = args.intent;
  let source: FocusSource | undefined;
  if (args.folder !== undefined) {
    // The folder IS the grouping: gather its supported files automatically and
    // carry the folder badge's prompt as the intent — no hand-picked selection.
    files = await filesUnderFolder(ctx, args.folder);
    if (intent === undefined) intent = await folderPrompt(ctx, args.folder);
    // Record provenance ONLY when the intent is folder-DERIVED (no manual
    // override) — so a later prompt edit can refresh this brief by identity, but
    // a hand-set intent override is never auto-clobbered. Recorded even when the
    // folder's prompt is currently blank, so editing it later still refreshes.
    if (args.intent === undefined) source = { kind: 'folder', id: args.folder };
  } else {
    files = args.files ?? [];
  }

  const active = await withFocusLock(root, () => writeBrief(ctx, root, files, intent, source));
  return { active };
};

/**
 * Re-publish focus.md's `intent:` from a FOLDER whose badge prompt just changed.
 * ONLY fires when focus.md's
 * `# source-folder:` provenance is exactly this folder (so a folder-sourced
 * focus's brief stays live as you edit the folder prompt), atomically under the
 * focus lock. The active list is preserved verbatim — only the intent is
 * refreshed to the folder's new prompt, provenance re-stamped.
 */
export const refreshFolderIntent: Handler<
  FocusRefreshFolderIntentArgs,
  FocusRefreshFolderIntentResult
> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, source } = await readFocusBrief(ctx.fs, root);
    if (source?.kind !== 'folder' || source.id !== args.folder) return { refreshed: false };
    const newIntent = await folderPrompt(ctx, args.folder);
    await writeBrief(ctx, root, active, newIntent, { kind: 'folder', id: args.folder });
    return { refreshed: true };
  });
};

/**
 * Remap a renamed file in the active list IN PLACE, preserving the intent AND
 * the `# source-folder:` provenance. badge.rename used to round-trip through the
 * public focus.get/focus.set shapes, which strip provenance — so after renaming
 * a focused file, editing the source folder's prompt stopped refreshing the
 * brief. This keeps the focus live-linked to its source folder across a rename.
 * Atomic under the focus lock; no-op when `from` isn't focused.
 */
export const renameActiveFile: Handler<
  FocusRenameActiveFileArgs,
  FocusRenameActiveFileResult
> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent, source } = await readFocusBrief(ctx.fs, root);
    if (!active.includes(args.from)) return { renamed: false };
    // writeFocus asserts every active path (incl. the new `to`) before writing.
    const next = active.map((f) => (f === args.from ? args.to : f));
    await writeBrief(ctx, root, next, intent, source);
    return { renamed: true };
  });
};

/**
 * Pull a newly-appeared file into a FOLDER-sourced brief. A folder focus's
 * active list is derived once at focus.set({folder}); a file added later would
 * stay out of the brief — breaking "Focus this folder = read all its files" —
 * until a manual refocus. Re-derives the folder's files (so the new one joins)
 * ONLY when focus.md is folder-sourced and `file` is under that folder and not
 * already listed. Intent + provenance preserved. Atomic under the focus lock.
 */
export const reconcileNewFile: Handler<
  FocusReconcileNewFileArgs,
  FocusReconcileNewFileResult
> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent, source } = await readFocusBrief(ctx.fs, root);
    if (source?.kind !== 'folder') return { added: false };
    const prefix = source.id.endsWith('/') ? source.id : `${source.id}/`;
    if (!args.file.startsWith(prefix) || active.includes(args.file)) return { added: false };
    const files = await filesUnderFolder(ctx, source.id);
    await writeBrief(ctx, root, files, intent, source);
    return { added: true };
  });
};

/**
 * Remap a renamed FOLDER across the active brief: every active child path under
 * `from/` shifts to `to/`, and a `# source-folder:` provenance equal to `from`
 * re-stamps to `to`. Without this, renaming a focused folder leaves focus.md
 * pointing at the old name — so editing the (now-renamed) folder's prompt stops
 * refreshing the brief, and the active paths dangle at the vanished location.
 * Atomic under the focus lock; no-op when nothing references `from`.
 */
export const renameActiveFolder: Handler<
  FocusRenameActiveFolderArgs,
  FocusRenameActiveFolderResult
> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent, source } = await readFocusBrief(ctx.fs, root);
    const fromPrefix = args.from.endsWith('/') ? args.from : `${args.from}/`;
    const toPrefix = args.to.endsWith('/') ? args.to : `${args.to}/`;
    const nextActive = active.map((f) =>
      f.startsWith(fromPrefix) ? toPrefix + f.slice(fromPrefix.length) : f,
    );
    const nextSource: FocusSource | undefined =
      source?.kind === 'folder' && source.id === args.from
        ? { kind: 'folder', id: args.to }
        : source;
    if (!nextActive.some((f, i) => f !== active[i]) && nextSource === source) {
      return { renamed: false };
    }
    await writeBrief(ctx, root, nextActive, intent, nextSource);
    return { renamed: true };
  });
};

/**
 * Add (if absent) or remove (if present) one file from the active set,
 * PRESERVING the intent + `# source-folder:` provenance. Shift+click on the canvas
 * refines an existing focus set; routing that through focus.set({files}) would
 * drop both the curated `intent:` and the provenance — severing a folder-sourced
 * focus's refresh link and silently losing the turn intent. Atomic under the
 * focus lock; returns the new active set so the caller skips a re-read.
 */
export const toggleActiveFile: Handler<
  FocusToggleActiveFileArgs,
  FocusToggleActiveFileResult
> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent, source } = await readFocusBrief(ctx.fs, root);
    const toggled = active.includes(args.file)
      ? active.filter((f) => f !== args.file)
      : [...active, args.file];
    const next = await writeBrief(ctx, root, toggled, intent, source); // preserve BOTH
    return { active: next };
  });
};

/**
 * Set (or clear) the turn intent — the user's question for this focus — WITHOUT
 * touching the active set or its per-file prompts/refs. The dominant ad-hoc flow
 * (click a few badges, then ask) had no way to author the most load-bearing line
 * of the brief; this is it. A manually-typed intent is the user's OWN, so it
 * CLEARS the `# source-folder:` provenance (the intent is no longer folder-derived
 * — editing that folder's prompt must not overwrite the user's question). An
 * empty/whitespace intent clears the line. Atomic under the focus lock; reads the
 * authoritative active set from focus.md (never trusts a caller-supplied list).
 */
export const setIntent: Handler<FocusSetIntentArgs, FocusSetIntentResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent: currentIntent } = await readFocusBrief(ctx.fs, root);
    // Focus changed underneath this edit (e.g. the editor was dismissed by a
    // click that selected another file or cleared focus) — don't write the old
    // question into the new focus; leave it untouched.
    if (
      args.expectedActive !== undefined &&
      !(
        args.expectedActive.length === active.length &&
        args.expectedActive.every((f, i) => f === active[i])
      )
    ) {
      return { intent: currentIntent ?? null, skipped: true };
    }
    const trimmed = args.intent?.trim();
    const intent = trimmed ? trimmed : undefined;
    await writeBrief(ctx, root, active, intent, undefined); // manual intent → no source provenance
    return { intent: intent ?? null };
  });
};

/**
 * Re-render focus.md from its CURRENT active list with FRESH badge data,
 * preserving the `intent:` line. This is the core reconcile the renderer used
 * to fake in `resyncFocusForFile`: an in-app / CLI / agent edit to a badge's
 * prompt or refs (`badge.set/addRef/removeRef`) doesn't touch focus.md, so the
 * agent would keep reading the OLD inlined brief until the user re-set focus.
 * Wiring badge edits to focus.resync keeps the brief fresh everywhere, not
 * just in the desktop. No-op (no write) unless `args.file` is in the active
 * list, so eager-materialize badge writes don't churn focus.md.
 */
export const resync: Handler<FocusResyncArgs, FocusResyncResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent, source } = await readFocusBrief(ctx.fs, root);
    if (active.length === 0) return { resynced: false };
    if (args.file !== undefined && !active.includes(args.file)) return { resynced: false };
    // Re-render through writeBrief (the liveness choke point): a badge edit
    // re-inlines fresh prompts/refs, AND any now-orphan file drops with a heal
    // note — so resync self-heals an orphaned brief. This is exactly the watcher's
    // markOrphan→resync cascade. Provenance + intent preserved so a folder-sourced
    // focus keeps refreshing as its prompt changes.
    await writeBrief(ctx, root, active, intent, source);
    return { resynced: true };
  });
};

/**
 * Is a workspace-relative file still on disk? Routed through the realpath
 * containment guard so a planted symlink can't make a vanished file look live.
 * Any error (PathEscape, stat failure) is treated as "gone" — fail toward
 * pruning a dangling item, never toward keeping one.
 */
async function fileStillExists(
  ctx: Parameters<Handler>[1],
  root: string,
  file: string,
): Promise<boolean> {
  try {
    const abs = await assertReadContained(ctx.fs, root, join(root, file));
    return (await ctx.fs.stat(abs)) !== null;
  } catch {
    return false;
  }
}

/**
 * Re-validate the active list against disk and drop any file that no longer
 * exists (git checkout, external rm, a delete that happened while the watcher
 * wasn't running). The stat-based counterpart to the watcher-driven dropOrphan,
 * meant to run on re-entry (workspace open). Cheap when nothing dangles (one stat
 * per active file; focus sets are small). Intent + provenance preserved; a heal
 * note records the count. Atomic under the lock.
 */
export const pruneDangling: Handler<FocusPruneDanglingArgs, FocusPruneDanglingResult> = async (
  _args,
  ctx,
) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent, source } = await readFocusBrief(ctx.fs, root);
    if (active.length === 0) return { pruned: 0 };
    const live: string[] = [];
    for (const f of active) {
      if (await fileStillExists(ctx, root, f)) live.push(f);
    }
    const pruned = active.length - live.length;
    if (pruned === 0) return { pruned: 0 };
    const items = await assembleItems(ctx, live);
    await writeFocus(ctx.fs, root, items, intent, source, pruned);
    return { pruned };
  });
};

export const get: Handler<FocusGetArgs, FocusGetResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  // Strip the internal source provenance — focus.get's contract is the
  // round-trippable active list + intent.
  const { active, intent } = await readFocusBrief(ctx.fs, root);
  // The brief-read receipt (when an agent last pulled focus.brief), so the chip
  // can show "agent read your context Ns ago". A read, never a stamp.
  const lastBriefServedAt = await readBriefServedAt(ctx.fs, root);
  return {
    active,
    ...(intent !== undefined && { intent }),
    ...(lastBriefServedAt !== undefined && { lastBriefServedAt }),
  };
};

/**
 * Return `.bh/focus.md` verbatim — the exact turn brief the agent reads. This
 * is the same file `focus.get` parses, but `get` returns the round-trippable
 * state (active paths + intent) whereas `brief` returns the human-readable
 * Markdown the agent actually consumes, so the desktop can offer "copy what my
 * agent sees" for pasting into any chat. Read-only; empty string when absent.
 */
export const brief: Handler<FocusBriefArgs, FocusBriefResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const raw = await readMaybeNoFollow(
    ctx.fs,
    await assertReadContained(ctx.fs, root, focusPath(root)),
  );
  // CONFIRM (serve-and-confirm): record that the brief was served so the desktop
  // can show "agent read your context Ns ago". Best-effort — a .bh/cache/ write
  // hiccup must never fail the read. Honest: this logs a READ, not comprehension.
  try {
    await stampBriefServed(ctx.fs, root);
  } catch {
    /* best-effort: the served receipt is non-load-bearing */
  }
  return { brief: raw ?? '' };
};

export const clear: Handler<FocusClearArgs, FocusClearResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  await withFocusLock(root, () => writeFocus(ctx.fs, root, []));
  return { cleared: true };
};

/**
 * Seed `.bh/focus.md` with the empty template if it doesn't exist yet.
 * Idempotent — re-running on a workspace with a populated focus.md is a
 * no-op so user state is never clobbered. Called by workspace.add/use so
 * the agent contract surface always exists; without it an agent following
 * the CLAUDE.md hint and reading focus.md on a brand-new workspace gets
 * ENOENT before any UI click ever happens.
 */
export const init: Handler<FocusInitArgs, FocusInitResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const existing = await readMaybeNoFollow(
    ctx.fs,
    await assertReadContained(ctx.fs, root, focusPath(root)),
  );
  if (existing !== null) return { created: false };
  await writeFocus(ctx.fs, root, []);
  return { created: true };
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['focus.set', set as unknown as Handler<never, unknown>],
    ['focus.get', get as unknown as Handler<never, unknown>],
    ['focus.brief', brief as unknown as Handler<never, unknown>],
    ['focus.refreshFolderIntent', refreshFolderIntent as unknown as Handler<never, unknown>],
    ['focus.renameActiveFile', renameActiveFile as unknown as Handler<never, unknown>],
    ['focus.renameActiveFolder', renameActiveFolder as unknown as Handler<never, unknown>],
    ['focus.reconcileNewFile', reconcileNewFile as unknown as Handler<never, unknown>],
    ['focus.toggleActiveFile', toggleActiveFile as unknown as Handler<never, unknown>],
    ['focus.setIntent', setIntent as unknown as Handler<never, unknown>],
    ['focus.clear', clear as unknown as Handler<never, unknown>],
    ['focus.resync', resync as unknown as Handler<never, unknown>],
    ['focus.pruneDangling', pruneDangling as unknown as Handler<never, unknown>],
    ['focus.init', init as unknown as Handler<never, unknown>],
  ];
}
