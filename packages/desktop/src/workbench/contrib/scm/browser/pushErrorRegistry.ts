import type { GitError, GitRemoteInfo } from '../common/git.js';
import type {
  PushErrorHandler,
  PushErrorHandlerRegistry as PushErrorHandlerRegistryLike,
  PushErrorRepository,
} from '../common/pushError.js';

export class PushErrorHandlerRegistry implements PushErrorHandlerRegistryLike {
  private readonly handlers = new Set<PushErrorHandler>();

  registerPushErrorHandler(handler: PushErrorHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  getPushErrorHandlers(): readonly PushErrorHandler[] {
    return [...this.handlers];
  }
}

export const pushErrorHandlerRegistry = new PushErrorHandlerRegistry();

export function registerPushErrorHandler(
  handler: PushErrorHandler,
  registry: PushErrorHandlerRegistryLike = pushErrorHandlerRegistry,
): () => void {
  return registry.registerPushErrorHandler(handler);
}

export async function runPushErrorHandlers(
  registry: Pick<PushErrorHandlerRegistryLike, 'getPushErrorHandlers'>,
  repository: PushErrorRepository,
  remote: GitRemoteInfo,
  refspec: string,
  error: GitError,
): Promise<boolean> {
  for (const handler of registry.getPushErrorHandlers()) {
    if (await handler.handlePushError(repository, remote, refspec, error)) {
      return true;
    }
  }

  return false;
}
