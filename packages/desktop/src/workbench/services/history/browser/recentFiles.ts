/**
 * Recent-files tracker, scoped per workspace.
 *
 * Sorting Cmd+K's file list alphabetically (badge.list order) is fine
 * for a brand-new workspace but degrades fast: with 100+ files, the one
 * the user opened 5 seconds ago is buried under z-files. A tiny
 * localStorage-backed log of "this file was opened at time T in this
 * workspace" lets the palette put recents at the top.
 *
 * Why localStorage (not the .bh/ directory): recent-opens are
 * per-machine, per-user, ephemeral. They don't belong in the workspace's
 * git-tracked .bh/ (that would create churn on every click). The bh
 * agent protocol doesn't need them either — the focus mirror captures
 * the user's *current* attention, recent-opens are noisier.
 *
 * Stored shape: { [workspaceName]: { [relPath]: epochMs } }. Trimmed
 * to RECENT_LIMIT entries per workspace on every write so the log
 * doesn't grow unbounded.
 */

import {
  type RecentFilesMap,
  type RecentFilesService,
  trimRecentFiles,
} from '../common/history.js';

const STORAGE_KEY = 'bh:recent-files';

function read(): RecentFilesMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as RecentFilesMap) : {};
  } catch {
    return {};
  }
}

function write(map: RecentFilesMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable / quota exceeded — accept loss; recents
    // are nice-to-have, not load-bearing.
  }
}

/** Record that `relPath` was just opened in `workspace`. Trims older
 *  entries beyond RECENT_LIMIT so the log can't grow forever. */
export function noteOpenedFile(workspace: string, relPath: string): void {
  const map = read();
  const inner = { ...(map[workspace] ?? {}), [relPath]: Date.now() };
  write({ ...map, [workspace]: trimRecentFiles(inner) });
}

/** Get the list of relPaths in this workspace ordered most-recent-first.
 *  Paths the user hasn't opened yet aren't in the list (callers append
 *  them at the end). */
export function recentFilesFor(workspace: string): readonly string[] {
  const inner = read()[workspace] ?? {};
  return Object.entries(inner)
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);
}

export const recentFilesService: RecentFilesService = {
  noteOpenedFile,
  recentFilesFor,
};
