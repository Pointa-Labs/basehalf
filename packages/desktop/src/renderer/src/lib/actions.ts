/**
 * Shared dialog-driven action flows.
 *
 * The "new note" prompt is reachable from TWO places: the TopBar button and
 * the global Cmd+N shortcut (registered in App.tsx). Centralising it here means
 * the dialog copy, validation, and post-prompt store call all stay in one spot
 * — clicking the button and typing the shortcut produce the same UX.
 */

import { confirm, prompt } from '../components/Dialog.js';
import { useWorkspaceStore } from '../store/workspace.js';

/** Default location for the demo workspace. Both the welcome page's "Open a
 *  demo" button and the palette "Try a demo workspace…" action use this
 *  path so they're idempotent against each other (createDemo itself is
 *  also idempotent on second-run with the same path — see workspace.createDemo). */
export function defaultDemoPath(): string {
  return `${window.bh.homeDir || '/tmp'}/BaseHalf-Demo`;
}

/** Cosmetic: collapse a leading `~/...` if the path lives under the user's
 *  home dir. Display-only — never round-trip back to bh APIs (which want
 *  absolute paths). Returns the original path unchanged on non-Mac/Linux
 *  hosts where homeDir is empty, or for paths outside the home tree. */
export function tildifyPath(path: string): string {
  const home = window.bh.homeDir;
  if (!home) return path;
  if (path === home) return '~';
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

/** Trigger the demo workspace generator at the default path. Wraps the
 *  store action so callers don't need to know the path convention. */
export function createDemoAtDefault(): Promise<void> {
  return useWorkspaceStore.getState().createDemo(defaultDemoPath());
}

// Workspace management dialogs. Reachable from the File menu (App.tsx wires the
// main-process menu events here); deliberately NOT in the command palette —
// destructive/rare management ops don't belong one mistyped Enter away from
// "open a file". These read live state via getState() so callers don't need
// store hooks.
export async function renameActiveWorkspace(): Promise<void> {
  const { current, workspaces, renameWorkspace } = useWorkspaceStore.getState();
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
      if (t === current) return null;
      if (workspaces.some((w) => w.name === t)) return `Name "${t}" is already in use.`;
      return null;
    },
  });
  const trimmed = next?.trim();
  if (trimmed && trimmed !== current) void renameWorkspace(current, trimmed);
}

export async function removeActiveWorkspace(): Promise<void> {
  const { current, remove } = useWorkspaceStore.getState();
  if (!current) return;
  const ok = await confirm({
    title: `Remove workspace "${current}"?`,
    body: 'The folder and its files stay on disk; only the registration is removed.',
    confirmText: 'Remove',
    destructive: true,
  });
  if (ok) void remove(current);
}

/** Prompt for a workspace-relative path and create an empty MD note.
 *  No-op (without a dialog) if there's no current workspace, since
 *  workspace.writeFile needs one. */
export async function promptForNewNote(): Promise<void> {
  const state = useWorkspaceStore.getState();
  if (state.current === null) return;
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
  void state.createNote(name);
}
