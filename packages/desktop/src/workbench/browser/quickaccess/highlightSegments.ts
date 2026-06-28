/**
 * Split `text` into consecutive segments, marking which ones match `query`
 * (case-insensitive, literal substring — the same matching the command palette
 * and content search use). Lets a row bold the matched run so results are
 * scannable ("why/where did this match?") without re-implementing highlighting
 * per call site.
 *
 * - Empty / whitespace-only query → a single non-match segment (the whole text).
 * - Matching is literal (not regex), so a query like `a.b` highlights `a.b`, not
 *   "a, any char, b".
 * - Adjacent matches are kept as separate segments; callers just style matches.
 */
export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (needle === '' || text === '') return [{ text, match: false }];
  const hay = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = hay.indexOf(needle, i);
    if (hit === -1) {
      segments.push({ text: text.slice(i), match: false });
      break;
    }
    if (hit > i) segments.push({ text: text.slice(i, hit), match: false });
    segments.push({ text: text.slice(hit, hit + needle.length), match: true });
    i = hit + needle.length;
  }
  return segments;
}
