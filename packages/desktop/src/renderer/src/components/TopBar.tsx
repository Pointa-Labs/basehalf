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

  const workspaceOptions = workspaces.map((ws) => ({ value: ws.name, label: ws.name }));
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
        <Button variant="ghost" onClick={() => void handleRemove()} disabled={busy}>
          Remove
        </Button>
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
