import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import { isContained } from '../src/kernel/contain.js';

/**
 * Symlink / path-traversal workspace-escape suite — the CLASS audited after
 * the `shell:open-path` finding. A BaseHalf workspace is "a folder you drop
 * in" (cloned / synced / attacker-crafted), and the whole `.bh/` tree travels
 * with it in git. A planted symlink whose NAME is innocuous (no `..`, not
 * absolute) escapes once `node:fs` follows it. The string guard
 * (`assertWorkspaceRelative`) can't see the `..` in the symlink's on-disk
 * TARGET; only realpath containment (`kernel/contain.ts`) catches it.
 *
 * These run against the REAL `node:fs` (no mock) with REAL symlinks, end to
 * end through `createCore()`, so the actual realpath/lstat code paths execute.
 * Every escape case asserts BOTH that the op is refused AND that the outside
 * file did not leak / was not written. Positive cases prove no false
 * rejections — including the macOS reality that the temp root itself sits
 * behind a symlink (/var -> /private/var).
 */

let base: string;
let ws: string;
let outside: string;
// biome-ignore lint/suspicious/noExplicitAny: test-local core handle
let core: any;

async function setup(): Promise<void> {
  base = await mkdtemp(join(tmpdir(), 'bh-escape-'));
  ws = join(base, 'workspace');
  outside = join(base, 'outside');
  await mkdir(ws, { recursive: true });
  await mkdir(outside, { recursive: true });
  const cfg = join(base, 'cfg');
  await mkdir(cfg, { recursive: true });
  core = createCore({ configDir: cfg });
  // Registers ws as current + materializes (empty) + seeds focus.md + inbound.json.
  await core.run('workspace.add', { path: ws, name: 'ws' });
}

beforeEach(setup);
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('isContained (pure)', () => {
  it('accepts the root itself and strict descendants, rejects siblings/escapes', () => {
    expect(isContained('/a/b', '/a/b')).toBe(true);
    expect(isContained('/a/b', '/a/b/c')).toBe(true);
    expect(isContained('/a/b', '/a/bc')).toBe(false); // prefix-but-not-child
    expect(isContained('/a/b', '/a')).toBe(false);
    expect(isContained('/a/b', '/x')).toBe(false);
  });
});

describe('workspace.readFile', () => {
  it('refuses to read THROUGH a file-symlink that points outside the workspace', async () => {
    await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET outside contents');
    await symlink(join(outside, 'secret.txt'), join(ws, 'notes.md'));
    await expect(core.run('workspace.readFile', { path: 'notes.md' })).rejects.toThrow(
      /outside the workspace/,
    );
  });

  it('still reads a legitimate in-workspace file (no false rejection, symlinked root)', async () => {
    await writeFile(join(ws, 'real.md'), 'hello world');
    const res = await core.run('workspace.readFile', { path: 'real.md' });
    expect(res.content).toBe('hello world');
  });
});

describe('workspace.writeFile', () => {
  it('refuses to overwrite an outside file through an existing symlink leaf (editor save)', async () => {
    await writeFile(join(outside, 'victim.txt'), 'IMPORTANT USER DATA DO NOT TOUCH');
    await symlink(join(outside, 'victim.txt'), join(ws, 'config.md'));
    await expect(
      core.run('workspace.writeFile', { path: 'config.md', content: 'EVIL' }),
    ).rejects.toThrow(/outside the workspace/);
    expect(await readFile(join(outside, 'victim.txt'), 'utf8')).toBe(
      'IMPORTANT USER DATA DO NOT TOUCH',
    );
  });

  it('refuses to PLANT a new file under a symlinked directory (New Note)', async () => {
    await symlink(outside, join(ws, 'drafts')); // drafts -> outside (dir symlink)
    await expect(
      core.run('workspace.writeFile', { path: 'drafts/evil.plist', content: 'x' }),
    ).rejects.toThrow(/outside the workspace/);
    expect(existsSync(join(outside, 'evil.plist'))).toBe(false);
  });

  it('still writes a legitimate new note, auto-creating folders (no false rejection)', async () => {
    const res = await core.run('workspace.writeFile', { path: 'sub/new/note.md', content: 'hi' });
    expect(res.bytes).toBe(2);
    expect(await readFile(join(ws, 'sub/new/note.md'), 'utf8')).toBe('hi');
  });
});

