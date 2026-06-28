import type { WorkspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import { isWorkspacePathNotFoundError } from '../../../services/workspace/browser/workspaceErrors.js';
import type { GitScmService } from '../../scm/browser/gitScmService.js';

export const MAX_DIFF_CHARS = 2 * 1024 * 1024;
export const FILE_DIFF_TOO_LARGE_MESSAGE = 'File is too large to show a diff.';

export interface FileDiffOptions {
  readonly leftRef: string;
  readonly rightWorktree: boolean;
  readonly rightRef?: string;
  readonly originalPath?: string;
  readonly modifiedPath?: string;
  readonly context?: number;
  readonly ignoreWhitespace?: boolean;
}

export type FileDiffSourceSide =
  | {
      readonly kind: 'git';
      readonly path: string;
      readonly ref: string;
      readonly emptyWhenMissing?: boolean;
    }
  | {
      readonly kind: 'workspace';
      readonly path: string;
      readonly emptyWhenMissing?: boolean;
    };

export interface FileDiffSource {
  readonly original: FileDiffSourceSide;
  readonly modified: FileDiffSourceSide;
  readonly context?: number;
  readonly ignoreWhitespace?: boolean;
}

export interface ResolvedFileDiffSource {
  readonly original: string;
  readonly modified: string;
}

export interface FileDiffSourceProvider {
  provideFileDiffSource(path: string, options: FileDiffOptions): FileDiffSource;
}

export interface FileDiffSourceResolverServices {
  readonly git: Pick<GitScmService, 'show'>;
  readonly workspace: Pick<WorkspaceService, 'readFile'>;
}

export interface FileDiffSourceResolver {
  canHandleSource(source: FileDiffSource): boolean;
  resolveDiffSource(
    source: FileDiffSource,
    services: FileDiffSourceResolverServices,
  ): Promise<ResolvedFileDiffSource>;
}

export class GitFileDiffSourceProvider implements FileDiffSourceProvider {
  provideFileDiffSource(path: string, options: FileDiffOptions): FileDiffSource {
    const originalPath = options.originalPath ?? path;
    const modifiedPath = options.modifiedPath ?? path;
    return {
      original: {
        kind: 'git',
        path: originalPath,
        ref: options.leftRef,
        emptyWhenMissing: true,
      },
      modified: options.rightWorktree
        ? { kind: 'workspace', path: modifiedPath, emptyWhenMissing: true }
        : {
            kind: 'git',
            path: modifiedPath,
            ref: options.rightRef ?? '',
            emptyWhenMissing: true,
          },
      ...(options.context !== undefined ? { context: options.context } : {}),
      ...(options.ignoreWhitespace !== undefined
        ? { ignoreWhitespace: options.ignoreWhitespace }
        : {}),
    };
  }
}

export class GitFileDiffSourceResolver implements FileDiffSourceResolver {
  canHandleSource(source: FileDiffSource): boolean {
    return source.original.kind === 'git';
  }

  async resolveDiffSource(
    source: FileDiffSource,
    services: FileDiffSourceResolverServices,
  ): Promise<ResolvedFileDiffSource> {
    const [original, modified] = await Promise.all([
      readFileDiffSide(source.original, services),
      readFileDiffSide(source.modified, services),
    ]);

    if (original.length > MAX_DIFF_CHARS || modified.length > MAX_DIFF_CHARS) {
      throw new Error(FILE_DIFF_TOO_LARGE_MESSAGE);
    }

    return {
      original,
      modified,
    };
  }
}

export class FileDiffSourceResolverService {
  private readonly resolvers = new Set<FileDiffSourceResolver>();

  constructor(resolvers: readonly FileDiffSourceResolver[] = []) {
    for (const resolver of resolvers) {
      this.registerResolver(resolver);
    }
  }

  registerResolver(resolver: FileDiffSourceResolver): () => void {
    if (this.resolvers.has(resolver)) {
      throw new Error('Duplicate file diff source resolver');
    }
    this.resolvers.add(resolver);
    return () => this.resolvers.delete(resolver);
  }

  async resolve(
    source: FileDiffSource,
    services: FileDiffSourceResolverServices,
  ): Promise<ResolvedFileDiffSource | undefined> {
    for (const resolver of this.resolvers) {
      if (resolver.canHandleSource(source)) {
        return resolver.resolveDiffSource(source, services);
      }
    }
    return undefined;
  }
}

export const gitFileDiffSourceProvider = new GitFileDiffSourceProvider();
export const fileDiffSourceResolverService = new FileDiffSourceResolverService([
  new GitFileDiffSourceResolver(),
]);

export async function resolveFileDiffSource(
  source: FileDiffSource,
  services: FileDiffSourceResolverServices,
): Promise<ResolvedFileDiffSource> {
  const resolved = await fileDiffSourceResolverService.resolve(source, services);
  if (!resolved) {
    throw new Error(
      `No file diff source resolver for ${source.original.path} -> ${source.modified.path}`,
    );
  }
  return resolved;
}

async function readFileDiffSide(
  side: FileDiffSourceSide,
  services: FileDiffSourceResolverServices,
): Promise<string> {
  if (side.kind === 'git') {
    const content = await services.git.show(side.ref, side.path);
    if (content !== null) return content;
    if (side.emptyWhenMissing) return '';
    throw new Error(`Git object not found for ${side.ref}:${side.path}`);
  }

  try {
    const result = await services.workspace.readFile(side.path);
    return result.content ?? '';
  } catch (err) {
    if (side.emptyWhenMissing && isWorkspacePathNotFoundError(err)) {
      return '';
    }
    throw err;
  }
}
