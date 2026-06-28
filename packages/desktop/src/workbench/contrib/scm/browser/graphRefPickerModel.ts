import type { PickOption } from '../../../browser/parts/dialogs/Dialog.js';
import type { GitRefInfo } from '../common/git.js';
import type { ScmHistoryFilter } from './scmViewStore.js';

const CONTROL_PREFIX = 'control:';
const REF_PREFIX = 'ref:';

export const graphRefPickOptions = (refs: readonly GitRefInfo[]): readonly PickOption[] => [
  { value: `${CONTROL_PREFIX}auto`, label: 'Auto' },
  { value: `${CONTROL_PREFIX}all`, label: 'All' },
  ...refs.map((ref) => ({
    value: `${REF_PREFIX}${ref.id}`,
    label: ref.name,
    hint: ref.type === 'remoteHead' ? 'remote' : ref.type === 'tag' ? 'tag' : undefined,
    detail: ref.type === 'remoteHead' ? 'Remote Branch' : ref.type === 'tag' ? 'Tag' : 'Branch',
  })),
];

export const graphRefFilterFromPick = (value: string): ScmHistoryFilter | null => {
  if (value === `${CONTROL_PREFIX}auto`) return { kind: 'auto' };
  if (value === `${CONTROL_PREFIX}all`) return { kind: 'all' };
  if (value.startsWith(REF_PREFIX)) return { kind: 'ref', ref: value.slice(REF_PREFIX.length) };
  return null;
};

export const graphRefDisplayName = (ref: string): string => {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  if (ref.startsWith('refs/remotes/')) return ref.slice('refs/remotes/'.length);
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length);
  return ref;
};

export const graphRefFilterLabel = (filter: ScmHistoryFilter): string => {
  if (filter.kind === 'ref') return graphRefDisplayName(filter.ref);
  return filter.kind === 'all' ? 'All' : 'Auto';
};
