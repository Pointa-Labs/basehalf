import type {
  CanvasConnectArgs,
  CanvasDisconnectArgs,
  CanvasFile,
  CanvasGetArgs,
  CanvasGetResult,
  CanvasPurgeNodeArgs,
  CanvasPurgeNodeResult,
  CanvasReconnectArgs,
  CanvasRelocateArgs,
  CanvasRelocateResult,
  CanvasRemoveCardArgs,
  CanvasRemoveCardResult,
  CanvasRevisionResult,
  CanvasSetCardArgs,
  CanvasSetSizeArgs,
} from '../common/canvas.js';
import type { CanvasBackendProvider } from './canvasBackendProvider.js';

/**
 * Main-process canvas service consumed by explicit Canvas IPC channels. The
 * backing mirror store is injected so canvas orchestration stays behind the
 * typed workbench service boundary.
 */
export class CanvasMainService {
  constructor(private readonly backend: CanvasBackendProvider) {}

  get(workspaceRoot: string | null, args: CanvasGetArgs): Promise<CanvasGetResult> {
    return this.backend.get(workspaceRoot, args);
  }

  setCard(workspaceRoot: string | null, args: CanvasSetCardArgs): Promise<CanvasFile> {
    return this.backend.setCard(workspaceRoot, args);
  }

  removeCard(
    workspaceRoot: string | null,
    args: CanvasRemoveCardArgs,
  ): Promise<CanvasRemoveCardResult> {
    return this.backend.removeCard(workspaceRoot, args);
  }

  setSize(workspaceRoot: string | null, args: CanvasSetSizeArgs): Promise<CanvasFile> {
    return this.backend.setSize(workspaceRoot, args);
  }

  connect(workspaceRoot: string | null, args: CanvasConnectArgs): Promise<CanvasFile> {
    return this.backend.connect(workspaceRoot, args);
  }

  disconnect(workspaceRoot: string | null, args: CanvasDisconnectArgs): Promise<CanvasFile> {
    return this.backend.disconnect(workspaceRoot, args);
  }

  reconnect(workspaceRoot: string | null, args: CanvasReconnectArgs): Promise<CanvasFile> {
    return this.backend.reconnect(workspaceRoot, args);
  }

  revision(workspaceRoot: string | null): Promise<CanvasRevisionResult> {
    return this.backend.revision(workspaceRoot);
  }

  relocate(workspaceRoot: string | null, args: CanvasRelocateArgs): Promise<CanvasRelocateResult> {
    return this.backend.relocate(workspaceRoot, args);
  }

  purgeNode(
    workspaceRoot: string | null,
    args: CanvasPurgeNodeArgs,
  ): Promise<CanvasPurgeNodeResult> {
    return this.backend.purgeNode(workspaceRoot, args);
  }
}
