import { describe, expect, it } from 'vitest';
import { highlightSegments } from '../src/renderer/src/lib/highlight.js';

const joined = (segs: { text: string }[]) => segs.map((s) => s.text).join('');
const matched = (segs: { text: string; match: boolean }[]) =>
  segs.filter((s) => s.match).map((s) => s.text);

describe('highlightSegments', () => {
  it('marks the matched run, case-insensitively, and round-trips the text', () => {
    const segs = highlightSegments('fix the Token bug', 'token');
    expect(joined(segs)).toBe('fix the Token bug');
    expect(matched(segs)).toEqual(['Token']); // original casing preserved
  });

  it('marks every occurrence', () => {
    const segs = highlightSegments('token token', 'token');
    expect(matched(segs)).toEqual(['token', 'token']);
    expect(joined(segs)).toBe('token token');
  });

  it('returns a single non-match segment for an empty / whitespace query', () => {
    expect(highlightSegments('anything', '')).toEqual([{ text: 'anything', match: false }]);
    expect(highlightSegments('anything', '   ')).toEqual([{ text: 'anything', match: false }]);
  });

  it('returns a single non-match segment when there is no match', () => {
    expect(highlightSegments('hello', 'zzz')).toEqual([{ text: 'hello', match: false }]);
  });

  it('matches literally, not as a regex', () => {
    const segs = highlightSegments('a.b axb', 'a.b');
    expect(matched(segs)).toEqual(['a.b']); // not 'axb'
  });

  it('handles a match at the very start and end', () => {
    expect(matched(highlightSegments('token here', 'token'))).toEqual(['token']);
    expect(matched(highlightSegments('the token', 'token'))).toEqual(['token']);
  });

  it('handles an empty text', () => {
    expect(highlightSegments('', 'x')).toEqual([{ text: '', match: false }]);
  });
});
