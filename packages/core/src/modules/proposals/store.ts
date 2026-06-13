import { dirname, join } from 'node:path';
import {
  type FsLike,
  assertReadContained,
  assertWriteContained,
  readMaybeNoFollow,
  writeMaybeNoFollow,
} from '../../kernel/index.js';
import type { Proposal } from './types.js';

const PROPOSALS_FILE = '.bh/cache/proposals.md';

export function proposalsPath(workspaceRoot: string): string {
  return join(workspaceRoot, PROPOSALS_FILE);
}

/**
 * Parse the raw proposals.md into structured proposals. Each non-empty,
 * non-comment line is one observation; we try to split it into
 * `<file> -> <target>: <reason>` but ALWAYS keep the raw line, so a malformed
 * observation is surfaced to the user verbatim rather than dropped. `line` is the
 * 0-based index among the KEPT (non-empty, non-comment) lines — the stable handle
 * dismiss() uses, independent of blank lines and `#` comments in the file.
 */
export function parseProposals(raw: string): Proposal[] {
  const out: Proposal[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const m = /^(.+?)\s*->\s*(.+?)\s*:\s*(.+)$/.exec(trimmed);
    const proposal: Proposal = m
      ? {
          line: out.length,
          raw: trimmed,
          file: m[1]?.trim() ?? '',
          target: m[2]?.trim() ?? '',
          reason: m[3]?.trim() ?? '',
        }
      : { line: out.length, raw: trimmed };
    out.push(proposal);
  }
  return out;
}

/** Read proposals.md (absent → empty list). Never throws on a missing file. */
export async function readProposals(fs: FsLike, workspaceRoot: string): Promise<Proposal[]> {
  try {
    const raw = await readMaybeNoFollow(
      fs,
      await assertReadContained(fs, workspaceRoot, proposalsPath(workspaceRoot)),
    );
    if (raw === null) return [];
    return parseProposals(raw);
  } catch {
    // A planted symlink / unreadable cache file must never break the list — the
    // proposals file is rebuildable cache, never load-bearing.
    return [];
  }
}

/** Re-serialize a proposal list back to proposals.md (one raw line each). */
export async function writeProposals(
  fs: FsLike,
  workspaceRoot: string,
  proposals: readonly Proposal[],
): Promise<void> {
  const path = await assertWriteContained(fs, workspaceRoot, proposalsPath(workspaceRoot));
  await fs.mkdir(dirname(path), { recursive: true });
  const body = proposals.length === 0 ? '' : `${proposals.map((p) => p.raw).join('\n')}\n`;
  await writeMaybeNoFollow(fs, path, body);
}
