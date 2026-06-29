import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type {
  WorkspaceService as PlatformWorkspaceService,
  WorkspaceReadFileResult,
  WorkspaceWriteFileResult,
} from '../../../../platform/workspaces/common/workspaces.js';

type TextFileBackend = Pick<PlatformWorkspaceService, 'readFile' | 'writeFile'>;

export interface TextFileService {
  read(path: string): Promise<WorkspaceReadFileResult>;
  write(path: string, content: string): Promise<WorkspaceWriteFileResult>;
}

export function createTextFileService(backend: TextFileBackend): TextFileService {
  return {
    read: (path) => backend.readFile(path),
    write: (path, content) => backend.writeFile(path, content),
  };
}

export const textFileService = createTextFileService(workspaceService);
