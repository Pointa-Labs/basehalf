import { type JSX, type KeyboardEvent, type MouseEvent, useRef } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { openContextMenu } from '../../../browser/parts/contextmenu/contextMenuStore.js';
import { color, font, space } from '../../../browser/style/design.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { ExplorerHeader } from './ExplorerHeader.js';
import { NavTreeRow } from './NavTreeRow.js';
import { buildFileMenu, confirmAndDelete, createAndRename } from './fileMenu.js';
import {
  ROW_HEIGHT,
  navTreeKeyboardIntent,
  newItemDirForEntry,
  renameTargetForBasename,
} from './navTreeModel.js';
import { type ExplorerTreeRow, useExplorerTreeModel } from './useExplorerTreeModel.js';

interface NavTreeProps {
  rootPath: string;
}

const isMac = nativeHostService.platform === 'darwin';

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
};

export const NavTree = ({ rootPath }: NavTreeProps): JSX.Element => {
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const workspaceName = useWorkspaceStore((s) => s.current);
  const currentFile = useWorkspaceStore((s) => s.currentFile);
  const renamingPath = useWorkspaceStore((s) => s.renamingPath);
  const endRename = useWorkspaceStore((s) => s.endRename);
  const renameEntry = useWorkspaceStore((s) => s.renameEntry);
  const currentPath = currentFile;
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const {
    visibleRows,
    visibleItems,
    focusedRel,
    error,
    setFocusedRel,
    expandFolder,
    collapseFolder,
    toggleExpand,
    refreshTree,
    collapseAll,
  } = useExplorerTreeModel({ rootPath, currentPath, renamingPath });

  const focusRow = (rel: string): void => {
    setFocusedRel(rel);
    const focus = (): void => rowRefs.current.get(rel)?.focus();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focus);
    } else {
      setTimeout(focus, 0);
    }
  };

  const openRow = (row: ExplorerTreeRow): void => {
    if (row.kind === 'folder') toggleExpand(row.absPath);
    else openInPanel(row.rel);
  };

  const openRowContextMenu = (row: ExplorerTreeRow, x: number, y: number): void => {
    const isDir = row.kind === 'folder';
    openContextMenu(
      x,
      y,
      buildFileMenu({
        target: { path: row.rel, kind: row.kind },
        // New items land INSIDE a folder, or beside a file (its parent dir).
        newItemDir: newItemDirForEntry({ rel: row.rel, parentRel: row.parentRel, isDir }),
        onOpen: (t) => (t.kind === 'folder' ? expandFolder(row.absPath) : openInPanel(t.path)),
      }),
    );
  };

  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (isEditableTarget(e.target)) return;
    const intent = navTreeKeyboardIntent(visibleItems, focusedRel, {
      key: e.key,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      isMac,
    });
    if (intent.type === 'none') return;
    e.preventDefault();
    e.stopPropagation();

    if (intent.type === 'focus') {
      focusRow(intent.rel);
      return;
    }

    const currentRow = visibleRows.find((row) => row.rel === focusedRel) ?? visibleRows[0] ?? null;
    if (!currentRow) return;

    switch (intent.type) {
      case 'open':
        openRow(currentRow);
        return;
      case 'expand':
        expandFolder(currentRow.absPath);
        return;
      case 'collapse':
        collapseFolder(currentRow.absPath);
        return;
      case 'rename':
        endRename();
        useWorkspaceStore.getState().beginRename(currentRow.rel);
        return;
      case 'delete':
        void confirmAndDelete({ path: currentRow.rel, kind: currentRow.kind });
        return;
      case 'contextMenu': {
        const el = rowRefs.current.get(currentRow.rel);
        const rect = el?.getBoundingClientRect();
        openRowContextMenu(
          currentRow,
          rect ? rect.left + 24 : 0,
          rect ? rect.top + ROW_HEIGHT / 2 : 0,
        );
        return;
      }
    }
  };

  const renderRow = (row: ExplorerTreeRow, index: number): JSX.Element => {
    const isDir = row.kind === 'folder';
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation(); // don't also fire the container's background menu
      setFocusedRel(row.rel);
      openRowContextMenu(row, e.clientX, e.clientY);
    };
    const onRenameCommit = (name: string): void => {
      endRename();
      const newRel = renameTargetForBasename(row.rel, name);
      if (newRel === null) return;
      void renameEntry(row.rel, newRel, row.kind);
    };
    return (
      <NavTreeRow
        key={row.absPath}
        rowRef={(el) => {
          if (el) rowRefs.current.set(row.rel, el);
          else rowRefs.current.delete(row.rel);
        }}
        entry={row.entry}
        rel={row.rel}
        depth={row.depth}
        isExpanded={row.isExpanded}
        isSelected={row.isSelected}
        isFocused={focusedRel === row.rel}
        tabIndex={focusedRel === row.rel || (focusedRel === null && index === 0) ? 0 : -1}
        // Single-click a file = open as a PREVIEW tab (italic, reuses the slot);
        // double-click PINS it (matches the file-explorer idiom). A folder click
        // toggles expansion.
        onClick={() => {
          setFocusedRel(row.rel);
          openRow(row);
        }}
        onKeyDown={onTreeKeyDown}
        onDoubleClick={isDir ? undefined : () => openInPanel(row.rel, { pinned: true })}
        onContextMenu={onContextMenu}
        onFocus={() => setFocusedRel(row.rel)}
        renaming={renamingPath === row.rel}
        onRenameCommit={onRenameCommit}
        onRenameCancel={endRename}
      />
    );
  };

  // Background right-click (empty tree space): New File / New Folder at the root.
  const onBackgroundContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, buildFileMenu({ newItemDir: null }));
  };

  // Surface load errors WITHOUT destroying the tree: a single failed subfolder
  // expansion shouldn't blank the whole sidebar (a dead-end). Show the message
  // above whatever did load; when the root itself failed, the tree is empty so
  // the message stands alone. (Cleared on the next successful load above.)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ExplorerHeader
        name={workspaceName ?? ''}
        title={rootPath}
        onNewFile={() => void createAndRename('file', null)}
        onNewFolder={() => void createAndRename('folder', null)}
        onRefresh={refreshTree}
        onCollapseAll={collapseAll}
      />
      <div
        role="tree"
        aria-label={workspaceName ? `${workspaceName} files` : 'Files'}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: `${space[1]}px 0`,
        }}
        onContextMenu={onBackgroundContextMenu}
      >
        {error && (
          <div
            style={{
              color: color.danger,
              padding: `${space[1.5]}px ${space[3]}px`,
              fontSize: font.size.caption,
            }}
          >
            {error}
          </div>
        )}
        {visibleRows.map(renderRow)}
      </div>
    </div>
  );
};
