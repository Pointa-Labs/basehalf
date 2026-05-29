import { describe, expect, it } from 'vitest';
import { badgeType } from '../src/renderer/src/components/FileGlyph.js';

describe('badgeType — extension, dotfile, and extension-less name classification', () => {
  it('classifies common code extensions', () => {
    expect(badgeType('main.ts', false)).toBe('code');
    expect(badgeType('config.json', false)).toBe('code');
    expect(badgeType('script.sh', false)).toBe('code');
  });

  it('classifies text/doc + media extensions', () => {
    expect(badgeType('note.md', false)).toBe('text');
    expect(badgeType('data.csv', false)).toBe('text');
    expect(badgeType('photo.png', false)).toBe('image');
    expect(badgeType('paper.pdf', false)).toBe('pdf');
  });

  it('classifies dotfiles by the part after the leading dot', () => {
    expect(badgeType('.gitignore', false)).toBe('text');
    expect(badgeType('.editorconfig', false)).toBe('text');
    expect(badgeType('.npmrc', false)).toBe('text');
  });

  it('classifies extension-less known names (Dockerfile, Makefile, LICENSE, …)', () => {
    expect(badgeType('Dockerfile', false)).toBe('code');
    expect(badgeType('Makefile', false)).toBe('code');
    expect(badgeType('LICENSE', false)).toBe('text');
    expect(badgeType('README', false)).toBe('text');
    // Case-insensitive.
    expect(badgeType('makefile', false)).toBe('code');
    expect(badgeType('license', false)).toBe('text');
  });

  it('falls back to generic for unknown extensions / names', () => {
    expect(badgeType('archive.zip', false)).toBe('generic');
    expect(badgeType('mystery', false)).toBe('generic');
    expect(badgeType('data.bin', false)).toBe('generic');
  });

  it('returns folder for directories regardless of name', () => {
    expect(badgeType('Dockerfile', true)).toBe('folder');
    expect(badgeType('notes', true)).toBe('folder');
  });
});