describe('badges store', () => {
  it('refuses badge.get through a symlinked badge JSON pointing outside', async () => {
    await mkdir(join(ws, '.bh/badges'), { recursive: true });
    await writeFile(
      join(outside, 'leak.json'),
      JSON.stringify({ file: 'intro.md', kind: 'file', prompt: 'LEAKED' }),
    );
    await symlink(join(outside, 'leak.json'), join(ws, '.bh/badges/intro.md.json'));
    await expect(core.run('badge.get', { file: 'intro.md' })).rejects.toThrow(
      /outside the workspace/,
    );
  });

  it('badge.list does NOT descend a directory-symlink planted in .bh/badges/', async () => {
    await mkdir(join(ws, '.bh/badges'), { recursive: true });
    await mkdir(join(outside, 'sub'), { recursive: true });
    await writeFile(
      join(outside, 'sub', 'ext.json'),
      JSON.stringify({ file: 'ext', kind: 'file' }),
    );
    await symlink(outside, join(ws, '.bh/badges/escape')); // dir symlink inside badges
    const { badges } = await core.run('badge.list', {});
    expect(badges.find((b: { file: string }) => b.file === 'ext')).toBeUndefined();
  });

  it('refuses badge.set whose JSON path routes through a symlinked dir in .bh/badges/', async () => {
    await mkdir(join(ws, '.bh/badges'), { recursive: true });
    await symlink(outside, join(ws, '.bh/badges/out')); // out -> outside
    await expect(core.run('badge.set', { file: 'out/pwned', patch: {} })).rejects.toThrow(
      /outside the workspace/,
    );
    expect(existsSync(join(outside, 'pwned.json'))).toBe(false);
  });

  it('still lists legitimately created badges (no false rejection)', async () => {
    await writeFile(join(ws, 'doc.md'), '# doc');
    await core.run('workspace.use', { name: 'ws' }); // ensure current
    await core.run('badge.set', { file: 'doc.md', patch: { prompt: 'x' } }); // annotate → real badge
    const { badges } = await core.run('badge.list', {});
    expect(badges.find((b: { file: string }) => b.file === 'doc.md')).toBeDefined();
  });
});

describe('focus store', () => {
  it('refuses read AND write through a symlinked .bh/focus.md, never clobbering the target', async () => {
    await rm(join(ws, '.bh/focus.md'));
    await writeFile(join(outside, 'ftarget.md'), 'EXTERNAL FOCUS DATA');
    await symlink(join(outside, 'ftarget.md'), join(ws, '.bh/focus.md'));
    await expect(core.run('focus.set', { files: ['a.md'] })).rejects.toThrow(
      /outside the workspace/,
    );
    expect(await readFile(join(outside, 'ftarget.md'), 'utf8')).toBe('EXTERNAL FOCUS DATA');
    await expect(core.run('focus.get', {})).rejects.toThrow(/outside the workspace/);
  });
});

describe('inbound store', () => {
  it('refuses to write through a symlinked .bh/index/inbound.json (no outside clobber)', async () => {
    await rm(join(ws, '.bh/index/inbound.json'));
    await writeFile(join(outside, 'idx.json'), 'EXTERNAL INDEX');
    await symlink(join(outside, 'idx.json'), join(ws, '.bh/index/inbound.json'));
    await expect(core.run('inbound.addRef', { from: 'a.md', to: 'b.md' })).rejects.toThrow(
      /outside the workspace/,
    );
    expect(await readFile(join(outside, 'idx.json'), 'utf8')).toBe('EXTERNAL INDEX');
  });
});

