import type { GitRefInfo } from '@basehalf/core';
import type { ScmHistoryFilter } from '../../store/scmView.js';
import type { PickOption } from '../Dialog.js';

const CONTROL_PREFIX = 'control:';
const REF_PREFIX = 'ref:';

export const graphRefPickOptions = (refs: readonly GitRefInfo[]): readonly PickOption[] => [
  { value: `${CONTROL_PREFIX}all`, label: 'All' },
  { value: `${CONTROL_PREFIX}auto`, label: 'Auto' },
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
