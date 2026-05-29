import { describe, expect, it } from 'vitest';
import { __test, isLossyRoundTrip } from '../src/renderer/src/lib/mdLossy.js';

const { contentTokens, hasFrontmatter, hasTable, fenceBodies } = __test;

describe('isLossyRoundTrip — structural constructs BlockNote can’t round-trip stay view-only', () => {
  it('YAML frontmatter is lossy (would be rewritten as prose)', () => {
    const md = '---\ntitle: Hello\nstatus: shipped\ntags: [a, b]\n---\n\n# Body\n\ntext';
    expect(hasFrontmatter(md)).toBe(true);
    // Even an identical round-trip is unsafe — BlockNote can't preserve YAML.
    expect(isLossyRoundTrip(md, md)).toBe(true);
  });

  it('a GFM table is lossy', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    expect(hasTable(md)).toBe(true);
    expect(isLossyRoundTrip(md, md)).toBe(true);
  });

  it('a table with alignment colons is detected', () => {
    expect(hasTable('| x | y |\n|:--|--:|\n| 1 | 2 |')).toBe(true);
  });

  it('fenced code whose body changes is lossy (even punctuation-only)', () => {
    const original = 'text\n\n```\n>>> ++ && ||\n```\n';
    const reserialized = 'text\n\n```\n>>> ++\n```\n'; // body changed
    expect(fenceBodies(original)).not.toBe(fenceBodies(reserialized));
    expect(isLossyRoundTrip(original, reserialized)).toBe(true);
  });

  it('fenced code preserved verbatim is NOT lossy on its own', () => {
    const md = 'intro\n\n```js\nconst a = 1 + 2;\n```\n\nmore';
    expect(isLossyRoundTrip(md, md)).toBe(false);
  });

  it('prose with pipes but no delimiter row is NOT a table', () => {
    expect(hasTable('the cmd is `a | b` piped')).toBe(false);
    expect(hasTable('- one\n- two')).toBe(false);
  });

  it('a `---` thematic break is not mistaken for frontmatter', () => {
    expect(hasFrontmatter('# Title\n\nbody\n\n---\n\nmore')).toBe(false);
  });
});

describe('isLossyRoundTrip — formatting churn is NOT lossy (editing stays enabled)', () => {
  it('soft wrap → hard break (trailing backslash + leading space)', () => {
    const original = 'ask what is\nthis workspace about';
    const reserialized = 'ask what is\\\n this workspace about';
    expect(isLossyRoundTrip(original, reserialized)).toBe(false);
  });

  it('emphasis marker style (* vs _) and bullet char (- vs *)', () => {
    expect(isLossyRoundTrip('- a *why* b', '* a _why_ b')).toBe(false);
    expect(isLossyRoundTrip('**bold**', '__bold__')).toBe(false);
  });

  it('ordered-list renumbering + item→paragraph regroup', () => {
    const original = '1. first item\n2. second\n   continued line\n3. third';
    // BlockNote splits the continuation into a paragraph and renumbers.
    const reserialized = '1. first item\n2. second\n\ncontinued line\n\n1. third';
    expect(isLossyRoundTrip(original, reserialized)).toBe(false);
  });

  it('blank-line runs', () => {
    expect(isLossyRoundTrip('# T\n\n\n\nBody', '# T\n\nBody')).toBe(false);
  });

  it("real round-trip of the demo's intro.md (bullets swapped + hard breaks)", () => {
    const original = [
      '# Welcome to your BaseHalf demo workspace',
      '',
      'This folder is a tiny working example of the bh agent-protocol loop.',
      '',
      '- `theory.md` explains *why* BaseHalf exists.',
      '- `practice.md` shows the everyday loop.',
      '- `cheatsheet.md` is the reference card.',
      '',
      'Open Claude Code (or any AI agent) in this folder and ask "what is',
      'this workspace about?" — it should follow the references from this',
      'file and answer correctly without any extra hand-holding.',
      '',
    ].join('\n');
    const reserialized = [
      '# Welcome to your BaseHalf demo workspace',
      '',
      'This folder is a tiny working example of the bh agent-protocol loop.',
      '',
      '* `theory.md` explains *why* BaseHalf exists.',
      '* `practice.md` shows the everyday loop.',
      '* `cheatsheet.md` is the reference card.',
      '',
      'Open Claude Code (or any AI agent) in this folder and ask "what is\\',
      ' this workspace about?" — it should follow the references from this\\',
      ' file and answer correctly without any extra hand-holding.',
      '',
    ].join('\n');
    expect(isLossyRoundTrip(original, reserialized)).toBe(false);
  });

  it("real round-trip of the demo's practice.md (list items split + renumbered)", () => {
    const original = [
      '# The daily loop',
      '',
      '1. **Drop a folder** (papers, notes, code, drafts) into BaseHalf.',
      '2. **Describe each file** for the AI in the Badge panel — a single',
      '   sentence is usually enough.',
      '3. **Connect related files** by dragging from one badge to another.',
      '   Add a short note on the edge explaining *why* they relate.',
      '4. **Ask your AI agent**, in another window, about the work — it',
      '   reads the structure you just made and answers in context.',
      '',
      'The contract surface is in `.bh/` (intentionally co-located with',
      "your files so it travels with the folder under git). You don't",
      'invoke bh from the agent — the agent just reads files.',
      '',
    ].join('\n');
    const reserialized = [
      '# The daily loop',
      '',
      '1. **Drop a folder** (papers, notes, code, drafts) into BaseHalf.',
      '2. **Describe each file** for the AI in the Badge panel — a single',
      '',
      'sentence is usually enough.',
      '',
      '1. **Connect related files** by dragging from one badge to another.',
      '',
      'Add a short note on the edge explaining *why* they relate.',
      '',
      '1. **Ask your AI agent**, in another window, about the work — it',
      '',
      'reads the structure you just made and answers in context.',
      '',
      'The contract surface is in `.bh/` (intentionally co-located with\\',
      " your files so it travels with the folder under git). You don't\\",
      ' invoke bh from the agent — the agent just reads files.',
      '',
    ].join('\n');
    expect(isLossyRoundTrip(original, reserialized)).toBe(false);
  });
});

describe('isLossyRoundTrip — real content loss IS lossy (stays view-only)', () => {
  it('a dropped line trips the guard', () => {
    expect(isLossyRoundTrip('keep this\nand this too', 'keep this')).toBe(true);
  });

  it('a dropped word trips the guard', () => {
    expect(isLossyRoundTrip('one two three', 'one three')).toBe(true);
  });

  it('added content trips the guard', () => {
    expect(isLossyRoundTrip('hello world', 'hello cruel world')).toBe(true);
  });
});

describe('contentTokens()', () => {
  it('strips list markers so bullets/renumbering do not count', () => {
    expect(contentTokens('1. alpha\n2. beta')).toBe(contentTokens('- alpha\n- beta'));
    expect(contentTokens('* alpha\n* beta')).toBe('alpha beta');
  });

  it('keeps content numbers (not list markers)', () => {
    expect(contentTokens('teacher emphasized chapters 1, 3, 6, 7, 9')).toBe(
      'teacher emphasized chapters 1 3 6 7 9',
    );
  });

  it('is whitespace/punctuation/markup insensitive', () => {
    expect(contentTokens('# Hi\n\n**there**')).toBe('Hi there');
  });
});
