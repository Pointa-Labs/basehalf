export const RECENT_FILES_LIMIT = 50;

export type RecentFilesMap = Record<string, Record<string, number>>;

export function parseRecentFilesMap(raw: string | null): RecentFilesMap {
  if (!raw) return {};
  try {
    return normalizeRecentFilesMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function serializeRecentFilesMap(map: RecentFilesMap): string {
  return JSON.stringify(map);
}

export function noteRecentFileOpened(
  map: RecentFilesMap,
  workspace: string,
  relPath: string,
  openedAt = Date.now(),
): RecentFilesMap {
  const workspaceFiles = { ...(map[workspace] ?? {}), [relPath]: openedAt };
  return {
    ...map,
    [workspace]: trimRecentFiles(workspaceFiles),
  };
}

export function recentFilesForWorkspace(map: RecentFilesMap, workspace: string): readonly string[] {
  return Object.entries(map[workspace] ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);
}

export function trimRecentFiles(
  files: Record<string, number>,
  limit = RECENT_FILES_LIMIT,
): Record<string, number> {
  const entries = Object.entries(files).sort((a, b) => b[1] - a[1]);
  const trimmed: Record<string, number> = {};
  for (const [path, ts] of entries.slice(0, limit)) trimmed[path] = ts;
  return trimmed;
}

function normalizeRecentFilesMap(value: unknown): RecentFilesMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: RecentFilesMap = {};
  for (const [workspace, files] of Object.entries(value)) {
    if (typeof files !== 'object' || files === null || Array.isArray(files)) continue;
    const normalizedFiles: Record<string, number> = {};
    for (const [path, timestamp] of Object.entries(files)) {
      if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        normalizedFiles[path] = timestamp;
      }
    }
    if (Object.keys(normalizedFiles).length > 0) {
      out[workspace] = trimRecentFiles(normalizedFiles);
    }
  }
  return out;
}
