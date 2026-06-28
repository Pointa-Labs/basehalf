import type {
  CommandPaletteFileEntry,
  CommandPaletteGitCommit,
  CommandPaletteGitRefInfo,
} from '../../common/quickaccess/commandPaletteModel.js';
import type { CommandPaletteSearchHit } from './commandPaletteProviders.js';

export const COMMAND_PALETTE_CONTENT_QUERY_MIN_LENGTH = 3;
export const COMMAND_PALETTE_CONTENT_SEARCH_MAX_FILES = 8;
export const COMMAND_PALETTE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE = 1;
export const COMMAND_PALETTE_GIT_LOG_MAX_COUNT = 60;

export interface CommandPaletteWorkspaceFileProvider {
  listSupportedFiles(folder: string | null): Promise<readonly string[]>;
}

export interface CommandPaletteBadgeProvider {
  list(): Promise<readonly { readonly path: string; readonly description?: string }[]>;
}

export interface CommandPaletteSearchProvider {
  query(args: {
    readonly query: string;
    readonly maxFiles: number;
    readonly maxMatchesPerFile: number;
  }): Promise<{ readonly hits: readonly CommandPaletteSearchHit[] }>;
}

export interface CommandPaletteGitProvider {
  status(): Promise<{ readonly isRepo: boolean }>;
  refs(args: { readonly includeRemote: boolean }): Promise<{
    readonly refs: readonly CommandPaletteGitRefInfo[];
  }>;
  log(args: { readonly maxCount: number }): Promise<{
    readonly commits: readonly CommandPaletteGitCommit[];
  }>;
}

export interface CommandPaletteFilesProviderResult {
  readonly files: readonly CommandPaletteFileEntry[];
  readonly filesWorkspace: string | null;
}

export interface CommandPaletteContentSearchProviderResult {
  readonly contentHits: readonly CommandPaletteSearchHit[];
  readonly hitsQuery: string;
  readonly hitsWorkspace: string | null;
}

export interface CommandPaletteGitProviderResult {
  readonly gitRepo: boolean;
  readonly gitBranches: readonly CommandPaletteGitRefInfo[];
  readonly gitCommits: readonly CommandPaletteGitCommit[];
  readonly gitWorkspace: string | null;
}

export const emptyCommandPaletteFiles = (): CommandPaletteFilesProviderResult => ({
  files: [],
  filesWorkspace: null,
});

export const emptyCommandPaletteContentSearch = (): CommandPaletteContentSearchProviderResult => ({
  contentHits: [],
  hitsQuery: '',
  hitsWorkspace: null,
});

export const emptyCommandPaletteGitState = (): CommandPaletteGitProviderResult => ({
  gitRepo: false,
  gitBranches: [],
  gitCommits: [],
  gitWorkspace: null,
});

export async function provideCommandPaletteFiles(args: {
  readonly current: string | null;
  readonly workspace: CommandPaletteWorkspaceFileProvider;
  readonly badges: CommandPaletteBadgeProvider;
}): Promise<CommandPaletteFilesProviderResult> {
  if (args.current === null) return emptyCommandPaletteFiles();

  const [files, badges] = await Promise.all([
    args.workspace.listSupportedFiles(null),
    args.badges.list(),
  ]);
  const prompts = new Map(
    badges
      .filter((badge) => badge.description !== undefined)
      .map((badge) => [badge.path, badge.description as string]),
  );

  return {
    files: files.map((file) => {
      const prompt = prompts.get(file);
      return prompt !== undefined ? { file, prompt } : { file };
    }),
    filesWorkspace: args.current,
  };
}

export async function provideCommandPaletteContentSearch(args: {
  readonly current: string | null;
  readonly query: string;
  readonly search: CommandPaletteSearchProvider;
}): Promise<CommandPaletteContentSearchProviderResult> {
  const q = args.query.trim();
  if (args.current === null || q.length < COMMAND_PALETTE_CONTENT_QUERY_MIN_LENGTH) {
    return emptyCommandPaletteContentSearch();
  }

  const result = await args.search.query({
    query: q,
    maxFiles: COMMAND_PALETTE_CONTENT_SEARCH_MAX_FILES,
    maxMatchesPerFile: COMMAND_PALETTE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE,
  });

  return {
    contentHits: result.hits,
    hitsQuery: q,
    hitsWorkspace: args.current,
  };
}

export async function provideCommandPaletteGitState(args: {
  readonly current: string | null;
  readonly git: CommandPaletteGitProvider;
}): Promise<CommandPaletteGitProviderResult> {
  if (args.current === null) return emptyCommandPaletteGitState();

  const status = await args.git.status();
  if (!status.isRepo) {
    return {
      gitRepo: false,
      gitBranches: [],
      gitCommits: [],
      gitWorkspace: args.current,
    };
  }

  const [branches, log] = await Promise.all([
    args.git.refs({ includeRemote: true }),
    args.git.log({ maxCount: COMMAND_PALETTE_GIT_LOG_MAX_COUNT }),
  ]);

  return {
    gitRepo: true,
    gitBranches: branches.refs.filter((ref) => ref.type === 'head' || ref.type === 'remoteHead'),
    gitCommits: log.commits,
    gitWorkspace: args.current,
  };
}
