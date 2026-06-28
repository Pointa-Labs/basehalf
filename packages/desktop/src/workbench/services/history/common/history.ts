export const RECENT_FILES_LIMIT = 50;

export type RecentFilesMap = Record<string, Record<string, number>>;

export interface RecentFilesService {
  noteOpenedFile(workspace: string, relPath: string): void;
  recentFilesFor(workspace: string): readonly string[];
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
