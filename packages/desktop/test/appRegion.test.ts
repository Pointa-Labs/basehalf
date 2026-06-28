import { describe, expect, it } from 'vitest';
import { selectRegion } from '../src/workbench/browser/workbenchRegion.js';

describe('selectRegion', () => {
  it('is welcome when no workspace is open, regardless of reachability', () => {
    expect(selectRegion(null, undefined)).toBe('welcome');
    expect(selectRegion(null, true)).toBe('welcome');
    expect(selectRegion(null, false)).toBe('welcome');
  });

  it('is recovery when a workspace is selected but its folder is gone', () => {
    expect(selectRegion('notes', false)).toBe('recovery');
  });

  it('is canvas for a reachable workspace', () => {
    expect(selectRegion('notes', true)).toBe('canvas');
  });

  it('falls through to canvas while reachability is still resolving (null/undefined)', () => {
    // A just-opened workspace must NOT flash the recovery surface before its
    // reachability check completes; only an explicit `false` is "folder gone".
    expect(selectRegion('notes', null)).toBe('canvas');
    expect(selectRegion('notes', undefined)).toBe('canvas');
  });
});
