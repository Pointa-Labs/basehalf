import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  type ContextMenuItem,
  openContextMenu,
} from '../../../browser/parts/contextmenu/contextMenuStore.js';
import { toast } from '../../../browser/parts/notifications/toastStore.js';
import type { GitGroups, GitRow } from './gitStatusModel.js';
import {
  type ResourceSelection,
  emptyResourceSelection,
  flattenResourceRows,
  pruneResourceSelection,
  selectResourceOnly,
  selectResourceRange,
  selectedRowsForResourceAction,
  toggleResourceSelection,
} from './resourceGroupsModel.js';
import { type RowAction, type ScmGroupId, rowKey } from './types.js';

export interface ResourceGroupsControllerArgs {
  readonly groups: GitGroups;
  readonly busy: boolean;
  readonly openRow: (row: GitRow) => void;
  readonly stage: (paths: string[]) => Promise<void>;
  readonly unstage: (paths: string[]) => Promise<void>;
  readonly discardMany: (rows: readonly GitRow[]) => void;
}

export interface ResourceGroupsController {
  readonly openGroups: Readonly<Record<ScmGroupId, boolean>>;
  readonly selectedKeys: readonly string[];
  readonly toggleGroup: (groupId: ScmGroupId) => void;
  readonly onRowClick: (event: ReactMouseEvent, key: string, row: GitRow) => void;
  readonly onRowContextMenu: (
    event: ReactMouseEvent,
    key: string,
    groupId: ScmGroupId,
    row: GitRow,
  ) => void;
  readonly onKeyboardContextMenu: (
    button: HTMLButtonElement,
    key: string,
    groupId: ScmGroupId,
    row: GitRow,
  ) => void;
  readonly mergeActions: (row: GitRow) => RowAction[];
  readonly stagedActions: (row: GitRow) => RowAction[];
  readonly changesActions: (row: GitRow) => RowAction[];
  readonly unstageAllAction: RowAction;
  readonly stageAllAction: RowAction;
}

