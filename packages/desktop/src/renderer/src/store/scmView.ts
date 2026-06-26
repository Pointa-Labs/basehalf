import { create } from 'zustand';

/**
 * Source Control view state lifted out of the SourceControl component so other
 * surfaces (the ⌘K Git mode) can drive it: switch to the Changes vs Graph tab,
 * and ask the graph to reveal a specific commit. Kept tiny and renderer-only.
 */
export type ScmTab = 'changes' | 'graph';

interface ScmViewState {
  tab: ScmTab;
  setTab: (t: ScmTab) => void;
  /** A commit hash the graph should reveal (expand + scroll) once, then clear. */
  focusCommit: string | null;
  /** From ⌘K "jump to commit": show the graph tab and reveal `hash`. */
  revealCommit: (hash: string) => void;
  /** Called by the graph once it has revealed the focused commit. */
  consumeFocus: () => void;
}

export const useScmViewStore = create<ScmViewState>((set) => ({
  tab: 'changes',
  setTab: (tab) => set({ tab }),
  focusCommit: null,
  revealCommit: (hash) => set({ tab: 'graph', focusCommit: hash }),
  consumeFocus: () => set({ focusCommit: null }),
}));
