import type { Context, Handler } from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { readAllDecisions, readDecision, writeDecision } from './store.js';
import type {
  Decision,
  DecisionAddArgs,
  DecisionAddResult,
  DecisionLink,
  DecisionLinkArgs,
  DecisionLinkResult,
  DecisionListArgs,
  DecisionListResult,
  DecisionRecallArgs,
  DecisionRecallResult,
  DecisionShowArgs,
  DecisionShowResult,
  DecisionStatus,
  DecisionUnlinkArgs,
  DecisionUnlinkResult,
  DecisionUpdateArgs,
  DecisionUpdateResult,
  InboundLink,
} from './types.js';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KIND_PATTERN = /^[a-z][a-z-]{0,31}$/;
const VALID_STATUSES: readonly DecisionStatus[] = ['active', 'deprecated', 'superseded'];

// ── helpers ─────────────────────────────────────────────────────────────────

/** Resolves the current workspace's root path, or throws a friendly error. */
async function currentWorkspaceRoot(ctx: Context): Promise<string> {
  const r = await ctx.run<Record<string, never>, WorkspaceCurrentResult>('workspace.current', {});
  if (r.current === null) {
    throw new Error(
      'No active workspace. Register one with `bh workspace add <path>`, then retry.',
    );
  }
  return r.current.path;
}

/** title → kebab-case slug (lowercase, non-alnum → -, collapse, trim). */
function deriveSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function defaultDecidedBy(): string {
  return process.env.USER ?? process.env.USERNAME ?? 'anonymous';
}

function assertStatus(s: string): asserts s is DecisionStatus {
  if (!(VALID_STATUSES as readonly string[]).includes(s)) {
    throw new Error(`Invalid status: ${s} (expected one of ${VALID_STATUSES.join(', ')})`);
  }
}

function dedupe(items: readonly string[]): string[] {
  return Array.from(new Set(items));
}

// ── add ─────────────────────────────────────────────────────────────────────

/**
 * `bh decision add <title> --because <rationale> [--source <s>...] [--tag <t>...]`
 *  - Derives a slug from title (or uses --slug); refuses duplicates (forces good names).
 *  - Stores at `<workspace>/.bh/decisions/<slug>.json`.
 *  - decidedBy defaults to $USER / $USERNAME / 'anonymous'.
 *  - Status starts as 'active'; links starts as [].
 */
