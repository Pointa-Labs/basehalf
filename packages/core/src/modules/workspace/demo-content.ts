/**
 * Demo workspace content — used by `workspace.createDemo` to seed a
 * brand-new folder with a small interconnected set of MD files plus
 * matching badge prompts + references. The goal is to put the v0
 * agent-protocol loop in the user's hands within ~5 seconds of opening
 * BaseHalf for the first time: they get badges on a canvas, a focused
 * file, refs between them, and a CLAUDE.md hint so any AI agent they
 * open in the folder immediately recognises the structure.
 *
 * Keep this small. The point isn't to ship a full tutorial — it's to
 * give the user a working example they can read, edit, and extend.
 */

export interface DemoFile {
  readonly path: string;
  readonly content: string;
  readonly prompt?: string;
  /** Outbound references to other DemoFile paths. */
  readonly refs?: ReadonlyArray<{ to: string; note?: string }>;
  /** Initial canvas position. The demo is laid out as a deliberate tree —
   *  `intro` as the root up top, the three files it references as a row of
   *  children below — so a first-run user sees a *map of related ideas*
   *  rather than a flat auto-grid row. Wider than tall so it frames well in
   *  a landscape window. (Combined with the canvas fit-to-view on first
   *  open, the whole graph frames itself.) `CLAUDE.md` — the agent contract,
   *  created by setup rather than listed here — is placed separately in
   *  createDemo, tucked in a corner so it reads as secondary. */
  readonly canvas?: { readonly x: number; readonly y: number };
}

export const DEMO_FILES: readonly DemoFile[] = [
  {
    path: 'intro.md',
    content: [
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
    ].join('\n'),
    prompt: 'The entry point — read this first; it sketches the layout.',
    refs: [
      { to: 'theory.md', note: 'the conceptual foundation' },
      { to: 'practice.md', note: 'how the loop feels day-to-day' },
      { to: 'cheatsheet.md', note: 'keyboard + interaction reference' },
    ],
    // Root of the tree, top-center over its three children.
    canvas: { x: 280, y: 60 },
  },
  {
    path: 'theory.md',
    content: [
      '# Compound thinking',
      '',
      'When an AI agent has structured context about your workspace — what',
      "you're focused on, how your files relate, what each file is *for* —",
      'every prompt becomes a leveraged one. The agent reads the protocol',
      'files under `.bh/` (`focus.md`, `badges/`, `index/inbound.json`) and',
      'composes the right neighbourhood without you having to spell it out.',
      '',
      "BaseHalf doesn't *do* the thinking. It maintains the workspace half",
      'of the loop so the AI half can be useful.',
      '',
    ].join('\n'),
    prompt: 'The thesis behind the product.',
    // Bottom-left child.
    canvas: { x: 40, y: 440 },
  },
  {
    path: 'practice.md',
    content: [
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
    ].join('\n'),
    prompt: 'Concrete walkthrough of the everyday loop.',
    refs: [{ to: 'theory.md', note: 'this is the theory in motion' }],
    // Bottom-center child.
    canvas: { x: 300, y: 440 },
  },
  {
    path: 'cheatsheet.md',
    content: [
      '# Cheatsheet',
      '',
      '## Canvas',
      '- **Single-click a badge** — focus it (mark what your AI agent reads).',
      '- **Double-click a file badge** — open it in the full editor.',
      '- **Double-click a folder badge** — scope the canvas into that folder.',
      "- **Drag from a badge's right edge** to another badge — create a reference.",
      '- **Drag a badge** — its position persists per workspace.',
      '',
      '## Editor (Markdown)',
      '- **Cmd/Ctrl + S** — save.',
      '- **Esc** or **Cmd/Ctrl + W** — close the editor.',
      '',
      '## Workspace',
      '- **Top bar → Add folder** — register another workspace.',
      '- **Top bar → Rename / Remove** — change or unregister this one.',
      '- **Top bar → New view** — make a named cross-folder grouping.',
      '',
    ].join('\n'),
    prompt: 'Keyboard + interaction reference. Skim, then close.',
    // Bottom-right child.
    canvas: { x: 560, y: 440 },
  },
] as const;
