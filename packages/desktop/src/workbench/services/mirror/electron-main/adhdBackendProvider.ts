import type {
  AdhdAddKeywordArgs,
  AdhdFile,
  AdhdGetResult,
  AdhdMarkReadArgs,
  AdhdMarkUnreadArgs,
  AdhdPurgeNodeArgs,
  AdhdPurgeNodeResult,
  AdhdRelocateArgs,
  AdhdRelocateResult,
  AdhdRemoveKeywordArgs,
  AdhdRevisionResult,
  AdhdSetArgs,
  LineRange,
} from '../common/adhd.js';
import { MirrorCorrupt, YamlMirrorStore, createKeyedMutex } from './yamlMirrorStore.js';

export interface AdhdBackendProvider {
  get(workspaceRoot: string | null, file: string): Promise<AdhdGetResult>;
  set(workspaceRoot: string | null, args: AdhdSetArgs): Promise<AdhdFile>;
  addKeyword(workspaceRoot: string | null, args: AdhdAddKeywordArgs): Promise<AdhdFile>;
  removeKeyword(
    workspaceRoot: string | null,
    args: AdhdRemoveKeywordArgs,
  ): Promise<AdhdFile | null>;
  markRead(workspaceRoot: string | null, args: AdhdMarkReadArgs): Promise<AdhdFile>;
  markUnread(workspaceRoot: string | null, args: AdhdMarkUnreadArgs): Promise<AdhdFile | null>;
  revision(workspaceRoot: string | null): Promise<AdhdRevisionResult>;
  relocate(workspaceRoot: string | null, args: AdhdRelocateArgs): Promise<AdhdRelocateResult>;
  purgeNode(workspaceRoot: string | null, args: AdhdPurgeNodeArgs): Promise<AdhdPurgeNodeResult>;
}

export class AdhdCorrupt extends Error {
  override readonly name = 'AdhdCorrupt';

  constructor(
    public readonly file: string,
    opts?: { cause?: unknown },
  ) {
    super(`Corrupt adhd.yaml for "${file}"`, opts);
  }
}

const withAdhdLock = createKeyedMutex();
const DEFAULT_STORE = new YamlMirrorStore();

/**
 * Desktop-native reading-aid backend for `<workspace>/.bh/mirror/<file>/adhd.yaml`.
 * This mirrors VS Code's pattern of keeping view/editor state behind a
 * workbench service instead of routing default UI state through a domain core.
 */
export class AdhdYamlBackendProvider implements AdhdBackendProvider {
  constructor(private readonly store: YamlMirrorStore = DEFAULT_STORE) {}

