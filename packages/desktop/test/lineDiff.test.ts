import { describe, expect, it } from 'vitest';
import { computeLineChanges } from '../src/renderer/src/lib/lineDiff.js';

describe('computeLineChanges', () => {
  it('identical → no changes', () => {
    expect(computeLineChanges('a\nb\nc', 'a\nb\nc')).toEqual([]);
  });

  it('a modified line', () => {
    expect(computeLineChanges('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'modify', startLine: 2, endLine: 2 },
    ]);
  });

  it('an added line at the end', () => {
    expect(computeLineChanges('a\nb', 'a\nb\nc')).toEqual([
      { kind: 'add', startLine: 3, endLine: 3 },
    ]);
  });

  it('added lines in the middle (a contiguous add block)', () => {
    expect(computeLineChanges('a\nc', 'a\nb1\nb2\nc')).toEqual([
      { kind: 'add', startLine: 2, endLine: 3 },
    ]);
  });

  it('a deleted line → a marker on the line now below it', () => {
    expect(computeLineChanges('a\nb\nc', 'a\nc')).toEqual([
      { kind: 'delete', startLine: 2, endLine: 2 },
    ]);
  });

  it('a replaced block → modify', () => {
    expect(computeLineChanges('a\nx\ny\nc', 'a\nX\nc')).toEqual([
      { kind: 'modify', startLine: 2, endLine: 2 },
    ]);
  });

  it('two separate edits', () => {
    expect(computeLineChanges('a\nb\nc\nd\ne', 'a\nB\nc\nd\nE')).toEqual([
      { kind: 'modify', startLine: 2, endLine: 2 },
      { kind: 'modify', startLine: 5, endLine: 5 },
    ]);
  });

  it('normalizes CRLF + a trailing newline', () => {
    expect(computeLineChanges('a\r\nb\r\n', 'a\nb\n')).toEqual([]);
  });

  it('everything new (no baseline)', () => {
    expect(computeLineChanges('', 'a\nb')).toEqual([{ kind: 'add', startLine: 1, endLine: 2 }]);
  });
});