export function useResourceGroupsController({
  groups,
  busy,
  openRow,
  stage,
  unstage,
  discardMany,
}: ResourceGroupsControllerArgs): ResourceGroupsController {
  const [openGroups, setOpenGroups] = useState<Record<ScmGroupId, boolean>>({
    merge: true,
    staged: true,
    changes: true,
  });
  const [selection, setSelection] = useState<ResourceSelection>(emptyResourceSelection);

  const rowItems = useMemo(() => flattenResourceRows(groups), [groups]);

  useEffect(() => {
    setSelection((current) => pruneResourceSelection(current, rowItems));
  }, [rowItems]);

  const selectOnly = useCallback((key: string): void => {
    setSelection(selectResourceOnly(key));
  }, []);

  const selectRange = useCallback(
    (key: string): void => {
      setSelection((current) => selectResourceRange(current, rowItems, key));
    },
    [rowItems],
  );

  const toggleSelection = useCallback((key: string): void => {
    setSelection((current) => toggleResourceSelection(current, key));
  }, []);

  const selectionForAction = useCallback(
    (key: string, groupId: ScmGroupId): readonly GitRow[] =>
      selectedRowsForResourceAction(rowItems, selection.selectedKeys, key, groupId),
    [rowItems, selection.selectedKeys],
  );

  const copyPaths = useCallback((rows: readonly GitRow[]): void => {
    void navigator.clipboard
      .writeText(rows.map((row) => row.path).join('\n'))
      .then(() => toast.success(rows.length === 1 ? 'Copied path' : `Copied ${rows.length} paths`))
      .catch(() => toast.error('Failed to copy path.'));
  }, []);

  const rowMenu = useCallback(
    (key: string, groupId: ScmGroupId, row: GitRow): ContextMenuItem[] => {
      const selectedRows = selectionForAction(key, groupId);
      const plural = selectedRows.length > 1;
      const items: ContextMenuItem[] = [
        {
          id: 'open',
          label: row.untracked ? 'Open File' : 'Open Changes',
          run: () => openRow(row),
        },
        {
          id: 'copy-path',
          label: plural ? 'Copy Paths' : 'Copy Path',
          run: () => copyPaths(selectedRows),
        },
      ];
      if (groupId === 'changes' || groupId === 'merge') {
        items.push({ separator: true });
        items.push({
          id: 'stage',
          label: plural ? 'Stage Selected Changes' : 'Stage Changes',
          disabled: busy,
          run: () => void stage(selectedRows.map((entry) => entry.path)),
        });
      }
      if (groupId === 'staged') {
        items.push({ separator: true });
        items.push({
          id: 'unstage',
          label: plural ? 'Unstage Selected Changes' : 'Unstage Changes',
          disabled: busy,
          run: () => void unstage(selectedRows.map((entry) => entry.path)),
        });
      }
      if (groupId === 'changes') {
        items.push({ separator: true });
        items.push({
          id: 'discard',
          label: plural ? 'Discard Selected Changes' : 'Discard Changes',
          disabled: busy,
          danger: true,
          run: () => discardMany(selectedRows),
        });
      }
      return items;
    },
    [busy, copyPaths, discardMany, openRow, selectionForAction, stage, unstage],
  );

  const onRowClick = useCallback(
    (event: ReactMouseEvent, key: string, row: GitRow): void => {
      if (event.shiftKey) {
        selectRange(key);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        toggleSelection(key);
        return;
      }
      selectOnly(key);
      openRow(row);
    },
    [openRow, selectOnly, selectRange, toggleSelection],
  );

  const onRowContextMenu = useCallback(
    (event: ReactMouseEvent, key: string, groupId: ScmGroupId, row: GitRow): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!selection.selectedKeys.includes(key)) selectOnly(key);
      openContextMenu(event.clientX, event.clientY, rowMenu(key, groupId, row));
    },
    [rowMenu, selectOnly, selection.selectedKeys],
  );

  const onKeyboardContextMenu = useCallback(
    (button: HTMLButtonElement, key: string, groupId: ScmGroupId, row: GitRow): void => {
      if (!selection.selectedKeys.includes(key)) selectOnly(key);
      const rect = button.getBoundingClientRect();
      openContextMenu(rect.left + 18, rect.top + 18, rowMenu(key, groupId, row));
    },
    [rowMenu, selectOnly, selection.selectedKeys],
  );

  const toggleGroup = useCallback((groupId: ScmGroupId): void => {
    setOpenGroups((open) => ({ ...open, [groupId]: !open[groupId] }));
  }, []);

  const mergeActions = useCallback(
    (row: GitRow): RowAction[] => {
      const selectedRows = selectionForAction(rowKey('merge', row), 'merge');
      return [
        {
          label: selectedRows.length > 1 ? 'Stage Selected Changes' : 'Stage Changes',
          glyph: 'add',
          onClick: () => void stage(selectedRows.map((entry) => entry.path)),
        },
      ];
    },
    [selectionForAction, stage],
  );

  const stagedActions = useCallback(
    (row: GitRow): RowAction[] => {
      const selectedRows = selectionForAction(rowKey('staged', row), 'staged');
      return [
        {
          label: selectedRows.length > 1 ? 'Unstage Selected Changes' : 'Unstage Changes',
          glyph: 'remove',
          onClick: () => void unstage(selectedRows.map((entry) => entry.path)),
        },
      ];
    },
    [selectionForAction, unstage],
  );

  const changesActions = useCallback(
    (row: GitRow): RowAction[] => {
      const selectedRows = selectionForAction(rowKey('changes', row), 'changes');
      return [
        {
          label: selectedRows.length > 1 ? 'Discard Selected Changes' : 'Discard Changes',
          glyph: 'discard',
          onClick: () => discardMany(selectedRows),
          danger: true,
        },
        {
          label: selectedRows.length > 1 ? 'Stage Selected Changes' : 'Stage Changes',
          glyph: 'add',
          onClick: () => void stage(selectedRows.map((entry) => entry.path)),
        },
      ];
    },
    [discardMany, selectionForAction, stage],
  );

  const unstageAllAction = useMemo(
    (): RowAction => ({
      label: 'Unstage All Changes',
      glyph: 'remove',
      onClick: () => void unstage(groups.staged.map((row) => row.path)),
    }),
    [groups.staged, unstage],
  );

  const stageAllAction = useMemo(
    (): RowAction => ({
      label: 'Stage All Changes',
      glyph: 'add',
      onClick: () => void stage(groups.changes.map((row) => row.path)),
    }),
    [groups.changes, stage],
  );

  return {
    openGroups,
    selectedKeys: selection.selectedKeys,
    toggleGroup,
    onRowClick,
    onRowContextMenu,
    onKeyboardContextMenu,
    mergeActions,
    stagedActions,
    changesActions,
    unstageAllAction,
    stageAllAction,
  };
}
