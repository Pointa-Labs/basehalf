import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';

/**
 * workspace.importFile — the drag-a-file-in door. Copy semantics are the
 * product contract under test: ALWAYS a copy (source untouched), lands inside
 * the workspace, never clobbers (collision suffix + EXCL), source-already-
 * inside short-circuits, destination is realpath-contained like every write.
 * Runs against the REAL node:fs so binary fidelity and symlink behavior are
 * the production paths.
 */

let base: string;
let ws: string;
let outside: string;
// biome-ignore lint/suspicious/noExplicitAny: test-local core handle
let core: any;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'bh-import-'));
  ws = join(base, 'workspace');
  outside = join(base, 'outside');
  await mkdir(ws, { recursive: true });
  await mkdir(outside, { recursive: true });
  const cfg = join(base, 'cfg');
  await mkdir(cfg, { recursive: true });
  core = createCore({ configDir: cfg });
  await core.run('workspace.add', { path: ws, name: 'ws' });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('workspace.importFile', () => {
  it('copies an external file into the workspace root; source stays put', async () => {
    const src = join(outside, 'paper.md');
    await writeFile(src, '# external\n');
    const r = await core.run('workspace.importFile', { from: src });
    expect(r).toMatchObject({ path: 'paper.md', name: 'paper.md', imported: true });
    expect(await readFile(join(ws, 'paper.md'), 'utf8')).toBe('# external\n');
    // ALWAYS a copy — the original is untouched where the user keeps it.
    expect(await readFile(src, 'utf8')).toBe('# external\n');
  });

  it('copies binary content byte-for-byte (the PDF/image case)', async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80, 0x01]);
    const src = join(outside, 'scan.pdf');
    await writeFile(src, bytes);
    const r = await core.run('workspace.importFile', { from: src });
    expect(r.supported).toBe(true);
    expect(Buffer.from(await readFile(join(ws, 'scan.pdf')))).toEqual(bytes);
  });

  it('copies into a workspace-relative destination folder', async () => {
    await mkdir(join(ws, 'inbox'));
    const src = join(outside, 'note.txt');
    await writeFile(src, 'hi');
    const r = await core.run('workspace.importFile', { from: src, to: 'inbox' });
    expect(r.path).toBe('inbox/note.txt');
    expect(await readFile(join(ws, 'inbox', 'note.txt'), 'utf8')).toBe('hi');
  });

  it('never clobbers — a name collision picks -2, then -3', async () => {
    await writeFile(join(ws, 'report.pdf'), 'mine');
    const src = join(outside, 'report.pdf');
    await writeFile(src, 'theirs');
    const first = await core.run('workspace.importFile', { from: src });
    expect(first.path).toBe('report-2.pdf');
    const second = await core.run('workspace.importFile', { from: src });
    expect(second.path).toBe('report-3.pdf');
    // The user's existing file is byte-identical to before.
    expect(await readFile(join(ws, 'report.pdf'), 'utf8')).toBe('mine');
  });

  it('suffixes an extension-less name after the whole name', async () => {
    await writeFile(join(ws, 'LICENSE'), 'a');
    const src = join(outside, 'LICENSE');
    await writeFile(src, 'b');
    const r = await core.run('workspace.importFile', { from: src });
    expect(r.path).toBe('LICENSE-2');
  });

  it('short-circuits when the source already lives inside the workspace', async () => {
    await writeFile(join(ws, 'own.md'), 'already here');
    const r = await core.run('workspace.importFile', { from: join(ws, 'own.md') });
    expect(r).toMatchObject({ path: 'own.md', imported: false });
    // No duplicate was bred.
    expect(await readFile(join(ws, 'own.md'), 'utf8')).toBe('already here');
  });

  it('short-circuits a symlink whose target is inside the workspace', async () => {
    await writeFile(join(ws, 'real.md'), 'target');
    const link = join(outside, 'alias.md');
    await symlink(join(ws, 'real.md'), link);
    const r = await core.run('workspace.importFile', { from: link });
    expect(r).toMatchObject({ path: 'real.md', imported: false });
  });

  it('rejects a directory source with a tagged code (renderer routes it to add-workspace)', async () => {
    await expect(core.run('workspace.importFile', { from: outside })).rejects.toMatchObject({
      code: 'IS_DIRECTORY',
    });
  });

  it('rejects a missing source with PATH_NOT_FOUND', async () => {
    await expect(
      core.run('workspace.importFile', { from: join(outside, 'gone.md') }),
    ).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
  });

  it('rejects a relative source path', async () => {
    await expect(core.run('workspace.importFile', { from: 'paper.md' })).rejects.toThrow(
      /absolute/,
    );
  });

  it('rejects a destination folder that escapes the workspace', async () => {
    const src = join(outside, 'x.md');
    await writeFile(src, 'x');
    await expect(
      core.run('workspace.importFile', { from: src, to: '../outside' }),
    ).rejects.toThrow();
    await expect(core.run('workspace.importFile', { from: src, to: '/etc' })).rejects.toThrow();
  });

  it('rejects a destination folder that is a symlink out of the workspace', async () => {
    await symlink(outside, join(ws, 'exit'));
    const src = join(outside, 'x.md');
    await writeFile(src, 'x');
    await expect(core.run('workspace.importFile', { from: src, to: 'exit' })).rejects.toThrow();
  });

  it('rejects a missing destination folder', async () => {
    const src = join(outside, 'x.md');
    await writeFile(src, 'x');
    await expect(core.run('workspace.importFile', { from: src, to: 'nope' })).rejects.toThrow(
      /not a folder/,
    );
  });

  it('flags unsupported types so callers skip canvas placement', async () => {
    const src = join(outside, 'tool.bin');
    await writeFile(src, 'x');
    const r = await core.run('workspace.importFile', { from: src });
    expect(r.supported).toBe(false);
    expect(await readFile(join(ws, 'tool.bin'), 'utf8')).toBe('x');
  });
});
