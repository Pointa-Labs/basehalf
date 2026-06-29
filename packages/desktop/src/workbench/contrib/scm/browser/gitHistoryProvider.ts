import type {
  GitCommit,
  GitCommitFile,
  GitLogArgs,
  GitRefInfo,
  GitRefsArgs,
} from '../common/git.js';
import type {
  ScmCurrentHistoryItemRefs,
  ScmHistoryItem,
  ScmHistoryItemChange,
  ScmHistoryItemRef,
  ScmHistoryOptions,
  ScmHistoryProvider,
} from '../common/history.js';
import type {
  ScmHistoryAvatarQuery,
  ScmHistoryItemCommand,
  ScmHistoryItemDetailsProviderRegistry,
  ScmHistoryRepository,
} from '../common/historyItemDetails.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import {
  provideScmHistoryItemAvatar,
  provideScmHistoryItemHoverCommands,
  provideScmHistoryItemMessageLinks,
  scmHistoryItemDetailsProviderRegistry,
} from './historyItemDetailsProviderRegistry.js';

export interface GitHistoryOptions extends ScmHistoryOptions {
  readonly maxParents?: number;
}

export interface GitHistoryRawSource {
  provideCurrentHistoryItemRefs(): Promise<ScmCurrentHistoryItemRefs>;
  provideGitRefs(args?: GitRefsArgs): Promise<readonly GitRefInfo[]>;
  provideGitCommits(options: GitHistoryOptions): Promise<readonly GitCommit[]>;
}

type GitHistoryProviderGit = Pick<
  GitScmService,
  'status' | 'refs' | 'log' | 'commitFiles' | 'mergeBase'
>;

export interface GitHistoryProviderOptions {
  readonly historyItemDetailsRegistry?: Pick<
    ScmHistoryItemDetailsProviderRegistry,
    'getScmHistoryItemDetailsProviders'
  >;
  readonly repository?: ScmHistoryRepository;
}

export class GitHistoryProvider implements ScmHistoryProvider, GitHistoryRawSource {
  private readonly historyItemDetailsRegistry: Pick<
    ScmHistoryItemDetailsProviderRegistry,
    'getScmHistoryItemDetailsProviders'
  >;
  private readonly repository: ScmHistoryRepository;

  constructor(
    private readonly git: GitHistoryProviderGit,
    options: GitHistoryProviderOptions = {},
  ) {
    this.historyItemDetailsRegistry =
      options.historyItemDetailsRegistry ?? scmHistoryItemDetailsProviderRegistry;
    this.repository = options.repository ?? { root: null };
  }

  async provideGitRefs(args: GitRefsArgs = {}): Promise<readonly GitRefInfo[]> {
    const result = await this.git.refs(args);
    return result.refs;
  }

  async provideGitCommits(options: GitHistoryOptions): Promise<readonly GitCommit[]> {
    const result = await this.git.log(
      gitLogArgsForHistoryOptions(await this.withNormalizedHistoryItemRefs(options)),
    );
    return result.commits;
  }

  async provideCurrentHistoryItemRefs(): Promise<ScmCurrentHistoryItemRefs> {
    const [status, refs] = await Promise.all([
      this.git.status(),
      this.provideGitRefs({ includeRemote: true, includeTags: true }),
    ]);
    if (!status.isRepo) return {};

    if (status.detached || status.branch === null) {
      return { historyItemRef: { id: 'HEAD', name: 'HEAD', category: 'other' } };
    }

    const historyItemRef =
      findGitRefById(refs, `refs/heads/${status.branch}`) ??
      findGitRefByNameAndType(refs, status.branch, 'head') ??
      ({ id: `refs/heads/${status.branch}`, name: status.branch, category: 'branch' } as const);
    const historyItemRemoteRef =
      status.upstream === null
        ? undefined
        : (findGitRefById(refs, `refs/remotes/${status.upstream}`) ??
          findGitRefById(refs, `refs/heads/${status.upstream}`));
    const historyItemBaseRef = findBaseHistoryItemRef({
      refs,
      currentBranch: status.branch,
      upstream: status.upstream,
      currentRef: historyItemRef,
      remoteRef: historyItemRemoteRef,
    });

    return {
      historyItemRef: gitRefOrHistoryItemRef(historyItemRef),
      historyItemRemoteRef: gitRefOrHistoryItemRef(historyItemRemoteRef),
      historyItemBaseRef: gitRefOrHistoryItemRef(historyItemBaseRef),
    };
  }

