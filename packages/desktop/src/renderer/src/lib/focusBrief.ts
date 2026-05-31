/**
 * Clean the raw `.bh/focus.md` brief for the clipboard.
 *
 * `focus.brief` returns the file verbatim — the right thing for the in-repo
 * agent that auto-reads focus.md and for `bh focus brief` inspection. But the
 * desktop "Copy brief" hands the brief to ANY chat (ChatGPT / Claude.ai), where
 * two parts are noise or actively misleading:
 *   - the bh-internal `# source-view: <id>` provenance marker, and
 *   - the footer comment, which tells "the agent" to follow refs deeper in
 *     `.bh/badges/` + `.bh/index/inbound.json` — files a pasted-into chat can't
 *     open.
 * The inlined prompts + ref-notes in the `active:` block make the brief
 * self-contained, so dropping those two leaves exactly the meaningful context.
 * Keeps the `# bh focus` title + the `intent:` + `active:` blocks.
 */
export function briefForClipboard(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trimStart();
    // bh-internal provenance — never useful in a pasted brief.
    if (trimmed.startsWith('# source-view:')) continue;
    // The footer is a `# (…)` comment block; it's the last thing in the file, so
    // dropping from its first line removes the whole footer.
    if (trimmed.startsWith('# (')) break;
    out.push(line);
  }
  const cleaned = out.join('\n').replace(/\n+$/, '');
  return cleaned.length > 0 ? `${cleaned}\n` : '';
}

/** One outbound reference inlined under a focused file: where it points + why. */
export interface BriefRef {
  readonly to: string;
  readonly note?: string;
}
/** One focused file as the brief presents it: the file, its prompt, its refs. */
export interface BriefItem {
  readonly file: string;
  readonly prompt?: string;
  readonly refs: readonly BriefRef[];
}
/** The brief, parsed into the shape the in-app preview renders. */
export interface BriefDisplay {
  readonly intent?: string;
  readonly items: readonly BriefItem[];
  /** `active:` was `(none)` — focused set is empty. */
  readonly empty: boolean;
}

/**
 * Parse the cleaned brief into a structured shape for the in-app preview, so the
 * user can SEE exactly what their agent reads — the intent, and per file its
 * prompt + reference-notes — instead of just file names. Mirrors the EXACT
 * `renderFocus` format (focus/store.ts): `intent: …`, `  - <file>`,
 * `      prompt: …`, `        -> <to>  (note: …)`. Runs `briefForClipboard`
 * first (drops the provenance marker + footer). On any drift it yields whatever
 * it could parse; callers fall back to the raw text for display, so a format
 * change degrades to monospaced rather than a blank panel.
 */
export function parseBriefForDisplay(raw: string): BriefDisplay {
  const lines = briefForClipboard(raw).split('\n');
  let intent: string | undefined;
  let empty = false;
  const items: { file: string; prompt?: string; refs: BriefRef[] }[] = [];
  let cur: { file: string; prompt?: string; refs: BriefRef[] } | null = null;
  for (const line of lines) {
    const intentM = /^intent: (.+)$/.exec(line);
    if (intentM?.[1] !== undefined) {
      intent = intentM[1];
      continue;
    }
    const itemM = /^ {2}- (.+)$/.exec(line);
    if (itemM?.[1] !== undefined) {
      cur = { file: itemM[1], refs: [] };
      items.push(cur);
      continue;
    }
    if (/^ {2}\(none\)$/.test(line)) {
      empty = true;
      continue;
    }
    const promptM = /^ {6}prompt: (.+)$/.exec(line);
    if (promptM?.[1] !== undefined && cur) {
      cur.prompt = promptM[1];
      continue;
    }
    const refM = /^ {8}-> (.+?)(?: {2}\(note: (.+)\))?$/.exec(line);
    const to = refM?.[1];
    if (to !== undefined && cur) {
      const note = refM?.[2];
      cur.refs.push(note !== undefined ? { to, note } : { to });
    }
    // Everything else (`# bh focus`, blanks, `active:`, `refs:`) is structure.
  }
  return { intent, items, empty };
}
