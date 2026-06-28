import { mkdir, readlink, stat, symlink, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import type {
  FocusClearResult,
  FocusGetResult,
  FocusNode,
  FocusPruneDanglingResult,
  FocusPurgeNodeArgs,
  FocusPurgeNodeResult,
  FocusRelocateArgs,
  FocusRelocateResult,
  FocusSetArgs,
} from '../common/focus.js';
import {
  MirrorCorrupt,
  YamlMirrorStore,
  assertReadContained,
  assertWriteContained,
  createKeyedMutex,
  isMirrorSubtree,
  remapSubtreeRel,
} from './yamlMirrorStore.js';

export interface FocusBackendProvider {
  set(workspaceRoot: string | null, args: FocusSetArgs): Promise<FocusNode>;
  get(workspaceRoot: string | null): Promise<FocusGetResult>;
  clear(workspaceRoot: string | null): Promise<FocusClearResult>;
  pruneDangling(workspaceRoot: string | null): Promise<FocusPruneDanglingResult>;
  relocate(workspaceRoot: string | null, args: FocusRelocateArgs): Promise<FocusRelocateResult>;
  purgeNode(workspaceRoot: string | null, args: FocusPurgeNodeArgs): Promise<FocusPurgeNodeResult>;
}

export class FocusCorrupt extends Error {
  override readonly name = 'FocusCorrupt';

  constructor(
    public readonly path: string,
    opts?: { cause?: unknown },
  ) {
    super(`Corrupt focus.yaml for "${path}"`, opts);
  }
}

const withFocusLock = createKeyedMutex();
const DEFAULT_STORE = new YamlMirrorStore();

/**
 * Desktop-native focus backend for the `.bh/mirror` viewport state. This is the
 * workbench view-state equivalent of VS Code's memento/storage services: the
 * renderer records what the user is looking at, and the main-process provider
 * persists it through the focused workbench mirror service.
 */
export class FocusYamlBackendProvider implements FocusBackendProvider {
  constructor(private readonly store: YamlMirrorStore = DEFAULT_STORE) {}

  async set(workspaceRoot: string | null, args: FocusSetArgs): Promise<FocusNode> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const node = buildNode(args);
    return withFocusLock(root, async () => {
      const written = await this.patchFocusNode(root, node);
      await repointCurrentFocus(root, args.path);
      return written;
    });
  }

  async get(workspaceRoot: string | null): Promise<FocusGetResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return withFocusLock(root, () => readCurrentFocus(root, this.store));
  }

  async clear(workspaceRoot: string | null): Promise<FocusClearResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const cleared = await withFocusLock(root, () => clearCurrentFocus(root));
    return { cleared };
  }

  async pruneDangling(workspaceRoot: string | null): Promise<FocusPruneDanglingResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return withFocusLock(root, async () => {
      const node = await readCurrentFocus(root, this.store);
      if (node === null) return { cleared: false };
      if (await nodeExists(root, node)) return { cleared: false };
      const cleared = await clearCurrentFocus(root);
      return { cleared };
    });
  }

  async relocate(
    workspaceRoot: string | null,
    args: FocusRelocateArgs,
  ): Promise<FocusRelocateResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return withFocusLock(root, async () => {
      const focused = await readCurrentFocus(root, this.store);
      const moved = await this.store.relocateKind<FocusNode>(root, 'focus', args.from, args.to);
      let repointed = false;
      if (focused !== null && isMirrorSubtree(focused.path, args.from)) {
        await repointCurrentFocus(root, remapSubtreeRel(focused.path, args.from, args.to));
        repointed = true;
      }
      return { moved: moved.length, repointed };
    });
  }

  async purgeNode(
    workspaceRoot: string | null,
    args: FocusPurgeNodeArgs,
  ): Promise<FocusPurgeNodeResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return withFocusLock(root, async () => {
      const focused = await readCurrentFocus(root, this.store);
      const removed = await this.store.purgeKind(root, 'focus', args.path);
      let cleared = false;
      if (focused !== null && isMirrorSubtree(focused.path, args.path)) {
        cleared = await clearCurrentFocus(root);
      }
      return { removed, cleared };
    });
  }

  private async patchFocusNode(root: string, node: FocusNode): Promise<FocusNode> {
    try {
      const written = await this.store.patch<FocusNode>(root, node.path, 'focus', (prev) =>
        prev && prev.kind === node.kind ? ({ ...prev, ...node } as FocusNode) : node,
      );
      return written ?? node;
    } catch (cause) {
      if (cause instanceof MirrorCorrupt) {
        throw new FocusCorrupt(node.path, { cause });
      }
      throw cause;
    }
  }
}