  async provideHistoryItemRefs(
    historyItemRefs?: readonly string[],
  ): Promise<readonly ScmHistoryItemRef[]> {
    const refs = await this.provideGitRefs({ includeRemote: true, includeTags: true });
    const wanted =
      historyItemRefs === undefined
        ? null
        : new Set(normalizeGitHistoryItemRefs(historyItemRefs, refs));
    return groupGitHistoryRefs(
      refs
        .filter((ref) => wanted === null || gitRefMatchesWanted(ref, wanted))
        .filter((ref) => !isRemoteHeadRef(ref.id) && !isRemoteHeadRef(ref.name)),
    ).map(gitRefToHistoryItemRef);
  }

  async provideHistoryItems(options: ScmHistoryOptions): Promise<readonly ScmHistoryItem[]> {
    const commits = await this.provideGitCommits(gitHistoryOptionsForScmOptions(options));
    return commits.map(gitCommitToHistoryItem);
  }

  async provideHistoryItemChanges(
    historyItemId: string,
    historyItemParentId?: string,
  ): Promise<readonly ScmHistoryItemChange[]> {
    const files = await this.git.commitFiles(historyItemId, historyItemParentId);
    return files.map(gitCommitFileToHistoryItemChange);
  }

  async resolveHistoryItem(historyItemId: string): Promise<ScmHistoryItem | undefined> {
    const result = await this.git.log({ ref: historyItemId, maxCount: 1 });
    const commit = result.commits[0];
    return commit === undefined ? undefined : gitCommitToHistoryItem(commit);
  }

  async resolveHistoryItemRefsCommonAncestor(
    historyItemRefs: readonly string[],
  ): Promise<string | undefined> {
    if (historyItemRefs.length === 0) return undefined;

    const normalized = await this.normalizeHistoryItemRefs(historyItemRefs);
    if (normalized.length === 1) {
      const currentRefs = await this.provideCurrentHistoryItemRefs();
      const currentRef = currentRefs.historyItemRef;
      if (currentRef !== undefined && historyItemRefMatches(currentRef, historyItemRefs[0] ?? '')) {
        const remoteRef = currentRefs.historyItemRemoteRef;
        if (remoteRef !== undefined) {
          const remoteBase = await this.git.mergeBase([normalized[0] ?? '', remoteRef.id]);
          if (remoteBase !== null) return remoteBase;
        }

        const baseRef = currentRefs.historyItemBaseRef;
        if (baseRef !== undefined) {
          const base = await this.git.mergeBase([normalized[0] ?? '', baseRef.id]);
          if (base !== null) return base;
        }

        const firstCommit = await this.firstHistoryItemRefCommit(normalized[0] ?? 'HEAD');
        if (firstCommit !== undefined) return firstCommit;
      }
    }

    const ref = await this.git.mergeBase(normalized);
    return ref ?? undefined;
  }

  async provideHistoryItemAvatar(
    query: ScmHistoryAvatarQuery,
  ): Promise<Map<string, string | undefined> | undefined> {
    return provideScmHistoryItemAvatar(this.historyItemDetailsRegistry, this.repository, query);
  }

  async provideHistoryItemHoverCommands(): Promise<readonly ScmHistoryItemCommand[] | undefined> {
    return provideScmHistoryItemHoverCommands(this.historyItemDetailsRegistry, this.repository);
  }

  async provideHistoryItemMessageLinks(message: string): Promise<string | undefined> {
    return provideScmHistoryItemMessageLinks(
      this.historyItemDetailsRegistry,
      this.repository,
      message,
    );
  }

  private async withNormalizedHistoryItemRefs(
    options: GitHistoryOptions,
  ): Promise<GitHistoryOptions> {
    if (options.historyItemRefs === undefined) return options;
    return {
      ...options,
      historyItemRefs: await this.normalizeHistoryItemRefs(options.historyItemRefs),
    };
  }

  private async normalizeHistoryItemRefs(
    historyItemRefs: readonly string[],
  ): Promise<readonly string[]> {
    const values = historyItemRefs.filter((ref) => ref !== '');
    if (values.length === 0) return values;
    const refs = await this.provideGitRefs({ includeRemote: true, includeTags: true });
    const normalized = normalizeGitHistoryItemRefs(values, refs, { dropUnknown: true });
    return normalized.length > 0 ? normalized : ['HEAD'];
  }

  private async firstHistoryItemRefCommit(ref: string): Promise<string | undefined> {
    const result = await this.git.log({ ref, maxCount: 1, maxParents: 0 });
    return result.commits[0]?.hash;
  }
}

