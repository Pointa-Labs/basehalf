import { create } from 'zustand';

/**
 * Source Control view state lifted out of the SourceControl component so other
 * surfaces (the ⌘K Git mode) can drive it. VS Code-style: Changes and Graph are
 * coexisting collapsible sections (not a tab toggle); the palette can open either
 * section and ask the graph to reveal a specific commit.
 */
interface ScmViewState {
  /** The Changes section's open state (commit box + file groups). */
  changesOpen: boolean;
  /** The Graph (commit DAG) section's open state. */
  graphOpen: boolean;
  setChangesOpen: (open: boolean) => void;
  setGraphOpen: (open: boolean) => void;
  /** A commit hash the graph should reveal (expand + scroll) once, then clear. */
  focusCommit: string | null;
  /** From ⌘K "jump to commit": open the graph section and reveal `hash`. */
  revealCommit: (hash: string) => void;
  /** Called by the graph once it has revealed the focused commit. */
  consumeFocus: () => void;
}

export const useScmViewStore = create<ScmViewState>((set) => ({
  changesOpen: true,
  graphOpen: true,
  setChangesOpen: (changesOpen) => set({ changesOpen }),
  setGraphOpen: (graphOpen) => set({ graphOpen }),
  focusCommit: null,
  revealCommit: (hash) => set({ graphOpen: true, focusCommit: hash }),
  consumeFocus: () => set({ focusCommit: null }),
}));