function buildNode(args: FocusSetArgs): FocusNode {
  if (args.kind === 'folder') {
    return {
      path: args.path,
      kind: 'folder',
      ...(args.viewport_center !== undefined && { viewport_center: args.viewport_center }),
      ...(args.zoom !== undefined && { zoom: args.zoom }),
    };
  }
  return {
    path: args.path,
    kind: 'file',
    ...(args.visible_lines !== undefined && { visible_lines: args.visible_lines }),
    ...(args.visible_blocks !== undefined && { visible_blocks: args.visible_blocks }),
    ...(args.cursor !== undefined && { cursor: args.cursor }),
  };
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (workspaceRoot === null) {
    throw new Error('No workspace bound. Register/use a workspace first.');
  }
  return workspaceRoot;
}

async function nodeExists(root: string, node: FocusNode): Promise<boolean> {
  try {
    const abs = await assertReadContained(root, join(root, node.path));
    const info = await stat(abs).catch((err: unknown) => {
      if (isENOENT(err)) return null;
      throw err;
    });
    if (info === null) return false;
    return node.kind === 'folder' ? info.isDirectory() : info.isFile();
  } catch {
    return false;
  }
}

async function currentFocusLink(
  workspaceRoot: string,
  opts?: { create?: boolean },
): Promise<string> {
  const bhDir = await assertWriteContained(workspaceRoot, join(workspaceRoot, '.bh'));
  if (opts?.create === true) {
    await mkdir(bhDir, { recursive: true });
  }
  return join(bhDir, 'current_focus.yaml');
}

function relTargetFor(path: string): string {
  return path === '' ? 'mirror/focus.yaml' : `mirror/${path}/focus.yaml`;
}

async function repointCurrentFocus(workspaceRoot: string, path: string): Promise<void> {
  const link = await currentFocusLink(workspaceRoot, { create: true });
  await unlink(link).catch(() => undefined);
  await symlink(relTargetFor(path), link);
}

async function clearCurrentFocus(workspaceRoot: string): Promise<boolean> {
  try {
    await unlink(await currentFocusLink(workspaceRoot));
    return true;
  } catch {
    return false;
  }
}

async function readCurrentFocus(
  workspaceRoot: string,
  store: YamlMirrorStore,
): Promise<FocusNode | null> {
  let link: string;
  try {
    link = await currentFocusLink(workspaceRoot);
  } catch {
    return null;
  }
  let target: string;
  try {
    target = await readlink(link);
  } catch {
    return null;
  }
  const bhDir = dirname(link);
  const rel = focusRelFromTarget(
    join(bhDir, 'mirror'),
    isAbsolute(target) ? target : join(bhDir, target),
  );
  if (rel === null) return null;
  try {
    return await store.read<FocusNode>(workspaceRoot, rel, 'focus');
  } catch (cause) {
    if (cause instanceof MirrorCorrupt) {
      throw new FocusCorrupt('<current_focus>', { cause });
    }
    return null;
  }
}

function focusRelFromTarget(mirrorRoot: string, target: string): string | null {
  const rel = relative(normalize(mirrorRoot), normalize(target));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  const parts = rel.split(sep).filter(Boolean);
  if (parts.at(-1) !== 'focus.yaml') return null;
  parts.pop();
  return parts.join('/');
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}
