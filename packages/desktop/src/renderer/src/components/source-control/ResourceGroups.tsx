import {
  type JSX,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { color, font, space } from '../../design.js';
import type { GitGroups, GitRow } from '../../lib/gitStatus.js';
import { type ContextMenuItem, openContextMenu } from '../../store/contextMenu.js';
import { toast } from '../../store/toast.js';
import { ResourceGroup } from './ResourceGroup.js';
import { type ScmGroupId, rowKey } from './types.js';

export const ResourceGroups = ({
  count,
  groups,
  busy,
  hasStaged,
  openRow,
  stage,
  unstage,
  discardMany,
}: {
  count: number;
  groups: GitGroups;
  busy: boolean;
  hasStaged: boolean;
  openRow: (row: GitRow) => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discardMany: (rows: readonly GitRow[]) => void;
}): JSX.Element => {
  const [openGroups, setOpenGroups] = useState<Record<ScmGroupId, boolean>>({
    merge: true,
    staged: true,
    changes: true,
  });
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);

  const rowItems = useMemo(
    () =>
      [
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
      ].map((item, index) => ({ ...item, index })),
    [groups],
  );

  const rowByKey = useMemo(() => new Map(rowItems.map((item) => [item.key, item])), [rowItems]);

  useEffect(() => {
    setSelectedKeys((keys) => keys.filter((key) => rowByKey.has(key)));
    setAnchorKey((key) => (key !== null && rowByKey.has(key) ? key : null));
  }, [rowByKey]);

  const selectOnly = useCallback((key: string): void => {
    setSelectedKeys([key]);
    setAnchorKey(key);
  }, []);

  const selectRange = useCallback(
    (key: string): void => {
      const current = rowByKey.get(key);
      if (!current) return;
      const anchor = anchorKey !== null ? rowByKey.get(anchorKey) : undefined;
      const from = anchor?.index ?? current.index;
      const [start, end] = from < current.index ? [from, current.index] : [current.index, from];
      setSelectedKeys(rowItems.slice(start, end + 1).map((item) => item.key));
    },
    [anchorKey, rowByKey, rowItems],
  );

  const toggleSelection = useCallback((key: string): void => {
    setSelectedKeys((keys) =>
      keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key],
    );
    setAnchorKey(key);
  }, []);

  const selectionForAction = useCallback(
    (key: string, groupId: ScmGroupId): GitRow[] => {
      const keys = selectedKeys.includes(key) ? selectedKeys : [key];
      return keys
        .map((selectedKey) => rowByKey.get(selectedKey))
        .filter((item): item is NonNullable<typeof item> => item !== undefined)
        .filter((item) => item.groupId === groupId)
        .map((item) => item.row);
    },
    [rowByKey, selectedKeys],
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
          run: () => void stage(selectedRows.map((row) => row.path)),
        });
      }
      if (groupId === 'staged') {
        items.push({ separator: true });
        items.push({
          id: 'unstage',
          label: plural ? 'Unstage Selected Changes' : 'Unstage Changes',
          run: () => void unstage(selectedRows.map((row) => row.path)),
        });
      }
      if (groupId === 'changes') {
        items.push({ separator: true });
        items.push({
          id: 'discard',
          label: plural ? 'Discard Selected Changes' : 'Discard Changes',
          danger: true,
          run: () => discardMany(selectedRows),
        });
      }
      return items;
    },
    [copyPaths, discardMany, openRow, selectionForAction, stage, unstage],
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
      if (!selectedKeys.includes(key)) selectOnly(key);
      openContextMenu(event.clientX, event.clientY, rowMenu(key, groupId, row));
    },
    [rowMenu, selectOnly, selectedKeys],
  );

  const showKeyboardRowMenu = useCallback(
    (button: HTMLButtonElement, key: string, groupId: ScmGroupId, row: GitRow): void => {
      if (!selectedKeys.includes(key)) selectOnly(key);
      const rect = button.getBoundingClientRect();
      openContextMenu(rect.left + 18, rect.top + 18, rowMenu(key, groupId, row));
    },
    [rowMenu, selectOnly, selectedKeys],
  );

  const toggleGroup = useCallback((groupId: ScmGroupId): void => {
    setOpenGroups((open) => ({ ...open, [groupId]: !open[groupId] }));
  }, []);

  return (
    <div>
      {count === 0 ? (
        <div style={{ padding: space[4], color: color.textTertiary, fontSize: font.size.caption }}>
          There are no changes.
        </div>
      ) : (
        <>
          <ResourceGroup
            groupId="merge"
            title="Merge Changes"
            rows={groups.merge}
            show={groups.merge.length > 0}
            open={openGroups.merge}
            onToggle={() => toggleGroup('merge')}
            busy={busy}
            selectedKeys={selectedKeys}
            onRowClick={onRowClick}
            onRowContextMenu={onRowContextMenu}
            onKeyboardContextMenu={showKeyboardRowMenu}
            actions={(row) => [
              { label: 'Stage Changes', glyph: 'add', onClick: () => void stage([row.path]) },
            ]}
          />
          <ResourceGroup
            groupId="staged"
            title="Staged Changes"
            rows={groups.staged}
            show={hasStaged}
            open={openGroups.staged}
            onToggle={() => toggleGroup('staged')}
            busy={busy}
            selectedKeys={selectedKeys}
            groupAction={{
              label: 'Unstage All Changes',
              glyph: 'remove',
              onClick: () => void unstage(groups.staged.map((row) => row.path)),
            }}
            onRowClick={onRowClick}
            onRowContextMenu={onRowContextMenu}
            onKeyboardContextMenu={showKeyboardRowMenu}
            actions={(row) => {
              const key = rowKey('staged', row);
              const selectedRows = selectionForAction(key, 'staged');
              return [
                {
                  label: selectedRows.length > 1 ? 'Unstage Selected Changes' : 'Unstage Changes',
                  glyph: 'remove',
                  onClick: () => void unstage(selectedRows.map((entry) => entry.path)),
                },
              ];
            }}
          />
          <ResourceGroup
            groupId="changes"
            title="Changes"
            rows={groups.changes}
            show={groups.changes.length > 0}
            open={openGroups.changes}
            onToggle={() => toggleGroup('changes')}
            busy={busy}
            selectedKeys={selectedKeys}
            groupAction={{
              label: 'Stage All Changes',
              glyph: 'add',
              onClick: () => void stage(groups.changes.map((row) => row.path)),
            }}
            onRowClick={onRowClick}
            onRowContextMenu={onRowContextMenu}
            onKeyboardContextMenu={showKeyboardRowMenu}
            actions={(row) => {
              const key = rowKey('changes', row);
              const selectedRows = selectionForAction(key, 'changes');
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
            }}
          />
        </>
      )}
    </div>
  );
};
