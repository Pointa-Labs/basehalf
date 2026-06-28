import type { QuickPickOption } from '../../../../platform/quickinput/common/quickInput.js';
import type { ScmHistoryItemRef } from '../common/history.js';
import { type ScmHistoryFilter, scmHistoryFilterRefs } from './scmViewStore.js';

const CONTROL_PREFIX = 'control:';
const REF_PREFIX = 'ref:';
const AUTO_VALUE = `${CONTROL_PREFIX}auto`;
const ALL_VALUE = `${CONTROL_PREFIX}all`;

export const graphRefPickOptions = (
  refs: readonly ScmHistoryItemRef[],
  selectedValues: readonly string[] = [],
): readonly QuickPickOption[] => {
  const refOptions = refs.map(graphRefPickOption);
  const selectedRefValues = selectedValues.filter((value) => value.startsWith(REF_PREFIX));
  const selectedRefOptions = uniquePickOptions(
    selectedRefValues
      .map((value) => graphRefPickOptionForSelectedValue(value, refs, refOptions))
      .filter((option): option is QuickPickOption => option !== undefined),
  );
  const selectedRefSet = new Set(selectedRefOptions.map((option) => option.value));
  return [
    {
      value: ALL_VALUE,
      label: 'All',
      detail: 'All history item references',
    },
    {
      value: AUTO_VALUE,
      label: 'Auto',
      detail: 'Current history item reference(s)',
    },
    ...selectedRefOptions,
    ...refOptions.filter((option) => !selectedRefSet.has(option.value)),
  ];
};

function graphRefPickOptionForSelectedValue(
  value: string,
  refs: readonly ScmHistoryItemRef[],
  options: readonly QuickPickOption[],
): QuickPickOption | undefined {
  const direct = options.find((option) => option.value === value);
  if (direct !== undefined) return direct;

  const selectedRef = value.slice(REF_PREFIX.length);
  const match = refs.find(
    (ref) => ref.id === selectedRef || ref.name === selectedRef || ref.revision === selectedRef,
  );
  return match === undefined ? undefined : graphRefPickOption(match);
}

function uniquePickOptions(options: readonly QuickPickOption[]): readonly QuickPickOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function graphRefPickOption(ref: ScmHistoryItemRef): QuickPickOption {
  return {
    value: `${REF_PREFIX}${ref.id}`,
    label: ref.name,
    hint: ref.category === 'remote' ? 'remote' : ref.category === 'tag' ? 'tag' : undefined,
    detail: ref.description ?? graphRefCategoryLabel(ref.category),
  };
}

function graphRefCategoryLabel(category: ScmHistoryItemRef['category']): string {
  if (category === 'remote') return 'Remote Branch';
  if (category === 'tag') return 'Tag';
  if (category === 'other') return 'Reference';
  return 'Branch';
}

export const graphRefSelectedValues = (filter: ScmHistoryFilter): readonly string[] => {
  if (filter.kind === 'all') return [ALL_VALUE];
  if (filter.kind === 'auto') return [AUTO_VALUE];
  return (scmHistoryFilterRefs(filter) ?? []).map((ref) => `${REF_PREFIX}${ref}`);
};

export const graphRefNormalizeSelectedValues = ({
  nextValues,
  addedValue,
}: {
  readonly previousValues: readonly string[];
  readonly nextValues: readonly string[];
  readonly addedValue?: string;
}): readonly string[] => {
  if (addedValue === ALL_VALUE || addedValue === AUTO_VALUE) return [addedValue];
  if (addedValue?.startsWith(REF_PREFIX) === true) {
    return nextValues.filter((value) => value !== ALL_VALUE && value !== AUTO_VALUE);
  }
  return nextValues;
};

export const graphRefFilterFromPick = (
  value: string | readonly string[],
): ScmHistoryFilter | null => {
  if (typeof value === 'string') return graphRefFilterFromValue(value);
  return graphRefFilterFromValues(value);
};

function graphRefFilterFromValue(value: string): ScmHistoryFilter | null {
  if (value === AUTO_VALUE) return { kind: 'auto' };
  if (value === ALL_VALUE) return { kind: 'all' };
  if (value.startsWith(REF_PREFIX)) return { kind: 'ref', ref: value.slice(REF_PREFIX.length) };
  return null;
}

function graphRefFilterFromValues(values: readonly string[]): ScmHistoryFilter | null {
  if (values.length === 1 && values[0] === AUTO_VALUE) return { kind: 'auto' };
  if (values.length === 1 && values[0] === ALL_VALUE) return { kind: 'all' };
  const refs = values
    .filter((value) => value.startsWith(REF_PREFIX))
    .map((value) => value.slice(REF_PREFIX.length));
  if (refs.length === 0) return null;
  return { kind: 'refs', refs: [...new Set(refs)] };
}

export const graphRefDisplayName = (ref: string): string => {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  if (ref.startsWith('refs/remotes/')) return ref.slice('refs/remotes/'.length);
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length);
  return ref;
};

export const graphRefFilterLabel = (filter: ScmHistoryFilter): string => {
  if (filter.kind === 'all') return 'All';
  if (filter.kind === 'auto') return 'Auto';
  const refs = scmHistoryFilterRefs(filter) ?? [];
  if (refs.length === 1 && refs[0] !== undefined) return graphRefDisplayName(refs[0]);
  return `${refs.length} Items`;
};

export const graphRefFilterTooltip = (filter: ScmHistoryFilter): string => {
  if (filter.kind === 'all') return 'All history item references';
  if (filter.kind === 'auto') return 'Current history item reference(s)';
  const refs = scmHistoryFilterRefs(filter) ?? [];
  return refs.map(graphRefDisplayName).join(', ');
};
