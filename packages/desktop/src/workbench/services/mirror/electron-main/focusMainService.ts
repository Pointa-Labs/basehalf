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
import type { FocusBackendProvider } from './focusBackendProvider.js';

/**
 * Main-process focus service consumed by the explicit Focus IPC channel. The
 * concrete mirror backend is injected, keeping renderer/workbench focus state
 * behind the typed workbench service boundary.
 */
export class FocusMainService {
  constructor(private readonly backend: FocusBackendProvider) {}

  set(workspaceRoot: string | null, args: FocusSetArgs): Promise<FocusNode> {
    return this.backend.set(workspaceRoot, args);
  }

  get(workspaceRoot: string | null): Promise<FocusGetResult> {
    return this.backend.get(workspaceRoot);
  }

  clear(workspaceRoot: string | null): Promise<FocusClearResult> {
    return this.backend.clear(workspaceRoot);
  }

  pruneDangling(workspaceRoot: string | null): Promise<FocusPruneDanglingResult> {
    return this.backend.pruneDangling(workspaceRoot);
  }

  relocate(workspaceRoot: string | null, args: FocusRelocateArgs): Promise<FocusRelocateResult> {
    return this.backend.relocate(workspaceRoot, args);
  }

  purgeNode(workspaceRoot: string | null, args: FocusPurgeNodeArgs): Promise<FocusPurgeNodeResult> {
    return this.backend.purgeNode(workspaceRoot, args);
  }
}
