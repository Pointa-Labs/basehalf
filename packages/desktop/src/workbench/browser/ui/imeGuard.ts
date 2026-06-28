/**
 * True while an IME (Chinese/Japanese/Korean input method) is mid-composition.
 *
 * During composition, pressing Enter CONFIRMS a candidate and Escape CANCELS it
 * — neither should trigger the app's "commit this field" / "close this tab"
 * handlers. Without this guard every Enter-to-save field and the Esc-to-close
 * editor mis-fire for CJK users, so "write one honest sentence" — the product's
 * core action — is unreliable for an entire language group.
 *
 * `isComposing` is the standard signal; `keyCode === 229` is the legacy
 * "processing key" some IMEs still report, kept as a belt-and-suspenders.
 * Accepts either a React synthetic keyboard event or a native one.
 */
export function isImeComposing(e: {
  nativeEvent?: { isComposing?: boolean };
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return Boolean(e.nativeEvent?.isComposing ?? e.isComposing) || e.keyCode === 229;
}
