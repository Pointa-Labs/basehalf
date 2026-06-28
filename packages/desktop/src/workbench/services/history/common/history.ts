export {
  RECENT_FILES_LIMIT,
  type RecentFilesMap,
  noteRecentFileOpened,
  parseRecentFilesMap,
  recentFilesForWorkspace,
  serializeRecentFilesMap,
  trimRecentFiles,
} from './recentFilesModel.js';

export interface HistoryService {
  noteOpenedFile(workspace: string, relPath: string): void;
  recentFilesFor(workspace: string): readonly string[];
}
