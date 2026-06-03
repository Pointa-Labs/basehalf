const BADGE_TAB_PREFIX = 'badge://';

export type PanelTabKind = 'file' | 'badge';

export const badgeTabId = (file: string): string => `${BADGE_TAB_PREFIX}${file}`;

export const isBadgeTab = (tab: string): boolean => tab.startsWith(BADGE_TAB_PREFIX);

export const panelTabKind = (tab: string): PanelTabKind => (isBadgeTab(tab) ? 'badge' : 'file');

export const panelTabFile = (tab: string): string =>
  isBadgeTab(tab) ? tab.slice(BADGE_TAB_PREFIX.length) : tab;

export const renamePanelTab = (tab: string, fromPath: string, toPath: string): string => {
  const file = panelTabFile(tab);
  if (file !== fromPath) return tab;
  return isBadgeTab(tab) ? badgeTabId(toPath) : toPath;
};
