/**
 * Shared dialog-driven action flows.
 *
 * The "new note" + "new view" prompts are reachable from TWO places now:
 * the TopBar buttons and the global keyboard shortcuts (Cmd+N / Cmd+Shift+N
 * registered in App.tsx). Centralising them here means the dialog copy,
 * validation, and post-prompt store call all stay in one spot — clicking
 * the button and typing the shortcut produce the same UX.
 */

import { prompt } from '../components/Dialog.js';
import { useWorkspaceStore } from '../store/workspace.js';

/** Default location for the demo workspace. Both the Onboarding "Try a
 *  demo" button and the palette "Try a demo workspace…" action use this
 *  path so they're idempotent against each other (createDemo itself is
 *  also idempotent on second-run with the same path — see workspace.createDemo). */
export function defaultDemoPath(): string {
  return `${window.bh.homeDir || '/tmp'}/BaseHalf-Demo`;
}

/** Trigger the demo workspace generator at the default path. Wraps the
 *  store action so callers don't need to know the path convention. */
export function createDemoAtDefault(): Promise<void> {
  return useWorkspaceStore.getState().createDemo(defaultDemoPath());
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

/** Prompt for a name and create a new saved view. */
export async function promptForNewView(): Promise<void> {
  const state = useWorkspaceStore.getState();
  if (state.current === null) return;
  const name = await prompt({
    title: 'Create a saved view',
    body: 'Saved views are named groupings of badges across folders — references, not copies.',
    label: 'Name',
    placeholder: 'e.g. Chapter 3 reading list',
    validate: (v) => (v.trim().length === 0 ? 'A name is required.' : null),
  });
  if (name?.trim()) void state.createView(name.trim());
}
