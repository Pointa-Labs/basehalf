import { type Handler, createKeyedMutex } from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { mergeRange, normalizeRanges, subtractRange } from './ranges.js';
import { adhdRevision, patchAdhd, readAdhd } from './store.js';
import type {
  AdhdAddKeywordArgs,
  AdhdAddKeywordResult,
  AdhdFile,
  AdhdGetArgs,
  AdhdGetResult,
  AdhdMarkReadArgs,
  AdhdMarkReadResult,
  AdhdMarkUnreadArgs,
  AdhdMarkUnreadResult,
  AdhdRemoveKeywordArgs,
  AdhdRemoveKeywordResult,
  AdhdRevisionArgs,
  AdhdRevisionResult,
  AdhdSetArgs,
  AdhdSetResult,
  LineRange,
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

// Serialize app-level adhd writes per workspace ROOT (a granular keyword/range
// edit is an RMW that must not lose a concurrent one). patchAdhd adds per-file
// atomicity vs external writers (an agent editing .bh/mirror directly).
const withAdhdLock = createKeyedMutex();

/** De-duplicate keywords (trim, drop blanks), preserving first-seen order. */
function dedupe(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const t = k.trim();
    if (t !== '' && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Build the canonical adhd object, omitting empty fields (keeps the file sparse). */
function build(
  file: string,
  keywords: readonly string[] | undefined,
  ranges: readonly LineRange[] | undefined,
): AdhdFile {
  return {
    path: file,
    kind: 'file',
    ...(keywords !== undefined && keywords.length > 0 && { highlight_keywords: keywords }),
    ...(ranges !== undefined && ranges.length > 0 && { read_paragraphs: ranges }),
  };
}

/** An adhd node with no keywords and no read ranges is pruned (sparse overlay). */
function isEmpty(a: AdhdFile): boolean {
  return (a.highlight_keywords?.length ?? 0) === 0 && (a.read_paragraphs?.length ?? 0) === 0;
}

export const get: Handler<AdhdGetArgs, AdhdGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return readAdhd(ctx.fs, root, args.file);
};

/** Replace the whole adhd.yaml (the agent's GENERATE door). Normalizes ranges +
 *  de-dupes keywords; an all-empty set prunes the file. */
export const set: Handler<AdhdSetArgs, AdhdSetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const keywords = dedupe(args.highlight_keywords ?? []);
  const ranges = normalizeRanges(args.read_paragraphs ?? []);
  const next = build(args.file, keywords, ranges);
  await withAdhdLock(root, () =>
    patchAdhd(ctx.fs, root, args.file, () => (isEmpty(next) ? null : next)),
  );
  return next;
};

export const addKeyword: Handler<AdhdAddKeywordArgs, AdhdAddKeywordResult> = async (args, ctx) => {
  const kw = args.keyword.trim();
  if (kw === '') throw new Error('adhd.addKeyword: keyword is empty');
  const root = await currentWorkspaceRoot(ctx);
  return (await withAdhdLock(root, () =>
    patchAdhd(ctx.fs, root, args.file, (cur) => {
      const existing = cur?.highlight_keywords ?? [];
      if (existing.includes(kw)) return cur ?? build(args.file, [kw], undefined);
      return build(args.file, [...existing, kw], cur?.read_paragraphs);
    }),
  )) as AdhdFile;
};

export const removeKeyword: Handler<AdhdRemoveKeywordArgs, AdhdRemoveKeywordResult> = async (
  args,
  ctx,
) => {
  const root = await currentWorkspaceRoot(ctx);
  return withAdhdLock(root, () =>
    patchAdhd(ctx.fs, root, args.file, (cur) => {
      if (!cur) return null;
      const kept = (cur.highlight_keywords ?? []).filter((k) => k !== args.keyword);
      const next = build(args.file, kept, cur.read_paragraphs);
      return isEmpty(next) ? null : next;
    }),
  );
};

/** Mark `[start, end]` read (merged into read_paragraphs). */
export const markRead: Handler<AdhdMarkReadArgs, AdhdMarkReadResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return (await withAdhdLock(root, () =>
    patchAdhd(ctx.fs, root, args.file, (cur) => {
      const merged = mergeRange(cur?.read_paragraphs ?? [], args.start, args.end);
      return build(args.file, cur?.highlight_keywords, merged);
    }),
  )) as AdhdFile;
};

/** Mark `[start, end]` unread (subtracted from read_paragraphs, splitting ranges). */
export const markUnread: Handler<AdhdMarkUnreadArgs, AdhdMarkUnreadResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withAdhdLock(root, () =>
    patchAdhd(ctx.fs, root, args.file, (cur) => {
      if (!cur) return null; // nothing read → nothing to unread
      const subtracted = subtractRange(cur.read_paragraphs ?? [], args.start, args.end);
      const next = build(args.file, cur.highlight_keywords, subtracted);
      return isEmpty(next) ? null : next;
    }),
  );
};

export const revision: Handler<AdhdRevisionArgs, AdhdRevisionResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return adhdRevision(ctx.fs, root);
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['adhd.get', get as unknown as Handler<never, unknown>],
    ['adhd.set', set as unknown as Handler<never, unknown>],
    ['adhd.addKeyword', addKeyword as unknown as Handler<never, unknown>],
    ['adhd.removeKeyword', removeKeyword as unknown as Handler<never, unknown>],
    ['adhd.markRead', markRead as unknown as Handler<never, unknown>],
    ['adhd.markUnread', markUnread as unknown as Handler<never, unknown>],
    ['adhd.revision', revision as unknown as Handler<never, unknown>],
  ];
}
