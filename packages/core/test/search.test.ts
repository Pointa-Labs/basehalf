import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import type { SearchQueryResult } from '../src/index.js';
import { boundCore } from './helpers/bound-core.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * search.query — content (full-text) search across the current workspace.
 * Drives the hardened workspace.listFiles + workspace.readFile, so these
 * tests focus on the search semantics (matching, snippets, caps, skips),
 * not path safety (covered by path-escape.test.ts via those commands).
 */

async function setup(seed: (m: ReturnType<typeof mockFs>) => void) {
  const m = mockFs();
  m.dirs.add('/v');
  seed(m);
  const core = boundCore(createCore({ fs: m.fs, configDir: '/cfg' }), '/v');
  await core.run('workspace.add', { path: '/v', name: 'v' });
  return { core, m };
}

function run(core: ReturnType<typeof createCore>, args: object): Promise<SearchQueryResult> {
  return core.run<object, SearchQueryResult>('search.query', args);
}

describe('search.query', () => {
  it('finds a file containing the needle and reports the matching line', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/note.md', 'first line\nthe quick brown fox\nlast line');
    });
    const res = await run(core, { query: 'brown fox' });
    expect(res.query).toBe('brown fox');
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]?.file).toBe('note.md');
    expect(res.hits[0]?.total).toBe(1);
    expect(res.hits[0]?.matches).toEqual([{ line: 2, text: 'the quick brown fox' }]);
  });

  it('is case-insensitive', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/note.md', 'The AUTH Redesign doc');
    });
    const res = await run(core, { query: 'auth redesign' });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]?.matches[0]?.text).toBe('The AUTH Redesign doc');
  });

  it('caseSensitive only matches the exact case', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/a.md', 'AUTH here');
      m.files.set('/v/b.md', 'auth here');
    });
    const res = await run(core, { query: 'auth', caseSensitive: true });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]?.file).toBe('b.md');
  });

  it('wholeWord does not match a substring of a larger word', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/a.md', 'authentication flow'); // contains "auth" but not the word
      m.files.set('/v/b.md', 'the auth layer'); // the word "auth"
    });
    const res = await run(core, { query: 'auth', wholeWord: true });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]?.file).toBe('b.md');
  });

  it('regex matches a pattern; an invalid pattern yields no hits', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/a.md', 'order #42 shipped\norder #7 pending');
    });
    const ok = await run(core, { query: '#\\d+', regex: true });
    expect(ok.hits).toHaveLength(1);
    expect(ok.hits[0]?.total).toBe(2);
    const bad = await run(core, { query: '(unclosed', regex: true });
    expect(bad.hits).toEqual([]);
  });

  it('returns empty hits for an empty or whitespace query (no walk)', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/note.md', 'anything');
    });
    expect((await run(core, { query: '' })).hits).toEqual([]);
    expect((await run(core, { query: '   ' })).hits).toEqual([]);
  });

  it('ranks a file whose DESCRIPTION is about the query ABOVE a higher match-count file', async () => {
    // mentions.md hits the needle 3×; about.md hits it once but its badge
    // description IS about it. Aboutness wins — the note that's *about* the topic
    // beats the note that merely mentions it more.
    const { core } = await setup((m) => {
      m.files.set('/v/mentions.md', '供需\n供需\n供需'); // 3 content matches, no badge
      m.files.set('/v/about.md', '本章一处提到供需。'); // 1 content match
    });
    await core.run('badge.set', {
      file: 'about.md',
      patch: { description: '讲供需均衡的核心章节', kind: 'file' },
    });
    const res = await run(core, { query: '供需' });
    expect(res.hits.map((h) => h.file)).toEqual(['about.md', 'mentions.md']);
    // The boost is by ABOUTNESS, not count: about.md still reports its true total.
    expect(res.hits[0]?.total).toBe(1);
    expect(res.hits[1]?.total).toBe(3);
  });

  it('leaves match-count ordering untouched for files with NO matching description', async () => {
    // Sparse-safe: the aboutness boost only moves files that carry a matching
    // description; un-annotated files keep the prior count-then-path order.
    const { core } = await setup((m) => {
      m.files.set('/v/a.md', 'x\nx\nx');
      m.files.set('/v/b.md', 'x');
      m.files.set('/v/c.md', 'x\nx');
    });
    // A description that does NOT match the query must not boost.
    await core.run('badge.set', {
      file: 'b.md',
      patch: { description: 'unrelated note', kind: 'file' },
    });
    const res = await run(core, { query: 'x' });
    expect(res.hits.map((h) => h.file)).toEqual(['a.md', 'c.md', 'b.md']);
  });

  it('sorts hits by match count desc, then path asc', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/a.md', 'x\nx\nx'); // 3 matches
      m.files.set('/v/b.md', 'x'); // 1 match
      m.files.set('/v/c.md', 'x\nx'); // 2 matches
    });
    const res = await run(core, { query: 'x' });
    expect(res.hits.map((h) => h.file)).toEqual(['a.md', 'c.md', 'b.md']);
    expect(res.hits.map((h) => h.total)).toEqual([3, 2, 1]);
  });

  it('walks nested directories and returns POSIX-relative paths', async () => {
    const { core } = await setup((m) => {
      m.dirs.add('/v/sub');
      m.dirs.add('/v/sub/deep');
      m.files.set('/v/sub/deep/buried.md', 'needle here');
    });
    const res = await run(core, { query: 'needle' });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]?.file).toBe('sub/deep/buried.md');
  });

  it('caps the number of files and flags truncated', async () => {
    const { core } = await setup((m) => {
      for (let i = 0; i < 5; i++) m.files.set(`/v/f${i}.md`, 'hello');
    });
    const res = await run(core, { query: 'hello', maxFiles: 2 });
    expect(res.hits).toHaveLength(2);
    expect(res.truncated).toBe(true);
  });

  it('caps matches per file but still reports the real total', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/note.md', Array.from({ length: 10 }, () => 'hit').join('\n'));
    });
    const res = await run(core, { query: 'hit', maxMatchesPerFile: 3 });
    expect(res.hits[0]?.matches).toHaveLength(3);
    expect(res.hits[0]?.total).toBe(10);
    expect(res.truncated).toBeUndefined();
  });

  it('ranks by match count BEFORE the file cap (strong match beats traversal order)', async () => {
    const { core } = await setup((m) => {
      // a.md is alphabetically first but a weak (1) match; z.md is last but the
      // strongest (3). With maxFiles:1, ranking-before-cap must keep z.md — an
      // early break in traversal order would have wrongly kept a.md.
      m.files.set('/v/a.md', 'hit');
      m.files.set('/v/m.md', 'hit\nhit');
      m.files.set('/v/z.md', 'hit\nhit\nhit');
    });
    const res = await run(core, { query: 'hit', maxFiles: 1 });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]?.file).toBe('z.md');
    expect(res.hits[0]?.total).toBe(3);
    expect(res.truncated).toBe(true);
  });

  it('surfaces an unreachable workspace instead of reporting "no matches"', async () => {
    const { core, m } = await setup((mm) => {
      mm.files.set('/v/note.md', 'findme');
    });
    // The workspace is still registered (current points at /v) but the root
    // dir vanished — a deleted / unmounted workspace. search must surface the
    // listFiles failure, not silently return an empty result.
    m.dirs.delete('/v');
    m.files.delete('/v/note.md');
    await expect(run(core, { query: 'findme' })).rejects.toThrow();
  });

  it('never descends into .bh/ (so it does not match its own derived state)', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/real.md', 'project-alpha notes');
    });
    // Annotating real.md writes .bh/mirror/real.md/badge.yaml, whose YAML body
    // contains the path "real.md". A search for "real.md" must NOT surface that
    // derived .bh/ file.
    await core.run('badge.set', { file: 'real.md', patch: { description: 'project-alpha notes' } });
    const res = await run(core, { query: 'real.md' });
    expect(res.hits.every((h) => !h.file.startsWith('.bh/'))).toBe(true);
  });

  it('skips node_modules and other tooling dirs', async () => {
    const { core } = await setup((m) => {
      m.dirs.add('/v/node_modules');
      m.dirs.add('/v/node_modules/pkg');
      m.files.set('/v/node_modules/pkg/index.js', 'token');
      m.files.set('/v/keep.md', 'token');
    });
    const res = await run(core, { query: 'token' });
    expect(res.hits.map((h) => h.file)).toEqual(['keep.md']);
  });

  it('skips binary files (NUL byte → not searchable text)', async () => {
    const { core } = await setup((m) => {
      // Build the blob at runtime so the NUL never appears as a literal byte in
      // this source file (a real NUL corrupts the file + breaks tooling). The
      // bytes DO spell "needle", so only the NUL is what keeps it out of results.
      const needleBytes = Buffer.from('needle', 'utf8');
      m.fileBytes.set('/v/blob.bin', Buffer.concat([needleBytes, Buffer.from([0]), needleBytes]));
      m.files.set('/v/text.md', 'needle in text');
    });
    const res = await run(core, { query: 'needle' });
    expect(res.hits.map((h) => h.file)).toEqual(['text.md']);
  });

  it('windows a very long matching line into an ellipsised snippet', async () => {
    const { core } = await setup((m) => {
      const long = `${'a'.repeat(500)} TARGET ${'b'.repeat(500)}`;
      m.files.set('/v/min.md', long);
    });
    const res = await run(core, { query: 'TARGET' });
    const text = res.hits[0]?.matches[0]?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(202); // SNIPPET_MAX_CHARS + 2 ellipses
    expect(text).toContain('TARGET');
    expect(text.startsWith('…')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
  });

  it('flags truncated when a file is larger than the per-file read cap', async () => {
    const { core } = await setup((m) => {
      // > PER_FILE_MAX_CHARS (100k); the match sits inside the searched prefix.
      m.files.set('/v/big.md', `needle\n${'x'.repeat(200_000)}`);
    });
    const res = await run(core, { query: 'needle' });
    expect(res.hits[0]?.file).toBe('big.md');
    expect(res.hits[0]?.truncated).toBe(true);
  });

  it('does not emit a hit when the needle only straddles a line boundary', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/note.md', 'hello\nworld');
    });
    // "lo\nwo" is a substring of the whole content but of no single line.
    const res = await run(core, { query: 'lo\nwo' });
    expect(res.hits).toEqual([]);
  });

  it('counts total as matching LINES, not needle occurrences', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/note.md', 'x x x\nfoo\nbar x');
    });
    // Two lines contain "x"; the 3 occurrences on line 1 count once. This pins
    // the line-vs-occurrence contract the rank-before-cap ordering relies on.
    const res = await run(core, { query: 'x' });
    expect(res.hits[0]?.total).toBe(2);
  });

  it('swallows a child dir that vanished mid-walk and keeps finding sibling hits', async () => {
    const { core, m } = await setup((mm) => {
      mm.dirs.add('/v/gone');
      mm.files.set('/v/keep.md', 'findme');
    });
    // A child dir whose listing fails (deleted between enumerate + descend) must
    // NOT abort the whole search — only the ROOT failure does (covered above).
    const realReaddir = m.fs.readdir.bind(m.fs);
    m.fs.readdir = async (p: string) => {
      if (p === '/v/gone') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return realReaddir(p);
    };
    const res = await run(core, { query: 'findme' });
    expect(res.hits.map((h) => h.file)).toEqual(['keep.md']);
  });

  it('splits bare-CR (classic-Mac) line endings for correct line numbers', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/mac.md', 'a\rb\rTARGET');
    });
    const res = await run(core, { query: 'TARGET' });
    expect(res.hits[0]?.matches[0]?.line).toBe(3);
    expect(res.hits[0]?.matches[0]?.text).toBe('TARGET');
  });

  it('anchors the snippet at the match even when the needle is longer than the window', async () => {
    const { core } = await setup((m) => {
      // Needle (300 Z) longer than SNIPPET_MAX_CHARS, matching at column 0 of a
      // long line. A negative `half` would push the window right (spurious lead
      // ellipsis); clamped, it anchors at the match start.
      m.files.set('/v/long.md', `${'Z'.repeat(300)}${' tail'.repeat(60)}`);
    });
    const res = await run(core, { query: 'Z'.repeat(300) });
    const text = res.hits[0]?.matches[0]?.text ?? '';
    expect(text.startsWith('…')).toBe(false);
    expect(text.startsWith('Z')).toBe(true);
  });

  it('never splits a surrogate pair in a snippet (no lone-surrogate corruption)', async () => {
    const { core } = await setup((m) => {
      const emoji = '😀'.repeat(150);
      m.files.set('/v/emoji.md', `${emoji}TARGET${emoji}`);
    });
    const res = await run(core, { query: 'TARGET' });
    const text = res.hits[0]?.matches[0]?.text ?? '';
    // A lone surrogate = a high surrogate not followed by a low one, or a low
    // surrogate not preceded by a high one.
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(text)).toBe(false);
  });

  it('searches a FILE named like a skip-dir but still prunes a DIRECTORY of that name', async () => {
    const { core } = await setup((m) => {
      // An extensionless note literally named `build` must be searched (the skip
      // is dirs-only), while a real DIRECTORY named `vendor` must still be pruned.
      m.files.set('/v/build', 'findme inside build');
      m.dirs.add('/v/vendor');
      m.files.set('/v/vendor/inner.md', 'findme too');
    });
    const res = await run(core, { query: 'findme' });
    const files = res.hits.map((h) => h.file);
    expect(files).toContain('build'); // file named like a skip-dir → searched
    expect(files).not.toContain('vendor/inner.md'); // dir named like a skip-dir → pruned
  });

  it('flags result truncated when a capped large file might hide a match past the cap', async () => {
    const { core } = await setup((m) => {
      // Match sits BEYOND PER_FILE_MAX_CHARS (100k), so it's not in the searched
      // prefix — but the search was incomplete, so truncated must be flagged
      // rather than reporting a clean "no matches".
      m.files.set('/v/huge.md', `${'a'.repeat(150_000)}needle`);
    });
    const res = await run(core, { query: 'needle' });
    expect(res.hits).toEqual([]);
    expect(res.truncated).toBe(true);
  });

  it('throws when there is no workspace bound to the call', async () => {
    const m = mockFs();
    const core = createCore({ fs: m.fs, configDir: '/cfg' });
    await expect(run(core, { query: 'x' })).rejects.toThrow(/No workspace bound/i);
  });
});

