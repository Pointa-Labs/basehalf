/**
 * Focus signal — the file the agent reads on every message to know what
 * the user is currently focused on. Published to <workspace>/.bh/focus.md
 * (Markdown, not JSON, so agents paste it into context without translation).
 *
 * Schema: SR-v0 §3.3.
 */

export interface FocusSetArgs {
  /** Explicit file list. Empty array clears focus. */
  readonly files?: readonly string[];
  /** Or, point at a saved view; its members become the active list. */
  readonly viewId?: string;
  /** Optional turn intent — "what I'm trying to do this turn". Inlined into
   *  focus.md as an `intent:` block. When a viewId is given, the view's own
   *  prompt is used as the intent unless this overrides it. */
  readonly intent?: string;
}
export interface FocusSetResult {
  readonly active: readonly string[];
}

/**
 * One active item in the focus brief, with the human's curated MEANING
 * inlined so the agent reads it in a single pass instead of re-fetching N
 * badge JSONs. This is the compound-thinking payload: the prompt is "what
 * the agent should know about this file", the ref notes are "why this link".
 */
export interface FocusItem {
  readonly file: string;
  readonly prompt?: string;
  readonly refs?: readonly { readonly to: string; readonly note?: string }[];
}

export type FocusGetArgs = Record<string, never>;
export interface FocusGetResult {
  readonly active: readonly string[];
  /** The turn intent (from `intent:` in focus.md), if any. Surfaced so a caller
   *  re-setting focus can preserve it instead of dropping the block. */
  readonly intent?: string;
}

export type FocusClearArgs = Record<string, never>;
export interface FocusClearResult {
  readonly cleared: true;
}

export type FocusInitArgs = Record<string, never>;
export interface FocusInitResult {
  /** True when this call wrote the empty template; false when it was already
   *  present and we left it alone. */
  readonly created: boolean;
}

export interface FocusResyncArgs {
  /** When given, resync is a no-op unless this file is in the active list —
   *  so a badge edit on an UNfocused file (e.g. eager materialize) doesn't
   *  rewrite focus.md. Omit to force a resync of the whole active list. */
  readonly file?: string;
}
export interface FocusResyncResult {
  /** True when focus.md was re-rendered (the file was active); false when the
   *  active list was empty or didn't include `file`. */
  readonly resynced: boolean;
}
