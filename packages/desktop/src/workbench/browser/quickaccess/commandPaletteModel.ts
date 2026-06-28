import type { GitLogResult, GitRefInfo } from '../../contrib/scm/common/git.js';
import { recentFilesService } from '../../services/history/browser/recentFiles.js';
import { type IMatch, createMatches, fuzzyMatch } from './fuzzyScore.js';

export type { IMatch };

export const EMPTY_RECENT_CAP = 8;

export interface CommandPaletteFileEntry {
  readonly file: string;
  readonly prompt?: string;
}

export type CommandPaletteCategory = 'Workspace' | 'File' | 'Action' | 'Git' | 'Search';

export interface CommandPaletteAction {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly category: CommandPaletteCategory;
  readonly sub?: string;
  readonly shortcut?: string;
  readonly searchAlso?: string;
  readonly run: () => void;
}

export interface CommandPaletteWorkspace {
  readonly name: string;
  readonly path: string;
}

export interface CommandPaletteGitState {
  readonly repo: boolean;
  readonly workspace: string | null;
  readonly branches: readonly GitRefInfo[];
  readonly commits: readonly GitLogResult['commits'][number][];
}

export interface FilterCommandPaletteActionsResult {
  readonly filtered: CommandPaletteAction[];
  readonly matchMap: Map<string, IMatch[]>;
}

export function clampCommandPaletteSelection(index: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.min(Math.max(index, 0), rowCount - 1);
}

export function moveCommandPaletteSelection(
  index: number,
  rowCount: number,
  delta: number,
): number {
  if (rowCount <= 0) return 0;
  if (index < 0 || index >= rowCount) {
    return delta < 0 ? rowCount - 1 : 0;
  }
  const current = index;
  return (current + delta + rowCount) % rowCount;
}

export function reconcileCommandPaletteSelection<T extends { readonly id: string }>(
  rows: readonly T[],
  selectedIdx: number,
  selectedId: string | null,
): number {
  if (rows.length === 0) return 0;
  if (selectedId !== null) {
    const existing = rows.findIndex((row) => row.id === selectedId);
    if (existing >= 0) return existing;
  }
  return clampCommandPaletteSelection(selectedIdx, rows.length);
}

export function filterCommandPaletteActions(args: {
  readonly actions: readonly CommandPaletteAction[];
  readonly query: string;
  readonly current: string | null;
}): FilterCommandPaletteActionsResult {
  const q = args.query.trim();
  const fileId = (a: CommandPaletteAction): string => a.id.slice('file:'.length);

  if (q.length === 0) {
    const fallback = (): CommandPaletteAction[] =>
      args.actions.filter((a) => a.category !== 'File');
    if (args.current === null) return { filtered: fallback(), matchMap: new Map() };
    const rank = new Map(
      recentFilesService.recentFilesFor(args.current).map((p, i) => [p, i] as const),
    );
    const recents = args.actions
      .filter((a) => a.category === 'File' && rank.has(fileId(a)))
      .sort((a, b) => (rank.get(fileId(a)) ?? 0) - (rank.get(fileId(b)) ?? 0))
      .slice(0, EMPTY_RECENT_CAP);
    const rows = recents.length > 0 ? recents : fallback();
    return { filtered: rows, matchMap: new Map() };
  }

  const matchMap = new Map<string, IMatch[]>();
  const scored: { action: CommandPaletteAction; score: number }[] = [];
  for (const action of args.actions) {
    const labelScore = fuzzyMatch(q, action.label);
    let score = labelScore ? labelScore[0] + 1 : Number.NEGATIVE_INFINITY;
    for (const field of [action.hint, action.searchAlso]) {
      if (field === undefined || field.length === 0) continue;
      const fieldScore = fuzzyMatch(q, field);
      if (fieldScore && fieldScore[0] > score) score = fieldScore[0];
    }
    if (score === Number.NEGATIVE_INFINITY) continue;
    if (labelScore) matchMap.set(action.id, createMatches(labelScore));
    scored.push({ action, score });
  }

  const rank =
    args.current !== null
      ? new Map(recentFilesService.recentFilesFor(args.current).map((p, i) => [p, i] as const))
      : new Map<string, number>();
  scored.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    const rx = x.action.category === 'File' ? rank.get(fileId(x.action)) : undefined;
    const ry = y.action.category === 'File' ? rank.get(fileId(y.action)) : undefined;
    if (rx !== undefined && ry !== undefined) return rx - ry;
    if (rx !== undefined) return -1;
    if (ry !== undefined) return 1;
    return x.action.label.localeCompare(y.action.label);
  });
  return { filtered: scored.map((s) => s.action), matchMap };
}
