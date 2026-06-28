import { useEffect } from 'react';
import { resolveTerminalKeybinding, runTerminalAction } from './terminalActions.js';
import { useTerminalStore } from './terminalStore.js';

export function useTerminalKeymap(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const state = useTerminalStore.getState();
      const action = resolveTerminalKeybinding(event, {
        terminalFocused: state.focused,
        targetEditable: isEditableElement(document.activeElement),
      });
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runTerminalAction(action, state);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.isContentEditable ||
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT'
  );
}
