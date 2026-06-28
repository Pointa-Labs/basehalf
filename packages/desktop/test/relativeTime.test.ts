import { describe, expect, it } from 'vitest';
import { relativeTime } from '../src/workbench/browser/parts/editor/relativeTime.js';

const NOW = 1_700_000_000_000; // fixed "now" in ms

describe('relativeTime', () => {
  it('shows "just now" within 10s', () => {
    expect(relativeTime(NOW / 1000 - 3, NOW)).toBe('just now');
  });

  it('singular vs plural', () => {
    expect(relativeTime(NOW / 1000 - 60, NOW)).toBe('1 minute ago');
    expect(relativeTime(NOW / 1000 - 120, NOW)).toBe('2 minutes ago');
    expect(relativeTime(NOW / 1000 - 3 * 3600, NOW)).toBe('3 hours ago');
  });

  it('rolls up to days / weeks / months / years', () => {
    expect(relativeTime(NOW / 1000 - 2 * 86400, NOW)).toBe('2 days ago');
    expect(relativeTime(NOW / 1000 - 14 * 86400, NOW)).toBe('2 weeks ago');
    expect(relativeTime(NOW / 1000 - 90 * 86400, NOW)).toBe('2 months ago');
    expect(relativeTime(NOW / 1000 - 800 * 86400, NOW)).toBe('2 years ago');
  });

  it('never goes negative for a future timestamp', () => {
    expect(relativeTime(NOW / 1000 + 5000, NOW)).toBe('just now');
  });
});
