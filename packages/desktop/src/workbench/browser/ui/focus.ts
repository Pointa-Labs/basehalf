export function activeHTMLElement(): HTMLElement | null {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return null;
  const active = document.activeElement;
  return active instanceof HTMLElement ? active : null;
}

export function focusElementSafely(element: HTMLElement | null | undefined): void {
  if (typeof HTMLElement === 'undefined') return;
  if (!(element instanceof HTMLElement) || !element.isConnected) return;
  element.focus({ preventScroll: true });
}
