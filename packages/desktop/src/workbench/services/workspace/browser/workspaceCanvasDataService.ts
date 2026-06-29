import type {
  WorkspaceReadFileArgs,
  WorkspaceReadFileResult,
} from '../../../../platform/files/common/workspaceFiles.js';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type {
  WorkspaceService as PlatformWorkspaceService,
  ViewportState,
  WorkspaceListCanvasResult,
} from '../../../../platform/workspaces/common/workspaces.js';

type WorkspaceCanvasDataBackend = Pick<
  PlatformWorkspaceService,
  'listCanvas' | 'listSupportedFiles' | 'readFile' | 'setViewport'
>;

export type WorkspaceCanvasViewportState = ViewportState;

export interface WorkspaceCanvasDataService {
  listCanvas(folder: string | null): Promise<WorkspaceListCanvasResult>;
  listSupportedFiles(folder: string | null): Promise<readonly string[]>;
  readFile(
    path: string,
    options?: Omit<WorkspaceReadFileArgs, 'path'>,
  ): Promise<WorkspaceReadFileResult>;
  setViewport(viewport: WorkspaceCanvasViewportState): Promise<void>;
}

export function createWorkspaceCanvasDataService(
  backend: WorkspaceCanvasDataBackend,
): WorkspaceCanvasDataService {
  return {
    listCanvas: (folder) => backend.listCanvas(folder),
    listSupportedFiles: (folder) => backend.listSupportedFiles(folder),
    readFile: (path, options = {}) => backend.readFile(path, options),
    setViewport: (viewport) => backend.setViewport(viewport),
  };
}

export const workspaceCanvasDataService = createWorkspaceCanvasDataService(workspaceService);
