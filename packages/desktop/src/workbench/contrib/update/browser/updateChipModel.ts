import type { UpdateState } from '../../../../platform/update/common/update.js';

export type UpdateChipTone = 'neutral' | 'accent' | 'success' | 'danger';
export type UpdateChipAction = 'check' | 'download' | 'install';

export type UpdateChipViewModel =
  | {
      readonly kind: 'label';
      readonly text: string;
      readonly title: string;
      readonly tone: UpdateChipTone;
      readonly action?: UpdateChipAction;
    }
  | {
      readonly kind: 'progress';
      readonly text: string;
      readonly title: string;
      readonly progressKnown: boolean;
      readonly progressPercent: number;
    };

const TRANSIENT_UPDATE_PHASES = new Set<UpdateState['phase']>(['checking', 'upToDate']);

export function isTransientUpdatePhase(phase: UpdateState['phase']): boolean {
  return TRANSIENT_UPDATE_PHASES.has(phase);
}

function downloadingPercent(state: Extract<UpdateState, { phase: 'downloading' }>): number {
  if (state.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((state.received / state.total) * 100)));
}

export function updateChipViewModel(
  state: UpdateState,
  options: { readonly hidden?: boolean; readonly starting?: boolean } = {},
): UpdateChipViewModel | null {
  if (state.phase === 'idle' || options.hidden === true) return null;

  switch (state.phase) {
    case 'checking':
      return {
        kind: 'label',
        text: 'Checking for updates…',
        title: 'Checking for updates…',
        tone: 'neutral',
      };
    case 'upToDate':
      return {
        kind: 'label',
        text: 'Up to date',
        title: 'Up to date',
        tone: 'success',
      };
    case 'available': {
      const text = options.starting === true ? 'Starting…' : `Update ${state.version}`;
      return {
        kind: 'label',
        text,
        title: text,
        tone: 'accent',
        action: options.starting === true ? undefined : 'download',
      };
    }
    case 'downloading': {
      const progressKnown = state.total > 0;
      const progressPercent = downloadingPercent(state);
      const text = progressKnown ? `Downloading… ${progressPercent}%` : 'Downloading…';
      return {
        kind: 'progress',
        text,
        title: `Downloading… ${progressPercent}%`,
        progressKnown,
        progressPercent,
      };
    }
    case 'staged':
      return {
        kind: 'label',
        text: 'Restart to update',
        title: 'Restart to update',
        tone: 'accent',
        action: 'install',
      };
    case 'error':
      return {
        kind: 'label',
        text: 'Update failed — Retry',
        title: 'Update failed — Retry',
        tone: 'danger',
        action: 'check',
      };
  }
}
