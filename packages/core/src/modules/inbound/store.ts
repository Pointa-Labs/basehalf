import { dirname, join } from 'node:path';
import type { FsLike } from '../../kernel/index.js';
import type { InboundIndex } from './types.js';

const INDEX_FILE = '.bh/index/inbound.json';

// Fresh index, used when the file is missing or corrupt. We deliberately
// OMIT `rebuildAt` — an epoch sentinel ("1970-01-01T00:00:00.000Z") rendered
// into git diffs every time the index was created looked like a bug. The
// field is now only set when `inbound.rebuild` actually runs.
const EMPTY = (): InboundIndex => ({
  bhVersion: 1,
  entries: {},
});

export function inboundPath(workspaceRoot: string): string {
  return join(workspaceRoot, INDEX_FILE);
}

export async function readInbound(fs: FsLike, workspaceRoot: string): Promise<InboundIndex> {
  const raw = await fs.readFile(inboundPath(workspaceRoot));
  if (raw === null) return EMPTY();
  try {
    return JSON.parse(raw) as InboundIndex;
  } catch {
    // Corrupt index: behave as if missing — next rebuild / write recreates it.
    return EMPTY();
  }
}

export async function writeInbound(
  fs: FsLike,
  workspaceRoot: string,
  index: InboundIndex,
): Promise<void> {
  const path = inboundPath(workspaceRoot);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(index, null, 2)}\n`);
}
