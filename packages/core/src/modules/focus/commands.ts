import {
  type Handler,
  assertReadContained,
  createKeyedMutex,
  readMaybeNoFollow,
} from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { focusPath, readFocusBrief, writeFocus } from './store.js';
import type {
  FocusBriefArgs,
  FocusBriefResult,
  FocusClearArgs,
  FocusClearProvenanceIfViewArgs,
  FocusClearProvenanceIfViewResult,
  FocusClearResult,
  FocusGetArgs,
  FocusGetResult,
  FocusInitArgs,
  FocusInitResult,
  FocusItem,
  FocusRefreshViewIntentArgs,
  FocusRefreshViewIntentResult,
  FocusRenameActiveFileArgs,
  FocusRenameActiveFileResult,
  FocusResyncArgs,
  FocusResyncResult,
  FocusSetArgs,
  FocusSetIntentArgs,
  FocusSetIntentResult,
  FocusSetResult,
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
 * Inline each active file's curated MEANING (prompt + outbound ref-notes) so
 * the agent reads the whole brief in one pass instead of re-reading N badge
 * JSONs. Composed via ctx.run only (module isolation); a file with no badge
 * (or a folder) contributes its bare path. Shared by focus.set + focus.resync
 * so they assemble identical briefs.
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

// Minimal shapes for the cross-module reads focus.set composes via ctx.run
// (never imports another module's internals — keeps the dep arrow one-way).
interface ViewGetMinimal {
  readonly prompt?: string;
  readonly members: readonly { readonly file: string }[];
}
interface BadgeGetMinimal {
  readonly prompt?: string;
  readonly references?: readonly { readonly to: string; readonly note?: string }[];
}

export const set: Handler<FocusSetArgs, FocusSetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  let files: readonly string[];
  let intent: string | undefined = args.intent;
  let sourceView: string | undefined;
  if (args.viewId !== undefined) {
    const view = await ctx.run<{ id: string }, ViewGetMinimal | null>('view.get', {
      id: args.viewId,
    });
    if (!view) {
      throw new Error(`View not found: ${args.viewId}`);
    }
    files = view.members.map((m) => m.file);
    // Carry the view's prompt as the turn's intent. It's the human's
    // strongest "here's what I'm thinking" artifact and was previously
    // dropped on the floor here (only m.file survived).
    if (intent === undefined && view.prompt !== undefined && view.prompt.trim() !== '') {
      intent = view.prompt;
    }
    // Record provenance ONLY when the intent is view-DERIVED (no manual
    // override) — so a later prompt edit can refresh this brief by identity, but
    // a hand-set intent override is never auto-clobbered. Recorded even when the
    // view's prompt is currently blank, so editing it later still refreshes.
    if (args.intent === undefined) sourceView = args.viewId;
  } else {
    files = args.files ?? [];
  }

  await withFocusLock(root, async () => {
    const items = await assembleItems(ctx, files);
    await writeFocus(ctx.fs, root, items, intent, sourceView);
  });
  return { active: files };
};

/**
 * Re-publish focus.md's `intent:` from a view whose prompt just changed — but
 * ONLY when this view is the recorded SOURCE of the current focus (the
 * `# source-view:` provenance written by focus.set equals viewId). Identity, not
 * inference: a DIFFERENT view with identical members (or an identical/blank
 * prompt), a manual intent override, and a files-sourced focus all lack this
 * view's provenance and are left untouched — independent of prompt text or
 * whitespace/newline normalization. The whole check-then-write runs UNDER the
 * focus lock (no TOCTOU with a concurrent focus.set/clear). The current active
 * list is preserved verbatim (member drift since focusing is a separate
 * concern); only the intent is refreshed to the view's new prompt, and the
 * provenance is re-stamped.
 */
export const refreshViewIntent: Handler<
  FocusRefreshViewIntentArgs,
  FocusRefreshViewIntentResult
> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, sourceView } = await readFocusBrief(ctx.fs, root);
    if (sourceView !== args.viewId) return { refreshed: false };
    const view = await ctx.run<{ id: string }, ViewGetMinimal | null>('view.get', {
      id: args.viewId,
    });
    if (!view) return { refreshed: false };
    const newIntent =
      view.prompt !== undefined && view.prompt.trim() !== '' ? view.prompt : undefined;
    const items = await assembleItems(ctx, active);
    await writeFocus(ctx.fs, root, items, newIntent, args.viewId);
    return { refreshed: true };
  });
};

/**
 * Drop the `# source-view:` marker when the view it names is being DELETED, so a
 * future view that reuses the same slug id can't be mistaken for the source of
 * this focus (which would let editing the new view's prompt rewrite an unrelated
 * brief). Active list + intent are preserved — only the provenance is cleared.
 * Atomic under the focus lock; no-op when this view isn't the source.
 */
