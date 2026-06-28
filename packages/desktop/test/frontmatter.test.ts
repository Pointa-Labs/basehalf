import { describe, expect, it } from 'vitest';
import {
  joinFrontmatter,
  splitFrontmatter,
} from '../src/workbench/services/editor/common/frontmatter.js';

describe('splitFrontmatter — byte-exact, fail-safe YAML frontmatter detection', () => {
  const roundTrips = (s: string) => {
    const { frontmatter, body } = splitFrontmatter(s);
    expect(joinFrontmatter(frontmatter, body)).toBe(s); // always reversible
    return { frontmatter, body };
  };

  it('splits a standard frontmatter note (LF)', () => {
    const { frontmatter, body } = roundTrips(
      '---\ntitle: Hi\ntags: [a, b]\n---\n\n# Body\n\ntext\n',
    );
    expect(frontmatter).toBe('---\ntitle: Hi\ntags: [a, b]\n---\n');
    expect(body).toBe('\n# Body\n\ntext\n');
  });

  it('handles CRLF line endings, preserving them verbatim', () => {
    const { frontmatter, body } = roundTrips('---\r\ntitle: Hi\r\n---\r\nbody\r\n');
    expect(frontmatter).toBe('---\r\ntitle: Hi\r\n---\r\n');
    expect(body).toBe('body\r\n');
  });

  it('handles a frontmatter-only file (no body)', () => {
    const { frontmatter, body } = roundTrips('---\nk: v\n---\n');
    expect(frontmatter).toBe('---\nk: v\n---\n');
    expect(body).toBe('');
  });

  it('handles a closing fence with no trailing newline (EOF)', () => {
    const { frontmatter, body } = roundTrips('---\nk: v\n---');
    expect(frontmatter).toBe('---\nk: v\n---');
    expect(body).toBe('');
  });

  it('does NOT treat a leading horizontal rule as frontmatter (no closing fence)', () => {
    const { frontmatter, body } = roundTrips('---\n\nJust a thematic break above, then prose.\n');
    expect(frontmatter).toBe('');
    expect(body).toBe('---\n\nJust a thematic break above, then prose.\n');
  });

  it('does NOT trigger on a setext heading underline (--- not on line 1)', () => {
    const { frontmatter, body } = roundTrips('Title\n---\n\nbody\n');
    expect(frontmatter).toBe('');
    expect(body).toBe('Title\n---\n\nbody\n');
  });

  it('does NOT trigger on plain content', () => {
    const { frontmatter, body } = roundTrips('# Heading\n\nNo frontmatter here.\n');
    expect(frontmatter).toBe('');
    expect(body).toBe('# Heading\n\nNo frontmatter here.\n');
  });

  it('does NOT trigger when the first line is --- with other text (--- foo)', () => {
    const { frontmatter, body } = roundTrips('--- not a fence\nk: v\n---\nbody\n');
    expect(frontmatter).toBe('');
    expect(body).toBe('--- not a fence\nk: v\n---\nbody\n');
  });

  it('keeps a --- that appears inside the body (after a real fence) in the body', () => {
    const { frontmatter, body } = roundTrips('---\nk: v\n---\nbefore\n\n---\n\nafter\n');
    expect(frontmatter).toBe('---\nk: v\n---\n');
    expect(body).toBe('before\n\n---\n\nafter\n');
  });

  it('tolerates trailing whitespace on the fences', () => {
    const { frontmatter, body } = roundTrips('---  \nk: v\n---\t\nbody\n');
    expect(frontmatter).toBe('---  \nk: v\n---\t\n');
    expect(body).toBe('body\n');
  });
});
