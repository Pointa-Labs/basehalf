import type {
  WorkspaceReadFileResult,
  WorkspaceWriteFileResult,
} from '../../../../platform/files/common/workspaceFiles.js';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type { WorkspaceService as PlatformWorkspaceService } from '../../../../platform/workspaces/common/workspaces.js';

type TextFileBackend = Pick<PlatformWorkspaceService, 'readFile' | 'writeFile'>;

export type TextFileReadResult = WorkspaceReadFileResult;
export type TextFileWriteResult = WorkspaceWriteFileResult;

export interface TextFileService {
  read(path: string): Promise<TextFileReadResult>;
  write(path: string, content: string): Promise<TextFileWriteResult>;
}

export function createTextFileService(backend: TextFileBackend): TextFileService {
  return {
    read: (path) => backend.readFile(path),
    write: (path, content) => backend.writeFile(path, content),
  };
}

export const textFileService = createTextFileService(workspaceService);
