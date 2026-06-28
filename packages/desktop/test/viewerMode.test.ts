import { describe, expect, it } from 'vitest';
import { extOf, modeOf } from '../src/workbench/browser/parts/editor/viewerMode.js';

describe('modeOf — deny-list routing: unknown / extension-less / code files open in the code editor', () => {
  // An allow-list left arbitrary extension-less names dead-ending at "No built-in
  // viewer". These route to the editable code editor (Monaco), where the binary
  // content-sniff is the safety net.
  it('routes arbitrary extension-less names to the code editor', () => {
    for (const name of ['VERSION', 'TODO', 'INSTALL', 'HACKING', 'CODEOWNERS', 'AUTHORS']) {
      expect(modeOf(name)).toBe('code');
    }
  });

  it('routes extension-less names nested in folders to the code editor', () => {
    expect(modeOf('src/cmd/VERSION')).toBe('code');
    expect(modeOf('deep/nested/dir/TODO')).toBe('code');
  });

  it('routes unknown extensions to the code editor (no allowlist to grow)', () => {
    for (const name of ['main.tf', 'infra.hcl', 'weird.foo', 'thing.bar', 'app.zig', 'x.nim']) {
      expect(modeOf(name)).toBe('code');
    }
  });

  it('routes dotfiles (name is the signal) to the code editor', () => {
    expect(modeOf('.gitignore')).toBe('code');
    expect(modeOf('repo/.dockerignore')).toBe('code');
    expect(modeOf('.editorconfig')).toBe('code');
  });

  it('routes known code/text extensions to the code editor', () => {
    for (const name of ['a.ts', 'b.py', 'c.json', 'd.conf', 'e.ini', 'f.env', 'g.yaml']) {
      expect(modeOf(name)).toBe('code');
    }
  });
});

describe('modeOf — dedicated viewers and open-in-app are preserved (no regressions)', () => {
  it('routes Markdown to the rich editor, plain text to the code editor', () => {
    expect(modeOf('readme.md')).toBe('md');
    expect(modeOf('notes.markdown')).toBe('md');
    // .txt is plain text, not Markdown — code-edited now (editable), so its raw
    // `*` / `#` aren't mis-rendered as rich formatting.
    expect(modeOf('log.txt')).toBe('code');
  });

  it('routes PDFs to the pdf viewer', () => {
    expect(modeOf('paper.pdf')).toBe('pdf');
  });

  it('routes inline-renderable media to their viewers', () => {
    expect(modeOf('pic.png')).toBe('image');
    expect(modeOf('pic.JPG')).toBe('image'); // case-insensitive
    expect(modeOf('clip.mp4')).toBe('video');
    expect(modeOf('song.mp3')).toBe('audio');
  });

  it('routes known non-text formats to open-in-system-app', () => {
    for (const name of [
      'doc.docx',
      'deck.pptx',
      'sheet.xlsx',
      'archive.zip',
      'installer.dmg',
      'tool.exe',
      'lib.so',
      'font.woff2',
      'photo.heic', // image we don't decode inline
      'song.flac', // audio we don't play inline
      'movie.mkv', // video we don't play inline
      'data.sqlite',
    ]) {
      expect(modeOf(name)).toBe('other');
    }
  });
});

describe('extOf — basename-scoped extension extraction', () => {
  it('ignores a dot in a parent directory name', () => {
    // Latent bug in the old path-global extOf: `my.app/README` reported `.app/readme`.
    expect(extOf('my.app/README')).toBe('');
    expect(modeOf('my.app/README')).toBe('code');
  });

  it('treats a leading-dot dotfile as extension-less', () => {
    expect(extOf('.gitignore')).toBe('');
    expect(extOf('dir/.env')).toBe('');
  });

  it('lowercases the extension', () => {
    expect(extOf('A.PNG')).toBe('.png');
    expect(extOf('Doc.DOCX')).toBe('.docx');
  });

  it('returns empty for names without an extension', () => {
    expect(extOf('Makefile')).toBe('');
    expect(extOf('VERSION')).toBe('');
  });
});
