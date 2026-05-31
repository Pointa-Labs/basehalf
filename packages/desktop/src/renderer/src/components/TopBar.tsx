import type { CSSProperties, JSX } from 'react';
import { color, font, space } from '../design.js';
import { promptForNewNote, tildifyPath } from '../lib/actions.js';
import { emitBadgeChange } from '../lib/badgeBus.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { confirm, prompt } from './Dialog.js';
import { Button } from './primitives/Button.js';
import { Menu } from './primitives/Menu.js';
import { Select } from './primitives/Select.js';

const dividerStyle: CSSProperties = {
  width: 1,
  height: 20,
  background: color.border,
  display: 'inline-block',
};

export const TopBar = (): JSX.Element => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const busy = useWorkspaceStore((s) => s.busy);
  const use = useWorkspaceStore((s) => s.use);
  const remove = useWorkspaceStore((s) => s.remove);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const folderScope = useWorkspaceStore((s) => s.folderScope);
  const setFolderScope = useWorkspaceStore((s) => s.setFolderScope);

  const handleRemove = async (): Promise<void> => {
    if (!current) return;
    const ok = await confirm({
      title: `Remove workspace "${current}"?`,
      body: 'The folder and its files stay on disk; only the registration is removed.',
      confirmText: 'Remove',
      destructive: true,
    });
    if (ok) void remove(current);
  };

  const handleRenameWorkspace = async (): Promise<void> => {
    if (!current) return;
    const next = await prompt({
      title: `Rename workspace "${current}"`,
      body: 'Changes the display name only — the folder path and its .bh/ are untouched.',
      label: 'New name',
      defaultValue: current,
      placeholder: 'e.g. school-spring-2026',
      validate: (v) => {
        const t = v.trim();
        if (t.length === 0) return 'A name is required.';
        if (t === current) return null; // dialog will close; handler skips below
        if (workspaces.some((w) => w.name === t)) return `Name "${t}" is already in use.`;
        return null;
      },
    });
    const trimmed = next?.trim();
    if (trimmed && trimmed !== current) void renameWorkspace(current, trimmed);
  };

  const handleNewNote = (): Promise<void> => promptForNewNote();

  // Focus the whole folder as a unit: focus.set({folder}) gathers every
  // supported file under it and carries the folder badge's prompt as the turn
  // intent — a folder IS the grouping. The canvas owns focus state, so signal
  // it (badgeBus) to re-read focus.get → refresh the focus rings + chip.
  const handleFocusFolder = async (): Promise<void> => {
    if (!folderScope) return;
    try {
      await window.bh.run('focus.set', { folder: folderScope });
      emitBadgeChange();
    } catch (err) {
      useWorkspaceStore.setState({
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  };

  const handleEditFolderPrompt = async (): Promise<void> => {
    if (!folderScope) return;
    // Read the current folder badge's prompt so the dialog pre-fills.
    const existing = (await window.bh.run('badge.get', {
      file: folderScope,
      kind: 'folder',
    })) as { prompt?: string } | null;
    const next = await prompt({
      title: `Folder prompt — /${folderScope}`,
      body: 'What the AI agent should know about this folder (read from the folder badge JSON). Leave blank to clear.',
      label: 'Prompt',
      defaultValue: existing?.prompt ?? '',
      placeholder: 'e.g. Chapter 3 supporting material — read first',
    });
    if (next === null) return;
    try {
      await window.bh.run('badge.set', {
        file: folderScope,
        patch: { kind: 'folder', prompt: next.trim() },
      });
    } catch (err) {
      // Surface via store so the global ErrorBanner picks it up.
      useWorkspaceStore.setState({
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  };

  const handleWorkspaceChange = (next: string): void => {
    if (!next || next === current) return;
    // `use` owns the flush: it persists any pending edit to the CURRENT
    // workspace's file before switching (so it lands in the right place), and
    // refuses to switch while a disk-conflict banner is unresolved.
    void use(next);
  };

  const workspaceOptions = workspaces.map((ws) => ({
    value: ws.name,
    label: ws.name,
    // Show the path as a hint in the dropdown row so users with multiple
    // similarly-named workspaces (or symlinks, or cloned folders in
    // different locations) can tell them apart at a glance.
    hint: tildifyPath(ws.path),
  }));

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[2],
        padding: `${space[2]}px ${space[4]}px`,
        borderBottom: `1px solid ${color.border}`,
        background: color.surface,
        fontFamily: font.sans,
        flexShrink: 0,
        height: 48,
        // The folder-scope chrome can add a few contextual buttons on the
        // right; scroll horizontally rather than clip on a narrow window.
        overflowX: 'auto',
        overflowY: 'hidden',
        // Hide the horizontal scrollbar visually — most users will only
        // see it briefly on a tiny window, and a visible scrollbar in
        // the topbar would look like a bug. Mouse wheel / trackpad still
        // scrolls.
        scrollbarWidth: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {workspaces.length > 0 ? (
        <Select
          value={current ?? ''}
          options={workspaceOptions}
          onChange={(v) => void handleWorkspaceChange(v)}
          placeholder="Choose workspace…"
          disabled={busy}
          minWidth={180}
          title="Switch active workspace"
          testId="topbar-workspace-select"
        />
      ) : (
        <span style={{ fontSize: font.size.ui, color: color.textTertiary }}>No workspaces</span>
      )}

      {current && (
        <Menu
          testId="topbar-ws-menu"
          title="Workspace actions"
          disabled={busy}
          actions={[
            { label: 'Rename workspace…', onClick: () => void handleRenameWorkspace() },
            { label: 'Remove workspace…', onClick: () => void handleRemove(), danger: true },
          ]}
        />
      )}

      {current && (
        <>
          <span style={dividerStyle} aria-hidden />
          <Button onClick={() => void handleNewNote()}>New note</Button>
        </>
      )}

      <div style={{ flex: 1 }} />

      {current && folderScope && (
        <>
          <Button variant="ghost" onClick={() => setFolderScope(null)} title="Exit folder scope">
            ← /{folderScope}
          </Button>
          <Button
            onClick={() => void handleFocusFolder()}
            title="Focus this folder — your agent reads all its files, with the folder prompt as the turn intent"
          >
            Focus this folder
          </Button>
          <Button
            variant="ghost"
            onClick={() => void handleEditFolderPrompt()}
            title="Edit this folder's badge prompt (the AI agent reads it as the intent when you focus the folder)"
          >
            Edit folder prompt
          </Button>
        </>
      )}
    </header>
  );
};
