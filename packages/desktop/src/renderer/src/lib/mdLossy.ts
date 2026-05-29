/**
 * Round-trip loss detection for the Markdown editor.
 *
 * BlockNote's Markdown export (`blocksToMarkdownLossy`) is intentionally
 * lossy about *formatting* — it reflows soft-wrapped lines into one,
 * renumbers ordered lists, swaps `*`/`_` emphasis markers, normalizes
 * bullet characters, and collapses blank-line runs. None of that changes
 * what the document *means*.
 *
 * The editor must only fall back to view-only (refusing to let the user
 * type, so we can never silently overwrite their file) when the round-trip
 * drops real CONTENT — words, links — or STRUCTURE the editor can't
 * reconstruct: YAML frontmatter, tables, fenced code. Locking on cosmetic
 * churn is what made normal prose files (including our own demo) read-only
 * and made the editor feel absent.
 *
 * `canonical()` neutralizes exactly the cosmetic dimensions, so two
 * Markdown strings that render the same compare equal. It never deletes
 * words, so genuine content loss always survives as a diff — the guard
 * stays safe, just no longer trigger-happy.
 */

function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

/** A line that begins a new block — never folded into the previous line. */
function isBlockStart(line: string): boolean {
  const t = line.trimStart();
  return (
    t === '' ||
    /^#{1,6}\s/.test(t) || // heading
    /^([-+*])\s/.test(t) || // bullet list item
    /^\d+\.\s/.test(t) || // ordered list item
    /^>/.test(t) || // blockquote
    /^(```|~~~)/.test(t) || // code fence
    /^\|/.test(t) || // table row
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(t) // thematic break / frontmatter rule
  );
}

function canonical(md: string): string {
  const rawLines = md
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''));

  // 1. Fold soft-wrapped continuation lines back into their paragraph.
  //    A line continues the previous one only when neither sits in a code
  //    fence, the previous line has content, and this line doesn't open a
  //    new block. Paragraph breaks (blank lines) and block starts are kept,
  //    so a genuinely *merged* paragraph still reads as a diff.
  const joined: string[] = [];
  let inFence = false;
  for (const line of rawLines) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      joined.push(line);
      continue;
    }
    if (inFence) {
      joined.push(line); // code is verbatim — never fold
      continue;
    }
    const prev = joined.length > 0 ? joined[joined.length - 1] : undefined;
    const continues =
      prev !== undefined && prev !== '' && line !== '' && !isBlockStart(line) && !isFenceLine(prev);
    if (continues) {
      joined[joined.length - 1] = `${prev} ${line.trimStart()}`;
    } else {
      joined.push(line);
    }
  }

  return (
    joined
      .join('\n')
      // 2. Normalize list markers to a canonical form — bullet character
      //    (`*`/`-`/`+`) and ordered numbering are both cosmetic (renderers
      //    renumber). Normalizing rather than stripping keeps these lines as
      //    block-starts, so canonical() stays idempotent.
      .replace(/^([ \t]*)[-+*][ \t]+/gm, '$1- ')
      .replace(/^([ \t]*)\d+\.[ \t]+/gm, '$1- ')
      // 3. Strip emphasis / bold markers. The words stay; only the style does.
      .replace(/(\*\*|\*|__|_)/g, '')
      // 4. Collapse whitespace runs introduced by folding + stripping.
      .replace(/[ \t]{2,}/g, ' ')
      // 5. Collapse blank-line *runs* to a single blank line — keep ONE blank as
      //    a paragraph separator (dropping it entirely would merge a list and a
      //    following paragraph, and break idempotency). Then trim each line and
      //    the whole. A genuinely merged paragraph still reads as a diff.
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((l) => l.trim())
      .join('\n')
      .trim()
  );
}

/**
 * True when re-serializing `reserialized` lost real content/structure
 * relative to `original` — i.e. editing isn't safe and we should stay
 * view-only. False when the only differences are cosmetic formatting.
 */
export function isLossyRoundTrip(original: string, reserialized: string): boolean {
  return canonical(original) !== canonical(reserialized);
}

// Exposed for unit tests only.
export const __test = { canonical };
