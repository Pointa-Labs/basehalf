import { workspaceFilesService } from '../../../../platform/files/browser/workspaceFilesService.js';
import type {
  WorkspaceReadFileResult,
  WorkspaceWriteFileResult,
} from '../../../../platform/files/common/workspaceFiles.js';
import type { WorkspaceFilesService as PlatformWorkspaceFilesService } from '../../../../platform/files/common/workspaceFiles.js';

type TextFileBackend = Pick<PlatformWorkspaceFilesService, 'readFile' | 'writeFile'>;

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

export const textFileService = createTextFileService(workspaceFilesService);