  async get(workspaceRoot: string | null, file: string): Promise<AdhdGetResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return this.read(root, file);
  }

  async set(workspaceRoot: string | null, args: AdhdSetArgs): Promise<AdhdFile> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const next = build(
      args.file,
      dedupe(args.highlight_keywords ?? []),
      normalizeRanges(args.read_paragraphs ?? []),
    );
    await withAdhdLock(root, () =>
      this.patch(root, args.file, () => (isEmpty(next) ? null : next)),
    );
    return next;
  }

  async addKeyword(workspaceRoot: string | null, args: AdhdAddKeywordArgs): Promise<AdhdFile> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const keyword = args.keyword.trim();
    if (keyword === '') throw new Error('adhd.addKeyword: keyword is empty');
    const next = await withAdhdLock(root, () =>
      this.patch(root, args.file, (current) => {
        const existing = current?.highlight_keywords ?? [];
        if (existing.includes(keyword)) return current ?? build(args.file, [keyword], undefined);
        return build(args.file, [...existing, keyword], current?.read_paragraphs);
      }),
    );
    return next as AdhdFile;
  }

  async removeKeyword(
    workspaceRoot: string | null,
    args: AdhdRemoveKeywordArgs,
  ): Promise<AdhdFile | null> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return withAdhdLock(root, () =>
      this.patch(root, args.file, (current) => {
        if (!current) return null;
        const next = build(
          args.file,
          (current.highlight_keywords ?? []).filter((keyword) => keyword !== args.keyword),
          current.read_paragraphs,
        );
        return isEmpty(next) ? null : next;
      }),
    );
  }

  async markRead(workspaceRoot: string | null, args: AdhdMarkReadArgs): Promise<AdhdFile> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const next = await withAdhdLock(root, () =>
      this.patch(root, args.file, (current) =>
        build(
          args.file,
          current?.highlight_keywords,
          mergeRange(current?.read_paragraphs ?? [], args.start, args.end),
        ),
      ),
    );
    return next as AdhdFile;
  }

  async markUnread(
    workspaceRoot: string | null,
    args: AdhdMarkUnreadArgs,
  ): Promise<AdhdFile | null> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return withAdhdLock(root, () =>
      this.patch(root, args.file, (current) => {
        if (!current) return null;
        const next = build(
          args.file,
          current.highlight_keywords,
          subtractRange(current.read_paragraphs ?? [], args.start, args.end),
        );
        return isEmpty(next) ? null : next;
      }),
    );
  }

  async revision(workspaceRoot: string | null): Promise<AdhdRevisionResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return this.store.revision(root, 'adhd');
  }

  async relocate(
    workspaceRoot: string | null,
    args: AdhdRelocateArgs,
  ): Promise<AdhdRelocateResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const moved = await withAdhdLock(root, () =>
      this.store.relocateKind<AdhdFile>(root, 'adhd', args.from, args.to),
    );
    return { moved: moved.length };
  }

  async purgeNode(
    workspaceRoot: string | null,
    args: AdhdPurgeNodeArgs,
  ): Promise<AdhdPurgeNodeResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const removed = await withAdhdLock(root, () => this.store.purgeKind(root, 'adhd', args.path));
    return { removed };
  }

  private async read(root: string, file: string): Promise<AdhdFile | null> {
    try {
      return await this.store.read<AdhdFile>(root, file, 'adhd');
    } catch (cause) {
      if (cause instanceof MirrorCorrupt) throw new AdhdCorrupt(file, { cause });
      throw cause;
    }
  }

  private async patch(
    root: string,
    file: string,
    patch: (current: AdhdFile | null) => AdhdFile | null,
  ): Promise<AdhdFile | null> {
    try {
      return await this.store.patch<AdhdFile>(root, file, 'adhd', patch);
    } catch (cause) {
      if (cause instanceof MirrorCorrupt) throw new AdhdCorrupt(file, { cause });
      throw cause;
    }
  }
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (workspaceRoot === null) {
    throw new Error('No workspace bound. Register/use a workspace first.');
  }
  return workspaceRoot;
}

function dedupe(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (trimmed !== '' && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

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

function isEmpty(file: AdhdFile): boolean {
  return (file.highlight_keywords?.length ?? 0) === 0 && (file.read_paragraphs?.length ?? 0) === 0;
}

function assertValidRange(start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`adhd: line range must be integers, got [${start}, ${end}]`);
  }
  if (start < 1) throw new Error(`adhd: line numbers are 1-based, got start=${start}`);
  if (end < start) throw new Error(`adhd: range end (${end}) is before start (${start})`);
}

function normalizeRanges(ranges: readonly LineRange[]): LineRange[] {
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2) {
      throw new Error(
        `adhd: read_paragraphs entries must be [start, end] pairs, got ${JSON.stringify(range)}`,
      );
    }
    assertValidRange(range[0], range[1]);
  }
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1] + 1) {
      if (end > last[1]) last[1] = end;
    } else {
      out.push([start, end]);
    }
  }
  return out;
}

function mergeRange(ranges: readonly LineRange[], start: number, end: number): LineRange[] {
  assertValidRange(start, end);
  return normalizeRanges([...ranges, [start, end]]);
}

function subtractRange(ranges: readonly LineRange[], start: number, end: number): LineRange[] {
  assertValidRange(start, end);
  const out: Array<[number, number]> = [];
  for (const [rangeStart, rangeEnd] of normalizeRanges(ranges)) {
    if (rangeEnd < start || rangeStart > end) {
      out.push([rangeStart, rangeEnd]);
      continue;
    }
    if (rangeStart < start) out.push([rangeStart, start - 1]);
    if (rangeEnd > end) out.push([end + 1, rangeEnd]);
  }
  return out;
}