export const clearProvenanceIfView: Handler<
  FocusClearProvenanceIfViewArgs,
  FocusClearProvenanceIfViewResult
> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent, sourceView } = await readFocusBrief(ctx.fs, root);
    if (sourceView !== args.viewId) return { cleared: false };
    const items = await assembleItems(ctx, active);
    await writeFocus(ctx.fs, root, items, intent); // no sourceView → marker dropped
    return { cleared: true };
  });
};

/**
 * Remap a renamed file in the active list IN PLACE, preserving the intent AND
 * the `# source-view:` provenance. badge.rename used to round-trip through the
 * public focus.get/focus.set shapes, which strip provenance — so after renaming
 * a focused view's member, editing that view's prompt stopped refreshing the
 * brief. This keeps the focus live-linked to its source view across a rename.
 * Atomic under the focus lock; no-op when `from` isn't focused.
 */
export const renameActiveFile: Handler<
  FocusRenameActiveFileArgs,
  FocusRenameActiveFileResult
> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent, sourceView } = await readFocusBrief(ctx.fs, root);
    if (!active.includes(args.from)) return { renamed: false };
    // writeFocus asserts every active path (incl. the new `to`) before writing.
    const next = active.map((f) => (f === args.from ? args.to : f));
    const items = await assembleItems(ctx, next);
    await writeFocus(ctx.fs, root, items, intent, sourceView);
    return { renamed: true };
  });
};

/**
 * Add (if absent) or remove (if present) one file from the active set,
 * PRESERVING the intent + `# source-view:` provenance. Shift+click on the canvas
 * refines an existing focus set; routing that through focus.set({files}) would
 * drop both the curated `intent:` and the provenance — severing a view-sourced
 * focus's refresh link and silently losing the turn intent. Atomic under the
 * focus lock; returns the new active set so the caller skips a re-read.
 */
export const toggleActiveFile: Handler<
  FocusToggleActiveFileArgs,
  FocusToggleActiveFileResult
> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent, sourceView } = await readFocusBrief(ctx.fs, root);
    const next = active.includes(args.file)
      ? active.filter((f) => f !== args.file)
      : [...active, args.file];
    const items = await assembleItems(ctx, next);
    await writeFocus(ctx.fs, root, items, intent, sourceView); // preserve BOTH
    return { active: next };
  });
};

/**
 * Set (or clear) the turn intent — the user's question for this focus — WITHOUT
 * touching the active set or its per-file prompts/refs. The dominant ad-hoc flow
 * (click a few badges, then ask) had no way to author the most load-bearing line
 * of the brief; this is it. A manually-typed intent is the user's OWN, so it
 * CLEARS the `# source-view:` provenance (the intent is no longer view-derived —
 * editing that view's prompt must not overwrite the user's question). An
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
    const items = await assembleItems(ctx, active);
    const trimmed = args.intent?.trim();
    const intent = trimmed ? trimmed : undefined;
    await writeFocus(ctx.fs, root, items, intent); // manual intent → no sourceView
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
    const { active, intent, sourceView } = await readFocusBrief(ctx.fs, root);
    if (active.length === 0) return { resynced: false };
    if (args.file !== undefined && !active.includes(args.file)) return { resynced: false };
    const items = await assembleItems(ctx, active);
    // Preserve provenance (and intent) — a badge edit must not strip the
    // `# source-view:` marker, or a later view-prompt edit would stop refreshing.
    await writeFocus(ctx.fs, root, items, intent, sourceView);
    return { resynced: true };
  });
};

export const get: Handler<FocusGetArgs, FocusGetResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  // Strip the internal sourceView — focus.get's contract is the round-trippable
  // active list + intent.
  const { active, intent } = await readFocusBrief(ctx.fs, root);
  return { active, ...(intent !== undefined && { intent }) };
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
    ['focus.refreshViewIntent', refreshViewIntent as unknown as Handler<never, unknown>],
    ['focus.clearProvenanceIfView', clearProvenanceIfView as unknown as Handler<never, unknown>],
    ['focus.renameActiveFile', renameActiveFile as unknown as Handler<never, unknown>],
    ['focus.toggleActiveFile', toggleActiveFile as unknown as Handler<never, unknown>],
    ['focus.setIntent', setIntent as unknown as Handler<never, unknown>],
    ['focus.clear', clear as unknown as Handler<never, unknown>],
    ['focus.resync', resync as unknown as Handler<never, unknown>],
    ['focus.init', init as unknown as Handler<never, unknown>],
  ];
}
