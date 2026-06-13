// A panel tab is identified by its workspace-relative file path. (Badge tabs —
// the old `badge://` prefix that opened a file's badge in the right panel — were
// removed once the badge editor moved INTO the canvas card itself; the badge no
// longer has a panel tab.)

/** Remap a tab when its underlying file is renamed. No-op for other tabs. */
export const renamePanelTab = (tab: string, fromPath: string, toPath: string): string =>
  tab === fromPath ? toPath : tab;