export const add: Handler<DecisionAddArgs, DecisionAddResult> = async (args, ctx) => {
  if (!args.title.trim()) throw new Error('Title is required and cannot be empty.');
  if (!args.because.trim()) throw new Error('--because (rationale) is required.');

  const slug = args.slug ?? deriveSlug(args.title);
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Invalid slug: ${JSON.stringify(slug)} (allowed: a-z 0-9 -, 1-64 chars, starts alnum)`,
    );
  }

  const workspaceRoot = await currentWorkspaceRoot(ctx);
  const existing = await readDecision(ctx.fs, workspaceRoot, slug);
  if (existing) {
    throw new Error(`Decision already exists: ${slug} (in ${workspaceRoot})`);
  }

  const decision: Decision = {
    version: 1,
    slug,
    title: args.title.trim(),
    rationale: args.because.trim(),
    sources: args.source ? dedupe([...args.source]) : [],
    tags: args.tag ? dedupe([...args.tag]) : [],
    status: 'active',
    decidedAt: new Date().toISOString(),
    decidedBy: args.by ?? defaultDecidedBy(),
    supersedes: null,
    supersededBy: null,
    links: [],
  };

  await writeDecision(ctx.fs, workspaceRoot, decision);

  return {
    decision,
    path: `.bh/decisions/${slug}.json`,
  };
};

// ── recall ──────────────────────────────────────────────────────────────────

/**
 * `bh decision recall [query] [--tag t]... [--status s] [--limit n]`
 *  - No query → return all (filtered by tag/status if given).
 *  - With query → substring match (case-insensitive) on title + rationale + tags + sources.
 *  - --tag is AND semantics (all listed tags must be present).
 *  - Sorted by decidedAt desc (newest first).
 */
export const recall: Handler<DecisionRecallArgs, DecisionRecallResult> = async (args, ctx) => {
  const workspaceRoot = await currentWorkspaceRoot(ctx);
  const all = await readAllDecisions(ctx.fs, workspaceRoot);

  const tagFilter = args.tag?.map((t) => t.toLowerCase()) ?? [];
  const statusFilter = args.status;
  const query = args.query?.toLowerCase() ?? '';

  let matches = all.filter((d) => {
    if (statusFilter && d.status !== statusFilter) return false;
    if (tagFilter.length > 0) {
      const decisionTags = d.tags.map((t) => t.toLowerCase());
      if (!tagFilter.every((t) => decisionTags.includes(t))) return false;
    }
    if (query) {
      const haystack = [d.title, d.rationale, ...d.tags, ...d.sources].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  // Sort newest first.
  matches = matches.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));

  if (typeof args.limit === 'number' && args.limit > 0) {
    matches = matches.slice(0, args.limit);
  }

  return { matches };
};

// ── list ────────────────────────────────────────────────────────────────────

/** `bh decision list [--tag t]... [--status s]` — same as recall with no query. */
export const list: Handler<DecisionListArgs, DecisionListResult> = async (args, ctx) => {
  const r = await recall(
    {
      ...(args.tag !== undefined && { tag: args.tag }),
      ...(args.status !== undefined && { status: args.status }),
    },
    ctx,
  );
  return { decisions: r.matches };
};

// ── show ────────────────────────────────────────────────────────────────────

/**
 * `bh decision show <slug>` — full decision + computed inbound links (other
 * decisions that point to this one). Inbound is derived on every call via a
 * linear scan; cheap up to ~1000s of decisions.
 */
export const show: Handler<DecisionShowArgs, DecisionShowResult> = async (args, ctx) => {
  const workspaceRoot = await currentWorkspaceRoot(ctx);
  const d = await readDecision(ctx.fs, workspaceRoot, args.slug);
  if (!d) {
    throw new Error(`No such decision: ${args.slug}`);
  }
  const inboundLinks = await computeInbound(ctx, workspaceRoot, args.slug);
  return { decision: d, inboundLinks };
};

async function computeInbound(
  ctx: Context,
  workspaceRoot: string,
  targetSlug: string,
): Promise<InboundLink[]> {
  const all = await readAllDecisions(ctx.fs, workspaceRoot);
  const inbound: InboundLink[] = [];
  for (const d of all) {
    if (d.slug === targetSlug) continue;
    for (const link of d.links) {
      if (link.slug === targetSlug) {
        inbound.push({
          fromSlug: d.slug,
          kind: link.kind,
          ...(link.note !== undefined && { note: link.note }),
        });
      }
    }
  }
  return inbound;
}

// ── update ──────────────────────────────────────────────────────────────────

/**
 * `bh decision update <slug> [--status s] [--add-source s]... [--add-tag t]... [--superseded-by s]`
 *  - **Does NOT change `title` or `rationale`** — rewriting them would corrupt
 *    the audit trail. To change direction, supersede: add a new decision and
 *    set the old one's `status` to `superseded` + `supersededBy = newSlug`.
 *  - Sources/tags are append-only here (use `bh decision link/unlink` for
 *    cross-decision relationships, hand-edit the JSON for removal).
 */
export const update: Handler<DecisionUpdateArgs, DecisionUpdateResult> = async (args, ctx) => {
  const workspaceRoot = await currentWorkspaceRoot(ctx);
  const existing = await readDecision(ctx.fs, workspaceRoot, args.slug);
  if (!existing) {
    throw new Error(`No such decision: ${args.slug}`);
  }

  if (args.status !== undefined) assertStatus(args.status);

  // Validate supersededBy points to a real decision (avoid dangling references).
  if (args.supersededBy !== undefined) {
    const target = await readDecision(ctx.fs, workspaceRoot, args.supersededBy);
    if (!target) {
      throw new Error(`supersededBy target does not exist: ${args.supersededBy}`);
    }
  }

  const updated: Decision = {
    ...existing,
    status: args.status ?? existing.status,
    sources: args.addSource ? dedupe([...existing.sources, ...args.addSource]) : existing.sources,
    tags: args.addTag ? dedupe([...existing.tags, ...args.addTag]) : existing.tags,
    supersededBy: args.supersededBy ?? existing.supersededBy,
  };

  await writeDecision(ctx.fs, workspaceRoot, updated);
  return { decision: updated };
};

// ── link ────────────────────────────────────────────────────────────────────

/**
 * `bh decision link <slug> --to <target> --kind <kind> [--note <text>]`
 *  - Records an outbound link from <slug> to <target>.
 *  - Both decisions must exist; self-links rejected (no value).
 *  - `kind` is lowercase kebab; conventions documented in CLAUDE.md but the
 *    server doesn't enforce a fixed set (different teams want different
 *    vocabularies — relates / extends / depends-on / informed-by / refines /
 *    conflicts-with / spawned-by / blocks / etc.).
 *  - Idempotent: link with identical (target, kind) is a no-op rather than an
 *    error. Different `note` overwrites.
 */
export const link: Handler<DecisionLinkArgs, DecisionLinkResult> = async (args, ctx) => {
  if (args.slug === args.to) throw new Error('Cannot link a decision to itself.');
  if (!KIND_PATTERN.test(args.kind)) {
    throw new Error(
      `Invalid kind: ${JSON.stringify(args.kind)} (allowed: a-z and -, 1-32 chars, starts a-z)`,
    );
  }

  const workspaceRoot = await currentWorkspaceRoot(ctx);
  const source = await readDecision(ctx.fs, workspaceRoot, args.slug);
  if (!source) throw new Error(`No such decision: ${args.slug}`);
  const target = await readDecision(ctx.fs, workspaceRoot, args.to);
  if (!target) throw new Error(`Link target does not exist: ${args.to}`);

  const newLink: DecisionLink = {
    slug: args.to,
    kind: args.kind,
    ...(args.note !== undefined && { note: args.note }),
  };

  // Idempotent: replace existing (target, kind) pair if present.
  const filtered = source.links.filter((l) => !(l.slug === args.to && l.kind === args.kind));
  const updated: Decision = { ...source, links: [...filtered, newLink] };

  await writeDecision(ctx.fs, workspaceRoot, updated);
  return { decision: updated, added: newLink };
};

// ── unlink ──────────────────────────────────────────────────────────────────

/**
 * `bh decision unlink <slug> --from <target> [--kind <kind>]`
 *  - Removes outbound link(s) from <slug> to <target>.
 *  - Without --kind: removes ALL links from slug → target.
 *  - With --kind: removes only that specific (target, kind) link.
 *  - Returns the list of removed links (so JSON output is informative).
 */
export const unlink: Handler<DecisionUnlinkArgs, DecisionUnlinkResult> = async (args, ctx) => {
  const workspaceRoot = await currentWorkspaceRoot(ctx);
  const source = await readDecision(ctx.fs, workspaceRoot, args.slug);
  if (!source) throw new Error(`No such decision: ${args.slug}`);

  const removed: DecisionLink[] = [];
  const kept: DecisionLink[] = [];
  for (const l of source.links) {
    const matchTarget = l.slug === args.from;
    const matchKind = args.kind === undefined || l.kind === args.kind;
    if (matchTarget && matchKind) removed.push(l);
    else kept.push(l);
  }

  if (removed.length === 0) {
    throw new Error(
      `No matching links to remove (slug=${args.slug}, from=${args.from}${args.kind ? `, kind=${args.kind}` : ''}).`,
    );
  }

  const updated: Decision = { ...source, links: kept };
  await writeDecision(ctx.fs, workspaceRoot, updated);
  return { decision: updated, removed };
};

// ── module registration ─────────────────────────────────────────────────────

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['decision.add', add as unknown as Handler<never, unknown>],
    ['decision.recall', recall as unknown as Handler<never, unknown>],
    ['decision.list', list as unknown as Handler<never, unknown>],
    ['decision.show', show as unknown as Handler<never, unknown>],
    ['decision.update', update as unknown as Handler<never, unknown>],
    ['decision.link', link as unknown as Handler<never, unknown>],
    ['decision.unlink', unlink as unknown as Handler<never, unknown>],
  ];
}
