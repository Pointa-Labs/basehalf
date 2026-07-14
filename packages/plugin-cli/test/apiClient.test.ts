import { describe, expect, it } from 'vitest';
import { normalizeServer } from '../src/apiClient.js';

describe('publishing server boundary', () => {
  it('allows production HTTPS and loopback HTTP only', () => {
    expect(normalizeServer('https://basehalf.com/plugins')).toBe('https://basehalf.com');
    expect(normalizeServer('http://localhost:4000')).toBe('http://localhost:4000');
    expect(() => normalizeServer('http://example.com')).toThrow('HTTPS');
    expect(() => normalizeServer('https://user:secret@example.com')).toThrow('credentials');
  });
});
