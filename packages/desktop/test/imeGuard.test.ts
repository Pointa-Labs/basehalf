import { describe, expect, it } from 'vitest';
import { isImeComposing } from '../src/workbench/browser/ui/imeGuard.js';

describe('isImeComposing', () => {
  it('is true while a React synthetic event reports composition', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
  });

  it('is true while a native event reports composition', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
  });

  it('is true for the legacy keyCode 229 processing key', () => {
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
  });

  it('is false for an ordinary Enter/Escape press', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 13 })).toBe(false);
    expect(isImeComposing({ isComposing: false, keyCode: 27 })).toBe(false);
    expect(isImeComposing({})).toBe(false);
  });
});