export const gitHistoryProvider = new GitHistoryProvider(gitScmService);

export function gitHistoryOptionsForScmOptions(options: ScmHistoryOptions): GitHistoryOptions {
  return options;
}

export function gitLogArgsForHistoryOptions(options: GitHistoryOptions): GitLogArgs {
  const refs = options.historyItemRefs?.filter((ref) => ref !== '');
  if ((refs?.length ?? 0) > 1) {
    return {
      refNames: refs,
      maxCount: options.limit,
      skip: options.skip,
    };
  }
  return {
    ref: refs?.[0] ?? 'HEAD',
    maxCount: options.limit,
    ...(options.maxParents !== undefined && { maxParents: options.maxParents }),
    skip: options.skip,
  };
}

export function gitRefToHistoryItemRef(ref: GitRefInfo): ScmHistoryItemRef {
  return {
    id: ref.id,
    name: ref.name,
    revision: ref.commit,
    category: gitRefCategory(ref),
    description: ref.current ? 'current' : undefined,
  };
}

export function gitCommitToHistoryItem(commit: GitCommit): ScmHistoryItem {
  const references = [
    ...commit.refs.filter((ref) => !isRemoteHeadRef(ref)).map(gitDecorationRefToHistoryItemRef),
    ...commit.tags.map((tag) => ({
      id: `refs/tags/${tag}`,
      name: tag,
      category: 'tag' as const,
    })),
  ].sort(compareHistoryItemRef);

  return {
    id: commit.hash,
    parentIds: commit.parents,
    subject: commit.subject,
    message: commit.body === '' ? commit.subject : `${commit.subject}\n\n${commit.body}`,
    displayId: commit.shortHash,
    author: commit.author.name,
    authorEmail: commit.author.email,
    timestamp: Date.parse(commit.author.date),
    references: [
      ...(commit.head ? [{ id: 'HEAD', name: 'HEAD', category: 'other' as const }] : []),
      ...references,
    ],
  };
}

function gitDecorationRefToHistoryItemRef(ref: string): ScmHistoryItemRef {
  if (ref.startsWith('refs/heads/')) {
    return { id: ref, name: ref.slice('refs/heads/'.length), category: 'branch' };
  }
  if (ref.startsWith('refs/remotes/')) {
    return { id: ref, name: ref.slice('refs/remotes/'.length), category: 'remote' };
  }
  if (ref.startsWith('refs/tags/')) {
    return { id: ref, name: ref.slice('refs/tags/'.length), category: 'tag' };
  }
  if (ref.includes('/')) {
    return { id: `refs/remotes/${ref}`, name: ref, category: 'remote' };
  }
  return { id: `refs/heads/${ref}`, name: ref, category: 'branch' };
}

export function gitCommitFileToHistoryItemChange(file: GitCommitFile): ScmHistoryItemChange {
  return {
    path: file.path,
    status: file.status,
    originalPath: file.orig,
  };
}

function gitRefCategory(ref: GitRefInfo): ScmHistoryItemRef['category'] {
  if (ref.type === 'head') return 'branch';
  if (ref.type === 'remoteHead') return 'remote';
  if (ref.type === 'tag') return 'tag';
  return 'other';
}

function groupGitHistoryRefs(refs: readonly GitRefInfo[]): readonly GitRefInfo[] {
  const branches: GitRefInfo[] = [];
  const remoteBranches: GitRefInfo[] = [];
  const tags: GitRefInfo[] = [];
  const other: GitRefInfo[] = [];

  for (const ref of refs) {
    if (ref.type === 'head') branches.push(ref);
    else if (ref.type === 'remoteHead') remoteBranches.push(ref);
    else if (ref.type === 'tag') tags.push(ref);
    else other.push(ref);
  }

  return [...branches, ...remoteBranches, ...tags, ...other];
}

function compareHistoryItemRef(a: ScmHistoryItemRef, b: ScmHistoryItemRef): number {
  const order = (ref: ScmHistoryItemRef): number => {
    if (ref.id.startsWith('refs/heads/')) return 1;
    if (ref.id.startsWith('refs/remotes/')) return 2;
    if (ref.id.startsWith('refs/tags/')) return 3;
    return 99;
  };
  const orderDelta = order(a) - order(b);
  return orderDelta === 0 ? a.name.localeCompare(b.name) : orderDelta;
}

