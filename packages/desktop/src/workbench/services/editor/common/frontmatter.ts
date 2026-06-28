// Split a leading YAML frontmatter block off a markdown document so the editor
// can round-trip the BODY through BlockNote while preserving the frontmatter
// VERBATIM (never sent through BlockNote, which can't round-trip YAML and would
// otherwise force the whole note view-only — the common case for notes that
// lead with a YAML front-matter block).
//
// The split is byte-exact and reversible: `frontmatter + body === content`
// always. Detection is STRICT and fails safe — if the leading `---` isn't a
// real frontmatter fence (no closing `---`), the whole document is treated as
// body (so a leading horizontal rule, or a setext-underlined heading, is left
// untouched and rendered normally). The worst case of a mis-detect is falling
// back to today's view-only behavior, never corrupting content.
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  // Must OPEN with a `---` fence on the very first line (only trailing
  // whitespace allowed before the newline).
  if (!/^---[ \t]*\r?\n/.test(content)) return { frontmatter: '', body: content };
  // Find the CLOSING `---` fence: a `---` line (optional trailing whitespace)
  // somewhere after the opening one, ending in a newline or EOF. Search from the
  // end of the opening line so a one-line `---` can't match itself.
  const openLineEnd = content.indexOf('\n');
  const close = /\r?\n---[ \t]*(?:\r?\n|$)/g;
  close.lastIndex = openLineEnd;
  const m = close.exec(content);
  if (!m) return { frontmatter: '', body: content };
  const end = m.index + m[0].length; // first index of the body (after closing fence + its newline)
  return { frontmatter: content.slice(0, end), body: content.slice(end) };
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  return frontmatter + body;
}