describe('materialize walk', () => {
  it('does NOT materialize badges for files under a symlinked directory to outside', async () => {
    await writeFile(join(outside, 'secret.md'), 'SECRET');
    const fresh = join(base, 'ws2');
    await mkdir(fresh, { recursive: true });
    await symlink(outside, join(fresh, 'innocent')); // innocent -> outside
    await core.run('workspace.add', { path: fresh, name: 'ws2' });
    const { badges } = await core.run('badge.list', {});
    // No badge whose path descends into the symlinked-out directory.
    expect(badges.some((b: { file: string }) => b.file.startsWith('innocent/'))).toBe(false);
  });

  it('opens a workspace containing a self-symlink loop without ELOOP (DoS) — and a mutual cycle', async () => {
    const fresh = join(base, 'ws3');
    await mkdir(join(fresh, 'd'), { recursive: true });
    await symlink(fresh, join(fresh, 'd', 'selfroot')); // d/selfroot -> root (self loop)
    await symlink(join(fresh, 'mb'), join(fresh, 'ma')); // ma -> mb
    await symlink(join(fresh, 'ma'), join(fresh, 'mb')); // mb -> ma (mutual cycle → realpath ELOOP)
    // Must resolve, not hang/throw.
    await expect(core.run('workspace.add', { path: fresh, name: 'ws3' })).resolves.toBeDefined();
  });

  it('opens a workspace with a symlink LOOP at a DERIVED .bh/badges/<name> path (no ELOOP crash)', async () => {
    // Re-verify residual: a loop at the badge path (not the user tree) is
    // reached via badge.get->readBadge->canonicalize, which must map ELOOP to
    // a skip rather than abort materialize/open.
    const fresh = join(base, 'ws4');
    await mkdir(join(fresh, 'docs'), { recursive: true }); // real user folder
    await writeFile(join(fresh, 'docs', 'a.md'), '# a');
    await mkdir(join(fresh, '.bh/badges'), { recursive: true });
    await symlink(join(fresh, '.bh/badges/docs'), join(fresh, '.bh/badges/docs')); // self-loop
    await expect(core.run('workspace.add', { path: fresh, name: 'ws4' })).resolves.toBeDefined();
  });
});

describe('workspace setup — symlinked CLAUDE.md / .gitignore (the missed runSetup surface)', () => {
  it('refuses to write THROUGH a symlinked CLAUDE.md / .gitignore on add({setup:true})', async () => {
    const fresh = join(base, 'wss1');
    await mkdir(fresh, { recursive: true });
    await writeFile(join(outside, 'victim-claude.md'), 'OUTSIDE CLAUDE');
    await writeFile(join(outside, 'victim-gi'), 'OUTSIDE GITIGNORE');
    await symlink(join(outside, 'victim-claude.md'), join(fresh, 'CLAUDE.md'));
    await symlink(join(outside, 'victim-gi'), join(fresh, '.gitignore'));
    await core.run('workspace.add', { path: fresh, name: 'wss1', setup: true });
    expect(await readFile(join(outside, 'victim-claude.md'), 'utf8')).toBe('OUTSIDE CLAUDE');
    expect(await readFile(join(outside, 'victim-gi'), 'utf8')).toBe('OUTSIDE GITIGNORE');
  });

  it('does NOT plant a new outside file through a DANGLING CLAUDE.md symlink on setup', async () => {
    const fresh = join(base, 'wss2');
    await mkdir(fresh, { recursive: true });
    await symlink(join(outside, 'planted-claude.md'), join(fresh, 'CLAUDE.md')); // dangling
    await core.run('workspace.add', { path: fresh, name: 'wss2', setup: true });
    expect(existsSync(join(outside, 'planted-claude.md'))).toBe(false);
  });

  it('still installs the CLAUDE.md hint on a clean workspace (no false rejection)', async () => {
    const fresh = join(base, 'wss3');
    await mkdir(fresh, { recursive: true });
    const res = await core.run('workspace.add', { path: fresh, name: 'wss3', setup: true });
    expect(res.setup.claudeMdUpdated).toBe(true);
    expect(await readFile(join(fresh, 'CLAUDE.md'), 'utf8')).toContain('BaseHalf workspace');
  });

  it('refuses to write THROUGH a symlinked AGENTS.md on setup (new fan-out surface)', async () => {
    const fresh = join(base, 'wss4');
    await mkdir(fresh, { recursive: true });
    await writeFile(join(outside, 'victim-agents.md'), 'OUTSIDE AGENTS');
    await symlink(join(outside, 'victim-agents.md'), join(fresh, 'AGENTS.md'));
    const res = await core.run('workspace.add', { path: fresh, name: 'wss4', setup: true });
    // The symlinked file is refused (reported skipped), the outside file untouched…
    expect(res.setup.agentsMdSkipped).toBe(true);
    expect(res.setup.agentsMdUpdated).toBe(false);
    expect(await readFile(join(outside, 'victim-agents.md'), 'utf8')).toBe('OUTSIDE AGENTS');
    // …while the other (clean) hint files still install — skip is per-file.
    expect(res.setup.claudeMdUpdated).toBe(true);
  });

  it('installs both hint files on a clean workspace, and ONLY them (no false rejection, no extra litter)', async () => {
    const fresh = join(base, 'wss6');
    await mkdir(fresh, { recursive: true });
    const res = await core.run('workspace.add', { path: fresh, name: 'wss6', setup: true });
    expect(res.setup.agentsMdUpdated).toBe(true);
    expect(res.setup.claudeMdUpdated).toBe(true);
    expect(await readFile(join(fresh, 'AGENTS.md'), 'utf8')).toContain('BaseHalf workspace');
    // The retired third target stays retired — no hidden directory conjured.
    expect(existsSync(join(fresh, '.github'))).toBe(false);
  });
});

