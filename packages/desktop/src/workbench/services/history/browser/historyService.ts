/**
 * Workbench history service, scoped per workspace.
 *
 * VS Code keeps editor/workbench history behind
 * workbench/services/history/browser/historyService.ts. BaseHalf's current
 * history surface is intentionally smaller: we track recently opened files per
 * workspace so Quick Access can rank files by actual use.
 *
 * Stored shape: { [workspaceName]: { [relPath]: epochMs } }. Trimmed to
 * RECENT_FILES_LIMIT entries per workspace on every write so the log doesn't
 * grow unbounded.
 */

import type { HistoryService } from '../common/history.js';
import {
  type RecentFilesMap,
  noteRecentFileOpened,
  parseRecentFilesMap,
  recentFilesForWorkspace,
  serializeRecentFilesMap,
} from '../common/recentFilesModel.js';

const STORAGE_KEY = 'bh:recent-files';

export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type HistoryStorageProvider = () => HistoryStorage;

export class LocalStorageHistoryService implements HistoryService {
  constructor(
    private readonly storage: HistoryStorageProvider = () => localStorage,
    private readonly storageKey = STORAGE_KEY,
  ) {}

  noteOpenedFile(workspace: string, relPath: string): void {
    this.write(noteRecentFileOpened(this.read(), workspace, relPath));
  }

  recentFilesFor(workspace: string): readonly string[] {
    return recentFilesForWorkspace(this.read(), workspace);
  }

  private read(): RecentFilesMap {
    try {
      return parseRecentFilesMap(this.storage().getItem(this.storageKey));
    } catch {
      return {};
    }
  }

  private write(map: RecentFilesMap): void {
    try {
      this.storage().setItem(this.storageKey, serializeRecentFilesMap(map));
    } catch {
      // localStorage unavailable / quota exceeded: history is helpful, not
      // load-bearing.
    }
  }
}

export const historyService: HistoryService = new LocalStorageHistoryService();
