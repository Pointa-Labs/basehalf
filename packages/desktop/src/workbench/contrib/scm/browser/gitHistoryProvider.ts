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
import { type GitScmService, gitScmService } from './gitScmService.js';

export interface GitHistoryOptions extends ScmHistoryOptions {
  readonly all?: boolean;
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

export class GitHistoryProvider implements ScmHistoryProvider, GitHistoryRawSource {
  constructor(private readonly git: GitHistoryProviderGit) {}

  async provideGitRefs(args: GitRefsArgs = {}): Promise<readonly GitRefInfo[]> {
    const result = await this.git.refs(args);
    return result.refs;
  }

  async provideGitCommits(options: GitHistoryOptions): Promise<readonly GitCommit[]> {
    const result = await this.git.log(gitLogArgsForHistoryOptions(options));
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

    return {
      historyItemRef: gitRefOrHistoryItemRef(historyItemRef),
      historyItemRemoteRef: gitRefOrHistoryItemRef(historyItemRemoteRef),
    };
  }

  async provideHistoryItemRefs(
    historyItemRefs?: readonly string[],
  ): Promise<readonly ScmHistoryItemRef[]> {
    const refs = await this.provideGitRefs({ includeRemote: true, includeTags: true });
    const wanted = historyItemRefs === undefined ? null : new Set(historyItemRefs);
    return refs
      .filter((ref) => wanted === null || gitRefMatchesWanted(ref, wanted))
      .map(gitRefToHistoryItemRef);
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
    const ref = await this.git.mergeBase(historyItemRefs);
    return ref ?? undefined;
  }
}

export const gitHistoryProvider = new GitHistoryProvider(gitScmService);

export function gitHistoryOptionsForScmOptions(options: ScmHistoryOptions): GitHistoryOptions {
  return options;
}

export function gitLogArgsForHistoryOptions(options: GitHistoryOptions): GitLogArgs {
  const refs = options.historyItemRefs?.filter((ref) => ref !== '');
  if (options.all === true) {
    return {
      all: true,
      maxCount: options.limit,
      skip: options.skip,
    };
  }
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
      ...commit.refs.map(gitDecorationRefToHistoryItemRef),
      ...commit.tags.map((tag) => ({
        id: `refs/tags/${tag}`,
        name: tag,
        category: 'tag' as const,
      })),
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

function gitRefMatchesWanted(ref: GitRefInfo, wanted: ReadonlySet<string>): boolean {
  if (wanted.has(ref.id)) return true;
  if (ref.commit !== undefined && wanted.has(ref.commit)) return true;
  return ![...wanted].some((value) => value.startsWith('refs/')) && wanted.has(ref.name);
}
