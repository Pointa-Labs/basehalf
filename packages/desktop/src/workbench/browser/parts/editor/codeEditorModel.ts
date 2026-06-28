import type { GitBlameResult } from '../../../contrib/scm/common/git.js';
import { relativeTime } from './relativeTime.js';

/** Which blocking dialog is up (mutually exclusive): the navigate-away unsaved
 *  prompt, or the disk-changed-under-us conflict banner. */
export type CodeEditorPrompt = 'unsaved' | 'conflict';

/** Above this combined (baseline + buffer) size, skip the O(n·m) gutter line-diff
 *  — a huge generated/minified/log file would otherwise freeze the renderer. */
export const GUTTER_DIFF_MAX_CHARS = 1_000_000;

export interface GitBaselineInput {
  readonly branch?: string | null;
  readonly fileSignature: string;
}

export const isCodeEditorDirty = (buffer: string, lastSaved: string): boolean =>
  buffer !== lastSaved;

export const didDiskContentChange = (diskContent: string | undefined, lastSaved: string): boolean =>
  (diskContent ?? '') !== lastSaved;

export const gitFileStatusSignature = (
  status: { readonly x: string; readonly y: string } | undefined,
): string => (status ? `${status.x}${status.y}` : '');

export const shouldRefreshGitBaseline = (
  previous: GitBaselineInput,
  next: GitBaselineInput,
): boolean => previous.branch !== next.branch || previous.fileSignature !== next.fileSignature;

export const fileBaseName = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

export const blameAnnotation = (blame: GitBlameResult['lines'][number], now: number): string =>
  blame.sha.startsWith('00000000')
    ? 'You · Uncommitted'
    : `${blame.author}, ${relativeTime(blame.authorTime, now)} · ${blame.summary}`;
