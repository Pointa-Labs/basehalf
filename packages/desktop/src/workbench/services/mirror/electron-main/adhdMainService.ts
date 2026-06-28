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
} from '../common/adhd.js';
import type { AdhdBackendProvider } from './adhdBackendProvider.js';

/**
 * Main-process ADHD reading-aid service consumed by explicit IPC channels. The
 * mirror backend is injected so reading-aid state is not coupled to core.
 */
export class AdhdMainService {
  constructor(private readonly backend: AdhdBackendProvider) {}

  get(workspaceRoot: string | null, file: string): Promise<AdhdGetResult> {
    return this.backend.get(workspaceRoot, file);
  }

  set(workspaceRoot: string | null, args: AdhdSetArgs): Promise<AdhdFile> {
    return this.backend.set(workspaceRoot, args);
  }

  addKeyword(workspaceRoot: string | null, args: AdhdAddKeywordArgs): Promise<AdhdFile> {
    return this.backend.addKeyword(workspaceRoot, args);
  }

  removeKeyword(
    workspaceRoot: string | null,
    args: AdhdRemoveKeywordArgs,
  ): Promise<AdhdFile | null> {
    return this.backend.removeKeyword(workspaceRoot, args);
  }

  markRead(workspaceRoot: string | null, args: AdhdMarkReadArgs): Promise<AdhdFile> {
    return this.backend.markRead(workspaceRoot, args);
  }

  markUnread(workspaceRoot: string | null, args: AdhdMarkUnreadArgs): Promise<AdhdFile | null> {
    return this.backend.markUnread(workspaceRoot, args);
  }

  revision(workspaceRoot: string | null): Promise<AdhdRevisionResult> {
    return this.backend.revision(workspaceRoot);
  }

  relocate(workspaceRoot: string | null, args: AdhdRelocateArgs): Promise<AdhdRelocateResult> {
    return this.backend.relocate(workspaceRoot, args);
  }

  purgeNode(workspaceRoot: string | null, args: AdhdPurgeNodeArgs): Promise<AdhdPurgeNodeResult> {
    return this.backend.purgeNode(workspaceRoot, args);
  }
}
