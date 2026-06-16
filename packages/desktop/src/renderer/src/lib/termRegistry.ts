/**
 * Pane → xterm instance registry.
 *
 * Each TerminalView keeps its xterm instance in a local ref, but the dock's
 * context menu needs to reach the RIGHT pane's terminal to run Copy / Paste /
 * Select All / Clear. Rather than thread the instance up through props, each
 * view registers itself here by pane id on mount and unregisters on unmount;
 * the menu looks it up by the pane the user right-clicked.
 */

import type { Terminal as XTerm } from '@xterm/xterm';

const registry = new Map<string, XTerm>();

export const termRegistry = {
  register(paneId: string, term: XTerm): void {
    registry.set(paneId, term);
  },
  unregister(paneId: string): void {
    registry.delete(paneId);
  },
  get(paneId: string): XTerm | undefined {
    return registry.get(paneId);
  },
};
