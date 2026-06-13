import { describe, expect, it } from 'vitest';
import { fileUrl } from '../src/renderer/src/lib/fileUrl.js';

describe('fileUrl', () => {
  it('keeps a plain path readable (slashes intact)', () => {
    expect(fileUrl('/Users/x/notes/a.png')).toBe('file:///Users/x/notes/a.png');
  });

  it('encodes spaces', () => {
    expect(fileUrl('/Users/x/my notes/a.png')).toBe('file:///Users/x/my%20notes/a.png');
  });

  it('encodes # and ? that would otherwise start a fragment/query', () => {
    expect(fileUrl('/x/draft #2.png')).toBe('file:///x/draft%20%232.png');
    expect(fileUrl('/x/why?.pdf')).toBe('file:///x/why%3F.pdf');
  });

  it('encodes a literal percent', () => {
    expect(fileUrl('/x/100%.png')).toBe('file:///x/100%25.png');
  });
});
