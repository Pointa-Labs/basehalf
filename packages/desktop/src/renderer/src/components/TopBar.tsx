import type { CSSProperties, JSX } from 'react';
import { color, font, space } from '../design.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { confirm, prompt } from './Dialog.js';
import { Button } from './primitives/Button.js';
import { Select } from './primitives/Select.js';

const dividerStyle: CSSProperties = {
  width: 1,
  height: 20,
  background: color.border,
  display: 'inline-block',
};

const labelStyle: CSSProperties = {
  fontSize: font.size.micro,
  color: color.textTertiary,
  letterSpacing: font.trackedCaps,
  textTransform: 'uppercase',
  fontWeight: font.weight.medium,
};

export const TopBar = (): JSX.Element => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const busy = useWorkspaceStore((s) => s.busy);
  const pickAndAdd = useWorkspaceStore((s) => s.pickAndAdd);
  const use = useWorkspaceStore((s) => s.use);
  const remove = useWorkspaceStore((s) => s.remove);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const views = useWorkspaceStore((s) => s.views);
  const currentView = useWorkspaceStore((s) => s.currentView);
  const setCurrentView = useWorkspaceStore((s) => s.setCurrentView);
  const folderScope = useWorkspaceStore((s) => s.folderScope);
  const setFolderScope = useWorkspaceStore((s) => s.setFolderScope);
  const createView = useWorkspaceStore((s) => s.createView);
  const renameView = useWorkspaceStore((s) => s.renameView);
  const setViewPrompt = useWorkspaceStore((s) => s.setViewPrompt);
  const deleteView = useWorkspaceStore((s) => s.deleteView);
  const createNote = useWorkspaceStore((s) => s.createNote);
  const editorDirty = useWorkspaceStore((s) => s.editorDirty);

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

  const handleCreateView = async (): Promise<void> => {
    const name = await prompt({
      title: 'Create a saved view',
      body: 'Saved views are named groupings of badges across folders — references, not copies.',
      label: 'Name',
      placeholder: 'e.g. Chapter 3 reading list',
      validate: (v) => (v.trim().length === 0 ? 'A name is required.' : null),
    });
    if (name?.trim()) void createView(name.trim());
  };

  const handleNewNote = async (): Promise<void> => {
    const raw = await prompt({
      title: 'New note',
      label: 'Path',
      placeholder: 'untitled.md',
      defaultValue: 'untitled.md',
      body: 'Workspace-relative; folders auto-created. Extension defaults to .md.',
      validate: (v) => (v.trim().length === 0 ? 'A path is required.' : null),
    });
    if (!raw?.trim()) return;
    let name = raw.trim();
    if (!/\.[a-z0-9]+$/i.test(name)) name += '.md';
    void createNote(name);
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

  const handleEditViewPrompt = async (): Promise<void> => {
    if (!currentView) return;
    const view = views.find((v) => v.id === currentView);
    if (!view) return;
    const next = await prompt({
      title: `View prompt — ${view.name}`,
      body: 'A short description of this grouping, for the AI agent reading the view (.bh/views/<id>.json). Leave blank to clear.',
      label: 'Prompt',
      defaultValue: view.prompt ?? '',
      placeholder: 'e.g. Resources for the theorem-2 proof attempt',
    });
    // Allow blank → clear. Skip on Cancel (null).
    if (next === null) return;
    void setViewPrompt(currentView, next.trim());
  };

  const handleRenameView = async (): Promise<void> => {
    if (!currentView) return;
    const view = views.find((v) => v.id === currentView);
    if (!view) return;
    const next = await prompt({
      title: `Rename view "${view.name}"`,
      label: 'New name',
      defaultValue: view.name,
      placeholder: 'e.g. Chapter 3 reading list',
      validate: (v) => (v.trim().length === 0 ? 'A name is required.' : null),
    });
    const trimmed = next?.trim();
    if (trimmed && trimmed !== view.name) void renameView(currentView, trimmed);
  };

  const handleDeleteView = async (): Promise<void> => {
    if (!currentView) return;
    const view = views.find((v) => v.id === currentView);
    if (!view) return;
    const ok = await confirm({
      title: `Delete view "${view.name}"?`,
      body: 'The badges and files in it are untouched — only this saved grouping is removed.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (ok) void deleteView(currentView);
  };

  const handleViewChange = (value: string): void => {
    setCurrentView(value === '__main__' ? null : value);
    setFolderScope(null);
  };

  const handleWorkspaceChange = async (next: string): Promise<void> => {
    if (!next || next === current) return;
    if (editorDirty) {
      const ok = await confirm({
        title: 'You have unsaved edits',
        body: 'Switching workspaces will discard the unsaved edits in the current file.',
        confirmText: 'Discard and switch',
        destructive: true,
      });
      if (!ok) return;
    }
    void use(next);
  };

  const workspaceOptions = workspaces.map((ws) => ({
    value: ws.name,
    label: ws.name,
    // Show the path as a hint in the dropdown row so users with multiple
    // similarly-named workspaces (or symlinks, or cloned folders in
    // different locations) can tell them apart at a glance.
    hint: ws.path,
  }));
  const viewOptions = [
    { value: '__main__', label: 'Main canvas' },
    ...views.map((v) => ({
      value: v.id,
      label: v.name,
      hint: `${v.members.length} badge${v.members.length === 1 ? '' : 's'}`,
    })),
  ];

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
        // Many contextual buttons can crowd this row (workspace +
        // view-active + folder-scope all stack up). Scroll horizontally
        // when content exceeds width rather than clipping the buttons.
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
      <span
        style={{
          fontSize: font.size.body,
          fontWeight: font.weight.semibold,
          color: color.textPrimary,
          letterSpacing: -0.1,
        }}
      >
        BaseHalf
      </span>

      <span style={dividerStyle} aria-hidden />

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

      <Button onClick={() => void pickAndAdd()} disabled={busy}>
        {busy ? '…' : 'Add folder'}
      </Button>

      {current && (
        <>
          <Button
            variant="ghost"
            onClick={() => void handleRenameWorkspace()}
            disabled={busy}
            title="Rename this workspace (path + .bh/ untouched)"
          >
            Rename
          </Button>
          <Button variant="ghost" onClick={() => void handleRemove()} disabled={busy}>
            Remove
          </Button>
        </>
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
            variant="ghost"
            onClick={() => void handleEditFolderPrompt()}
            title="Edit this folder's badge prompt (what the AI agent reads about this folder)"
          >
            Edit folder prompt
          </Button>
          <span style={dividerStyle} aria-hidden />
        </>
      )}

      {current && (
        <>
          <span style={labelStyle}>View</span>
          <Select
            value={currentView ?? '__main__'}
            options={viewOptions}
            onChange={handleViewChange}
            minWidth={180}
            title="Switch between main canvas and saved views"
            testId="topbar-view-select"
          />
          <Button onClick={() => void handleCreateView()} title="Create a new saved view">
            New view
          </Button>
          {currentView && (
            <>
              <Button
                variant="ghost"
                onClick={() => void handleRenameView()}
                title="Rename this saved view"
              >
                Rename view
              </Button>
              <Button
                variant="ghost"
                onClick={() => void handleEditViewPrompt()}
                title="Edit this view's prompt (what the AI agent reads about this grouping)"
              >
                Edit prompt
              </Button>
              <Button
                variant="ghost"
                onClick={() => void handleDeleteView()}
                title="Delete this saved view (badges + files untouched)"
              >
                Delete view
              </Button>
            </>
          )}
        </>
      )}
    </header>
  );
};