describe('read dangling-symlink TOCTOU + write dangling-symlink directory', () => {
  it('refuses to read a DANGLING symlink leaf (closes the create-target race)', async () => {
    await symlink(join(outside, 'not-yet.txt'), join(ws, 'dang.md')); // target missing
    await expect(core.run('workspace.readFile', { path: 'dang.md' })).rejects.toThrow(
      /outside the workspace/,
    );
  });

  it('a normal MISSING (non-symlink) file still reports not-found, not refused', async () => {
    await expect(core.run('workspace.readFile', { path: 'nope.md' })).rejects.toThrow(
      /does not exist/,
    );
  });

  it('refuses to plant a new file under a DANGLING symlinked directory', async () => {
    await symlink(join(outside, 'missing-dir'), join(ws, 'ddir')); // ddir -> outside/missing-dir (dangling)
    await expect(
      core.run('workspace.writeFile', { path: 'ddir/x.md', content: 'x' }),
    ).rejects.toThrow(/outside the workspace/);
    expect(existsSync(join(outside, 'missing-dir'))).toBe(false);
  });
});

describe('.bh metadata DIRECTORY itself a symlink', () => {
  it('listBadges does not enumerate through a symlinked .bh/badges directory', async () => {
    const fresh = join(base, 'wsbsym');
    await mkdir(join(fresh, '.bh'), { recursive: true });
    const outBadges = join(base, 'outbadges');
    await mkdir(outBadges, { recursive: true });
    await writeFile(
      join(outBadges, 'x.md.json'),
      JSON.stringify({ file: 'x.md', kind: 'file', prompt: 'LEAK' }),
    );
    await symlink(outBadges, join(fresh, '.bh/badges')); // .bh/badges -> outside dir
    await core.run('workspace.add', { path: fresh, name: 'wsbsym' });
    const { badges } = await core.run('badge.list', {});
    expect(badges.find((b: { file: string }) => b.file === 'x.md')).toBeUndefined();
  });
});

describe('workspace.listFiles metadata oracle', () => {
  it('refuses listing a symlinked-out dir and filters the escaping child from the root listing', async () => {
    await mkdir(join(outside, 'sekrit'), { recursive: true });
    await writeFile(join(outside, 'sekrit', 'k.txt'), 'k');
    await symlink(outside, join(ws, 'docs')); // docs -> outside
    await expect(core.run('workspace.listFiles', { path: join(ws, 'docs') })).rejects.toThrow(
      /outside the workspace/,
    );
    const res = await core.run('workspace.listFiles', { path: ws });
    expect(res.entries.find((e: { name: string }) => e.name === 'docs')).toBeUndefined();
  });

  it('still lists legitimate in-workspace dirs (no false rejection)', async () => {
    await mkdir(join(ws, 'realdir'), { recursive: true });
    await writeFile(join(ws, 'realdir', 'f.md'), 'f');
    const res = await core.run('workspace.listFiles', { path: join(ws, 'realdir') });
    expect(res.entries.find((e: { name: string }) => e.name === 'f.md')).toBeDefined();
  });
});

describe('anchor ELOOP robustness — the .bh metadata dir itself a symlink CYCLE', () => {
  it('badge.list returns gracefully (no PathEscape throw) when .bh/badges is a symlink cycle', async () => {
    await mkdir(join(ws, '.bh'), { recursive: true });
    await symlink(join(ws, '.bh/b2'), join(ws, '.bh/badges')); // badges -> b2
    await symlink(join(ws, '.bh/badges'), join(ws, '.bh/b2')); // b2 -> badges (ELOOP)
    await expect(core.run('badge.list', {})).resolves.toBeDefined();
  });
});
