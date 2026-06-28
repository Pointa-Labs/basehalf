import type { GitGroups, GitRow } from './gitStatusModel.js';
import { type ScmGroupId, rowKey } from './types.js';

export interface ResourceRowItem {
  readonly key: string;
  readonly groupId: ScmGroupId;
  readonly row: GitRow;
  readonly index: number;
}

export interface ResourceSelection {
  readonly selectedKeys: readonly string[];
  readonly anchorKey: string | null;
}

export const emptyResourceSelection = (): ResourceSelection => ({
  selectedKeys: [],
  anchorKey: null,
});

export function flattenResourceRows(groups: GitGroups): readonly ResourceRowItem[] {
  return [
    ...groups.merge.map((row) => ({
      key: rowKey('merge', row),
      groupId: 'merge' as const,
      row,
    })),
    ...groups.staged.map((row) => ({
      key: rowKey('staged', row),
      groupId: 'staged' as const,
      row,
    })),
    ...groups.changes.map((row) => ({
      key: rowKey('changes', row),
      groupId: 'changes' as const,
      row,
    })),
  ].map((item, index) => ({ ...item, index }));
}

export function resourceRowItemMap(
  rowItems: readonly ResourceRowItem[],
): ReadonlyMap<string, ResourceRowItem> {
  return new Map(rowItems.map((item) => [item.key, item]));
}

export function pruneResourceSelection(
  selection: ResourceSelection,
  rowItems: readonly ResourceRowItem[],
): ResourceSelection {
  const rowByKey = resourceRowItemMap(rowItems);
  const selectedKeys = selection.selectedKeys.filter((key) => rowByKey.has(key));
  const anchorKey =
    selection.anchorKey !== null && rowByKey.has(selection.anchorKey) ? selection.anchorKey : null;
  if (selectedKeys === selection.selectedKeys && anchorKey === selection.anchorKey)
    return selection;
  return { selectedKeys, anchorKey };
}

export function selectResourceOnly(key: string): ResourceSelection {
  return { selectedKeys: [key], anchorKey: key };
}

export function selectResourceRange(
  selection: ResourceSelection,
  rowItems: readonly ResourceRowItem[],
  key: string,
): ResourceSelection {
  const rowByKey = resourceRowItemMap(rowItems);
  const current = rowByKey.get(key);
  if (current === undefined) return selection;
  const anchor = selection.anchorKey !== null ? rowByKey.get(selection.anchorKey) : undefined;
  const from = anchor?.index ?? current.index;
  const [start, end] = from < current.index ? [from, current.index] : [current.index, from];
  return {
    selectedKeys: rowItems.slice(start, end + 1).map((item) => item.key),
    anchorKey: selection.anchorKey ?? key,
  };
}

export function toggleResourceSelection(
  selection: ResourceSelection,
  key: string,
): ResourceSelection {
  return {
    selectedKeys: selection.selectedKeys.includes(key)
      ? selection.selectedKeys.filter((item) => item !== key)
      : [...selection.selectedKeys, key],
    anchorKey: key,
  };
}

export function selectedRowsForResourceAction(
  rowItems: readonly ResourceRowItem[],
  selectedKeys: readonly string[],
  key: string,
  groupId: ScmGroupId,
): readonly GitRow[] {
  const rowByKey = resourceRowItemMap(rowItems);
  const keys = selectedKeys.includes(key) ? selectedKeys : [key];
  return keys
    .map((selectedKey) => rowByKey.get(selectedKey))
    .filter((item): item is ResourceRowItem => item !== undefined)
    .filter((item) => item.groupId === groupId)
    .map((item) => item.row);
}
