import type {
  BadgeAddRefArgs,
  BadgeDeleteArgs,
  BadgeDeleteResult,
  BadgeFile,
  BadgeGetArgs,
  BadgeGetResult,
  BadgeListArgs,
  BadgeListResult,
  BadgeMarkOrphanArgs,
  BadgeMarkOrphanResult,
  BadgePruneDanglingResult,
  BadgeRemoveRefArgs,
  BadgeRenameArgs,
  BadgeRenameResult,
  BadgeRevisionResult,
  BadgeSetArgs,
} from '../common/badge.js';
import type { BadgeBackendProvider } from './badgeBackendProvider.js';

/**
 * Main-process badge service consumed by the explicit Badge IPC channel. The
 * mirror storage/provider is injected so badge operations stay behind the typed
 * workbench service boundary.
 */
export class BadgeMainService {
  constructor(private readonly backend: BadgeBackendProvider) {}

  get(workspaceRoot: string | null, args: BadgeGetArgs): Promise<BadgeGetResult> {
    return this.backend.get(workspaceRoot, args);
  }

  set(workspaceRoot: string | null, args: BadgeSetArgs): Promise<BadgeFile> {
    return this.backend.set(workspaceRoot, args);
  }

  list(workspaceRoot: string | null, args: BadgeListArgs = {}): Promise<BadgeListResult> {
    return this.backend.list(workspaceRoot, args);
  }

  delete(workspaceRoot: string | null, args: BadgeDeleteArgs): Promise<BadgeDeleteResult> {
    return this.backend.delete(workspaceRoot, args);
  }

  addRef(workspaceRoot: string | null, args: BadgeAddRefArgs): Promise<BadgeFile> {
    return this.backend.addRef(workspaceRoot, args);
  }

  removeRef(workspaceRoot: string | null, args: BadgeRemoveRefArgs): Promise<BadgeFile> {
    return this.backend.removeRef(workspaceRoot, args);
  }

  markOrphan(
    workspaceRoot: string | null,
    args: BadgeMarkOrphanArgs,
  ): Promise<BadgeMarkOrphanResult> {
    return this.backend.markOrphan(workspaceRoot, args);
  }

  pruneDangling(workspaceRoot: string | null): Promise<BadgePruneDanglingResult> {
    return this.backend.pruneDangling(workspaceRoot);
  }

  revision(workspaceRoot: string | null): Promise<BadgeRevisionResult> {
    return this.backend.revision(workspaceRoot);
  }

  rename(workspaceRoot: string | null, args: BadgeRenameArgs): Promise<BadgeRenameResult> {
    return this.backend.rename(workspaceRoot, args);
  }
}
