import type { WorkspaceEntry } from '@basehalf/core';
import { sortByRecency } from './recentWorkspaces.js';

/**
 * The welcome page has two emphases driven by whether the user has ever opened
 * anything: `first-run` (teach + activate) vs `returning` (resume fast). This is
 * the single branching decision behind the page — kept pure so it's unit-tested
 * (the renderer has no React-render harness; pure helpers are how we test it).
 *
 * `recent` is the registered workspaces, most-recent-first, EXCLUDING the active
 * one (defensive — on the welcome screen `current` is null, so it's all of them).
 * The variant keys off `recent.length`: an empty registry is a true first run.
 */
export interface WelcomeView {
  readonly variant: 'first-run' | 'returning';
  readonly recent: readonly WorkspaceEntry[];
}

export function selectWelcomeView(
  workspaces: readonly WorkspaceEntry[],
  current: string | null,
): WelcomeView {
  const recent = sortByRecency(workspaces.filter((w) => w.name !== current));
  return { variant: recent.length > 0 ? 'returning' : 'first-run', recent };
}
