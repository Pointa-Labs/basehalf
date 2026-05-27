import { join } from 'node:path';
import type { FsLike } from '../../kernel/index.js';
import type { Decision } from './types.js';

/**
 * Persistence for decisions. Each decision lives in its own JSON file under
 * `<workspace-root>/.bh/decisions/<slug>.json`. This makes every decision a
 * git-trackable atom (small diffs, clean rename detection, hand-editable).
 */

export function decisionsDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.bh', 'decisions');
}

export function decisionPath(workspaceRoot: string, slug: string): string {
  return join(decisionsDir(workspaceRoot), `${slug}.json`);
}

export async function readDecision(
  fs: FsLike,
  workspaceRoot: string,
  slug: string,
): Promise<Decision | null> {
  const raw = await fs.readFile(decisionPath(workspaceRoot, slug));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Decision>;
    if (parsed?.version !== 1) {
      throw new Error(`Unsupported decision file version: ${String(parsed?.version)} (${slug})`);
    }
    // Backward compat: files written before the `links` field default to empty.
    return { ...(parsed as Decision), links: parsed.links ?? [] };
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Decision file is not valid JSON (${slug}): ${err.message}`);
    }
    throw err;
  }
}

export async function writeDecision(
  fs: FsLike,
  workspaceRoot: string,
  decision: Decision,
): Promise<void> {
  await fs.mkdir(decisionsDir(workspaceRoot), { recursive: true });
  await fs.writeFile(
    decisionPath(workspaceRoot, decision.slug),
    `${JSON.stringify(decision, null, 2)}\n`,
  );
}

/**
 * Lists all decision slugs in `<workspace>/.bh/decisions/`. Returns [] if the
 * dir doesn't exist (no decisions yet). Filters to *.json basenames only so
 * stray files (e.g. .DS_Store) are ignored.
 */
export async function listDecisionSlugs(fs: FsLike, workspaceRoot: string): Promise<string[]> {
  const dir = decisionsDir(workspaceRoot);
  const exists = await fs.stat(dir);
  if (!exists) return [];
  const entries = await fs.readdir(dir);
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort((a, b) => a.localeCompare(b));
}

/** Reads all decision files; skips slugs whose file can't be parsed (logged in errors). */
export async function readAllDecisions(fs: FsLike, workspaceRoot: string): Promise<Decision[]> {
  const slugs = await listDecisionSlugs(fs, workspaceRoot);
  const results: Decision[] = [];
  for (const slug of slugs) {
    const d = await readDecision(fs, workspaceRoot, slug);
    if (d) results.push(d);
  }
  return results;
}
