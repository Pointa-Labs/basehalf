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
