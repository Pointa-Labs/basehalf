import type { GitError } from './gitErrors.js';
import type { GitRemoteInfo, GitStatusResult } from './gitTypes.js';

export interface PushErrorRepository {
  readonly root: string | null;
  readonly status: GitStatusResult | null;
}

export interface PushErrorHandler {
  handlePushError(
    repository: PushErrorRepository,
    remote: GitRemoteInfo,
    refspec: string,
    error: GitError,
  ): Promise<boolean>;
}

export interface PushErrorHandlerRegistry {
  registerPushErrorHandler(handler: PushErrorHandler): () => void;
  getPushErrorHandlers(): readonly PushErrorHandler[];
}