describe('search.brief', () => {
  type BriefResult = {
    query: string;
    brief: string;
    files: readonly string[];
    truncated?: boolean;
  };
  const runBrief = (core: ReturnType<typeof createCore>, args: object): Promise<BriefResult> =>
    core.run<object, BriefResult>('search.brief', args);

  it('assembles a Markdown brief with matches hydrated by badge description + bare-path refs', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/a.md', 'alpha needle here');
      m.files.set('/v/b.md', 'unrelated');
    });
    await core.run('badge.set', { file: 'a.md', patch: { description: 'the source of truth' } });
    await core.run('badge.addRef', { file: 'a.md', to: 'b.md' });

    const res = await runBrief(core, { query: 'needle' });
    expect(res.query).toBe('needle');
    expect(res.files).toEqual(['a.md']);
    expect(res.brief).toContain('# bh search brief');
    expect(res.brief).toContain('query: needle');
    expect(res.brief).toContain('  - a.md');
    expect(res.brief).toContain('description: the source of truth');
    expect(res.brief).toContain('match (line 1): alpha needle here');
    // References are bare paths now (the per-edge note moved to canvas.yaml).
    expect(res.brief).toContain('-> b.md');
  });

  it('inlines inbound entries as bare backlink paths', async () => {
    // Edge notes were removed (they moved to canvas.yaml), so referenced_by is
    // now a plain path list and EVERY referrer is inlined — the old note-vs-
    // note-less discrimination no longer exists.
    const { core } = await setup((m) => {
      m.files.set('/v/target.md', 'the needle lives here');
      m.files.set('/v/one.md', 'x');
      m.files.set('/v/two.md', 'y');
    });
    await core.run('badge.addRef', { file: 'one.md', to: 'target.md' });
    await core.run('badge.addRef', { file: 'two.md', to: 'target.md' });

    const res = await runBrief(core, { query: 'needle' });
    expect(res.brief).toContain('referenced-by:');
    expect(res.brief).toContain('<- one.md');
    expect(res.brief).toContain('<- two.md');
  });

  it('degrades to a plain match list when a hit has no badge (sparse overlay)', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/plain.md', 'needle without any badge');
    });
    const res = await runBrief(core, { query: 'needle' });
    expect(res.files).toEqual(['plain.md']);
    expect(res.brief).toContain('  - plain.md');
    expect(res.brief).toContain('match (line 1): needle without any badge');
    expect(res.brief).not.toContain('description:');
    expect(res.brief).not.toContain('refs:');
  });

  it('returns an empty-results brief for a query with no matches', async () => {
    const { core } = await setup((m) => {
      m.files.set('/v/a.md', 'nothing relevant');
    });
    const res = await runBrief(core, { query: 'zzz-absent' });
    expect(res.files).toEqual([]);
    expect(res.brief).toContain('results:');
    expect(res.brief).toContain('  (none)');
  });

  it('caps the brief to a context-sized file set (default 8) and flags truncated', async () => {
    const { core } = await setup((m) => {
      for (let i = 0; i < 12; i++) m.files.set(`/v/f${String(i).padStart(2, '0')}.md`, 'needle');
    });
    const res = await runBrief(core, { query: 'needle' });
    expect(res.files).toHaveLength(8);
    expect(res.truncated).toBe(true);
  });
});
