import { describe, expect, it } from 'vitest';
import { briefForClipboard } from '../src/renderer/src/lib/focusBrief.js';

// The exact shape renderFocus (core) emits for a view-sourced focus.
const RAW = `# bh focus

intent: cram for the exam

active:
  - theory.md
      prompt: the thesis behind the product
      refs:
        -> practice.md  (note: this is the theory in motion)

# source-view: exam-prep
# (Updated automatically by bh GUI. Agent should read this at every message.
# 'active' = files the user is focused on, with their prompts + reference notes
# inlined above. Follow the refs deeper in .bh/badges/ + .bh/index/inbound.json
# on your own budget if you need more.)
`;

describe('briefForClipboard', () => {
  it('keeps the title, intent, and inlined active block', () => {
    const out = briefForClipboard(RAW);
    expect(out).toContain('# bh focus');
    expect(out).toContain('intent: cram for the exam');
    expect(out).toContain('- theory.md');
    expect(out).toContain('prompt: the thesis behind the product');
    expect(out).toContain('-> practice.md  (note: this is the theory in motion)');
  });

  it('strips the bh-internal provenance marker', () => {
    expect(briefForClipboard(RAW)).not.toContain('# source-view');
  });

  it('strips the .bh/-pointing footer comment block', () => {
    const out = briefForClipboard(RAW);
    expect(out).not.toContain('Updated automatically');
    expect(out).not.toContain('.bh/badges/');
  });

  it('ends with a single trailing newline, no dangling blank lines', () => {
    const out = briefForClipboard(RAW);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  it('returns empty string when nothing meaningful remains', () => {
    expect(briefForClipboard('# source-view: x\n# (footer)\n')).toBe('');
    expect(briefForClipboard('')).toBe('');
  });

  it('is a no-op (besides trailing trim) on a files-focus brief with no marker/footer', () => {
    const filesBrief = '# bh focus\n\nactive:\n  - a.md\n';
    expect(briefForClipboard(filesBrief)).toBe('# bh focus\n\nactive:\n  - a.md\n');
  });
});
