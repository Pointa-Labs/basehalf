import { dirname, join } from 'node:path';
import type { FsLike } from '../../kernel/index.js';
import type { InboundIndex } from './types.js';

const INDEX_FILE = '.bh/index/inbound.json';

const EMPTY = (): InboundIndex => ({
  bhVersion: 1,
  entries: {},
  rebuildAt: new Date(0).toISOString(),
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
