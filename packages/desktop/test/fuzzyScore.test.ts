import { describe, expect, it } from 'vitest';
import { createMatches, fuzzyMatch } from '../src/workbench/common/quickaccess/fuzzyScore.js';

/** Helper: the numeric score, or null when there's no match. */
function score(pattern: string, target: string): number | null {
  const r = fuzzyMatch(pattern, target);
  return r ? r[0] : null;
}

/** Helper: rank `targets` best-first for `pattern`, dropping non-matches. */
function rank(pattern: string, targets: string[]): string[] {
  return targets
    .map((t) => ({ t, s: fuzzyMatch(pattern, t) }))
    .filter((x): x is { t: string; s: NonNullable<typeof x.s> } => x.s !== undefined)
    .sort((a, b) => b.s[0] - a.s[0])
    .map((x) => x.t);
}

describe('fuzzyMatch — editor-style fuzzy scoring', () => {
  it('matches non-contiguous initials (the whole point over substring)', () => {
    // "cmdpal" is NOT a substring of "CommandPalette" but is a fuzzy match.
    expect(score('cmdpal', 'CommandPalette.tsx')).not.toBeNull();
    expect(score('focmd', 'focus.md')).not.toBeNull();
  });

  it('returns null when the pattern chars do not occur in order', () => {
    expect(score('xyz', 'focus.md')).toBeNull();
    // Right letters, wrong order → no in-order match.
    expect(score('dm', 'md')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(score('CMDPAL', 'CommandPalette.tsx')).not.toBeNull();
    expect(score('CommandPalette', 'commandpalette.tsx')).not.toBeNull();
  });

  it('treats an empty pattern as a neutral (everything) match', () => {
    expect(score('', 'anything.ts')).toBe(0);
  });

  it('ranks a stronger word-boundary / prefix match above a scattered one', () => {
    // Prefix beats mid-word scatter.
    expect(score('road', 'roadmap.md')).toBeGreaterThan(
      score('road', 'aroundbroadway.md') ?? Number.NEGATIVE_INFINITY,
    );
  });

  it('ranks an exact full match at the very top', () => {
    const ranked = rank('focus.md', ['out-of-focus.md', 'focus.md', 'focusing.md']);
    expect(ranked[0]).toBe('focus.md');
  });

  it('rewards a camelCase boundary hit over the same letter mid-word', () => {
    // Gap is identical (two skipped chars) in both, so this isolates the
    // camelCase bonus: "fooBar" hits 'B' on an upper-case boundary, "foobar"
    // hits 'b' buried mid-word.
    expect(score('fb', 'fooBar')).toBeGreaterThan(
      score('fb', 'foobar') ?? Number.NEGATIVE_INFINITY,
    );
  });
});

describe('createMatches — highlight ranges from a FuzzyScore', () => {
  it('reports the matched character offsets', () => {
    const r = fuzzyMatch('foc', 'focus.md');
    expect(r).not.toBeUndefined();
    const matches = createMatches(r);
    // "foc" is the contiguous prefix → one run covering offsets 0..3.
    expect(matches).toEqual([{ start: 0, end: 3 }]);
  });

  it('splits into multiple runs for non-contiguous matches', () => {
    const r = fuzzyMatch('fm', 'focus.md');
    const matches = createMatches(r);
    // 'f' at 0, 'm' at 6 → two separate single-char runs.
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches[0]?.start).toBe(0);
  });

  it('returns no ranges for an undefined (no-match) score', () => {
    expect(createMatches(undefined)).toEqual([]);
  });
});