function isRemoteHeadRef(ref: string): boolean {
  return /^refs\/remotes\/[^/]+\/HEAD$/.test(ref) || /^[^/]+\/HEAD$/.test(ref);
}

function gitRefOrHistoryItemRef(
  ref: GitRefInfo | ScmHistoryItemRef | undefined,
): ScmHistoryItemRef | undefined {
  if (ref === undefined) return undefined;
  if ('type' in ref) return gitRefToHistoryItemRef(ref);
  return ref;
}

function findGitRefById(refs: readonly GitRefInfo[], id: string): GitRefInfo | undefined {
  return refs.find((ref) => ref.id === id);
}

function findGitRefByNameAndType(
  refs: readonly GitRefInfo[],
  name: string,
  type: GitRefInfo['type'],
): GitRefInfo | undefined {
  return refs.find((ref) => ref.name === name && ref.type === type);
}

function findBaseHistoryItemRef({
  refs,
  currentBranch,
  upstream,
  currentRef,
  remoteRef,
}: {
  readonly refs: readonly GitRefInfo[];
  readonly currentBranch: string;
  readonly upstream: string | null;
  readonly currentRef: GitRefInfo | ScmHistoryItemRef;
  readonly remoteRef: GitRefInfo | undefined;
}): GitRefInfo | undefined {
  const preferred = ['origin/main', 'origin/master', 'upstream/main', 'upstream/master'];
  const fallback = refs.find(
    (ref) =>
      ref.type === 'remoteHead' &&
      ref.name !== upstream &&
      ref.name !== currentBranch &&
      ref.id !== currentRef.id &&
      ref.id !== remoteRef?.id,
  );
  const base =
    preferred
      .map((name) => findGitRefById(refs, `refs/remotes/${name}`))
      .find(
        (ref) =>
          ref !== undefined &&
          ref.name !== upstream &&
          ref.id !== currentRef.id &&
          ref.id !== remoteRef?.id,
      ) ?? fallback;
  const currentRevision = 'type' in currentRef ? currentRef.commit : currentRef.revision;
  if (base?.commit !== undefined && base.commit === currentRevision) return undefined;
  if (base?.commit !== undefined && base.commit === remoteRef?.commit) return undefined;
  return base;
}

export function normalizeGitHistoryItemRefs(
  historyItemRefs: readonly string[],
  refs: readonly GitRefInfo[],
  options: { readonly dropUnknown?: boolean } = {},
): readonly string[] {
  const normalized = historyItemRefs
    .map((ref) => normalizeGitHistoryItemRef(ref, refs, options))
    .filter((ref): ref is string => ref !== undefined);
  const seen = new Set<string>();
  return normalized.filter((ref) => {
    if (seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
}

function normalizeGitHistoryItemRef(
  ref: string,
  refs: readonly GitRefInfo[],
  options: { readonly dropUnknown?: boolean },
): string | undefined {
  const value = ref.trim();
  if (value === '') return options.dropUnknown === true ? undefined : value;
  if (value === 'HEAD') return value;

  const exact = findGitRefById(refs, value);
  if (exact !== undefined) return exact.id;

  const byName = refs.filter((candidate) => candidate.name === value);
  if (byName.length === 1) return byName[0]?.id ?? value;
  if (byName.length > 1) {
    const preferred =
      byName.find(
        (candidate) => candidate.type === (value.includes('/') ? 'remoteHead' : 'head'),
      ) ??
      byName.find((candidate) => candidate.type === 'head') ??
      byName[0];
    if (preferred !== undefined) return preferred.id;
  }

  const byCommit = refs.find((candidate) => candidate.commit === value);
  if (byCommit !== undefined) return byCommit.commit ?? byCommit.id;

  if (isExplicitGitRevision(value)) return value;

  return options.dropUnknown === true ? undefined : value;
}

function isExplicitGitRevision(ref: string): boolean {
  return isGitObjectId(ref) || /(?:\.\.|\^|~|@\{)/.test(ref);
}

function isGitObjectId(ref: string): boolean {
  return /^[0-9a-f]{7,64}$/i.test(ref);
}

function historyItemRefMatches(ref: ScmHistoryItemRef, value: string): boolean {
  return ref.id === value || ref.name === value || ref.revision === value;
}

function gitRefMatchesWanted(ref: GitRefInfo, wanted: ReadonlySet<string>): boolean {
  if (wanted.has(ref.id)) return true;
  if (ref.commit !== undefined && wanted.has(ref.commit)) return true;
  return false;
}
