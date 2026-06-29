import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertWorkspaceRelativePath,
  resolveInsideWorkspace,
} from '../src/platform/workspace/node/workspacePath.js';

// Real filesystem fixture: a workspace with a normal file + a SYMLINK that
// escapes the root, plus an outside directory the symlink points into.
const ROOT = '/tmp/bh-wspath-test';
const WS = join(ROOT, 'ws');
const OUTSIDE = join(ROOT, 'outside');

describe('resolveInsideWorkspace — symlink-safe workspace containment', () => {
  beforeAll(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(WS, { recursive: true });
    mkdirSync(OUTSIDE, { recursive: true });
    writeFileSync(join(WS, 'doc.md'), '# ok\n');
    mkdirSync(join(WS, 'sub'), { recursive: true });
    writeFileSync(join(WS, 'sub', 'nested.md'), 'nested\n');
    writeFileSync(join(OUTSIDE, 'secret.txt'), 'SECRET\n');
    // A symlink INSIDE the workspace whose name looks innocent but escapes.
    symlinkSync(join(OUTSIDE, 'secret.txt'), join(WS, 'report.docx'));
  });
  afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

  it('allows a normal in-workspace file (returns its real abs path)', async () => {
    const r = await resolveInsideWorkspace(WS, 'doc.md');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.abs).toBe(join(realpathSync(WS), 'doc.md'));
  });

  it('allows a nested in-workspace file', async () => {
    const r = await resolveInsideWorkspace(WS, 'sub/nested.md');
    expect(r.ok).toBe(true);
  });

  it('REFUSES a symlink that escapes the workspace (the core vuln)', async () => {
    const r = await resolveInsideWorkspace(WS, 'report.docx');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outside the workspace/i);
  });

  it('refuses an absolute path', async () => {
    const r = await resolveInsideWorkspace(WS, '/etc/passwd');
    expect(r.ok).toBe(false);
  });

  it('refuses a .. path segment', async () => {
    const r = await resolveInsideWorkspace(WS, '../outside/secret.txt');
    expect(r.ok).toBe(false);
  });

  it('refuses a missing file (no guessing)', async () => {
    const r = await resolveInsideWorkspace(WS, 'does-not-exist.md');
    expect(r.ok).toBe(false);
  });

  it('refuses empty / non-string input', async () => {
    expect((await resolveInsideWorkspace(WS, '')).ok).toBe(false);
    expect((await resolveInsideWorkspace(WS, undefined)).ok).toBe(false);
  });
});

describe('assertWorkspaceRelativePath', () => {
  it('allows normalized workspace-relative paths', () => {
    expect(() => assertWorkspaceRelativePath('src/file.ts')).not.toThrow();
    expect(() => assertWorkspaceRelativePath('docs/nested/file.md')).not.toThrow();
  });

  it('rejects empty, root, absolute, traversal, and non-normalized paths', () => {
    for (const path of [
      '',
      '.',
      '/tmp/file',
      '\\tmp\\file',
      'C:\\tmp\\file',
      'C:tmp\\file',
      '../file',
      'src/../file',
      'src//file',
      'src/./file',
      'src/file/',
      'src/\0file',
    ]) {
      expect(() => assertWorkspaceRelativePath(path)).toThrow();
    }
  });
});
