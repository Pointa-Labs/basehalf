import { mkdir } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import type {
  SetupReport,
  WorkspaceAddArgs,
  WorkspaceAddResult,
  WorkspaceCreateDemoArgs,
  WorkspaceCreateDemoResult,
} from '../common/workspaces.js';
import { writeWorkspaceFileIfMissing } from './workspaceFiles.js';
import { NAME_PATTERN, readWorkspaces, samePath } from './workspaceRegistryStore.js';
import { runWorkspaceSetup } from './workspaceSetup.js';

const DEMO_FILE_CARD_WIDTH = 260;
const DEMO_FILE_CARD_HEIGHT = 150;

interface DemoFile {
  readonly path: string;
  readonly content: string;
  readonly prompt?: string;
  readonly refs?: ReadonlyArray<{ readonly to: string; readonly note?: string }>;
  readonly canvas?: { readonly x: number; readonly y: number };
}

export interface WorkspaceDemoMirrorProvider {
  setBadge(
    workspaceRoot: string,
    args: {
      readonly file: string;
      readonly patch: { readonly kind: 'file'; readonly description: string };
    },
  ): Promise<unknown>;
  setCanvasCard(
    workspaceRoot: string,
    args: {
      readonly folder: null;
      readonly card: {
        readonly path: string;
        readonly kind: 'file';
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
    },
  ): Promise<unknown>;
  connectCanvas(
    workspaceRoot: string,
    args: {
      readonly folder: null;
      readonly from: string;
      readonly to: string;
      readonly from_anchor: 'east';
      readonly to_anchor: 'west';
      readonly kind: 'file';
      readonly label?: string;
    },
  ): Promise<unknown>;
  setFocus(
    workspaceRoot: string,
    args: { readonly path: string; readonly kind: 'file' },
  ): Promise<unknown>;
}

export interface CreateWorkspaceDemoOptions {
  readonly configDir: string;
  readonly mirror: WorkspaceDemoMirrorProvider;
  readonly registerWorkspace: (args: WorkspaceAddArgs) => Promise<WorkspaceAddResult>;
}

export async function createWorkspaceDemo(
  args: WorkspaceCreateDemoArgs,
  opts: CreateWorkspaceDemoOptions,
): Promise<WorkspaceCreateDemoResult> {
  const absPath = isAbsolute(args.path) ? args.path : resolve(args.path);
  const name = args.name ?? basename(absPath);
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid workspace name: ${JSON.stringify(name)} (allowed: a-z, 0-9, . _ -, 1-64 chars, starts alnum)`,
    );
  }

  await mkdir(absPath, { recursive: true });

  const filesCreated: string[] = [];
  for (const file of DEMO_FILES) {
    try {
      const created = await writeWorkspaceFileIfMissing(absPath, {
        path: file.path,
        content: file.content,
      });
      if (created) filesCreated.push(file.path);
    } catch (err) {
      if (err instanceof Error && err.name === 'PathEscape') continue;
      throw err;
    }
  }

  const addResult = await registerDemoWorkspace(opts, absPath, name);
  await seedDemoMirror(absPath, opts.mirror);

  return {
    workspace: addResult.workspace,
    filesCreated,
    setup: addResult.setup ?? EMPTY_SETUP_REPORT,
  };
}

async function registerDemoWorkspace(
  opts: CreateWorkspaceDemoOptions,
  absPath: string,
  name: string,
): Promise<WorkspaceAddResult> {
  const data = await readWorkspaces(opts.configDir);
  const existing = data.workspaces[name];
  if (existing !== undefined) {
    if (!samePath(existing.path, absPath)) {
      throw new Error(
        `Workspace name "${name}" is already registered at ${existing.path}. Pick a different demo path.`,
      );
    }
    return {
      workspace: { name, path: existing.path, addedAt: existing.addedAt },
      bhDirCreated: false,
      alreadyRegistered: true,
      setup: await runWorkspaceSetup(existing.path),
    };
  }

  return opts.registerWorkspace({ path: absPath, name, setup: true });
}

async function seedDemoMirror(root: string, mirror: WorkspaceDemoMirrorProvider): Promise<void> {
  for (const file of DEMO_FILES) {
    if (file.prompt !== undefined) {
      await mirror.setBadge(root, {
        file: file.path,
        patch: { kind: 'file', description: file.prompt },
      });
    }
    if (file.canvas !== undefined) {
      await mirror.setCanvasCard(root, {
        folder: null,
        card: {
          path: file.path,
          kind: 'file',
          x: file.canvas.x,
          y: file.canvas.y,
          width: DEMO_FILE_CARD_WIDTH,
          height: DEMO_FILE_CARD_HEIGHT,
        },
      });
    }
  }

  for (const file of DEMO_FILES) {
    for (const ref of file.refs ?? []) {
      await mirror.connectCanvas(root, {
        folder: null,
        from: file.path,
        to: ref.to,
        from_anchor: 'east',
        to_anchor: 'west',
        kind: 'file',
        ...(ref.note !== undefined && { label: ref.note }),
      });
    }
  }

  await mirror
    .setCanvasCard(root, {
      folder: null,
      card: {
        path: 'CLAUDE.md',
        kind: 'file',
        x: 620,
        y: 60,
        width: DEMO_FILE_CARD_WIDTH,
        height: DEMO_FILE_CARD_HEIGHT,
      },
    })
    .catch(() => undefined);

  await mirror.setFocus(root, { path: 'intro.md', kind: 'file' });
}

const EMPTY_SETUP_REPORT: SetupReport = Object.freeze({
  gitignoreUpdated: false,
  agentHarnessUpdated: false,
  claudeMdUpdated: false,
  agentsMdUpdated: false,
  gitignoreSkipped: false,
  agentHarnessSkipped: false,
  claudeMdSkipped: false,
  agentsMdSkipped: false,
  gitignoreAbsent: true,
});

const DEMO_FILES: readonly DemoFile[] = [
  {
    path: 'intro.md',
    content: [
      '# Welcome to your BaseHalf demo workspace',
      '',
      'This folder is a tiny working example of the BaseHalf agent-protocol loop.',
      '',
      '- `theory.md` explains *why* BaseHalf exists.',
      '- `practice.md` shows the everyday loop.',
      '- `cheatsheet.md` is the reference card.',
      '',
      'Open Claude Code (or any AI agent) in this folder and ask "what is',
      'this workspace about?" - it should follow the references from this',
      'file and answer correctly without any extra hand-holding.',
      '',
    ].join('\n'),
    prompt: 'The entry point - read this first; it sketches the layout.',
    refs: [
      { to: 'theory.md', note: 'the conceptual foundation' },
      { to: 'practice.md', note: 'how the loop feels day-to-day' },
      { to: 'cheatsheet.md', note: 'keyboard + interaction reference' },
    ],
    canvas: { x: 280, y: 60 },
  },
  {
    path: 'theory.md',
    content: [
      '# Compound thinking',
      '',
      'When an AI agent has structured context about your workspace - what',
      "you're focused on, how your files relate, what each file is *for* -",
      'every prompt becomes a leveraged one. The agent reads the protocol',
      'files under `.bh/` (`current_focus.yaml` and the `mirror/` tree) and',
      'composes the right neighbourhood without you having to spell it out.',
      '',
      "BaseHalf doesn't *do* the thinking. It maintains the workspace half",
      'of the loop so the AI half can be useful.',
      '',
    ].join('\n'),
    prompt: 'The thesis behind the product.',
    canvas: { x: 40, y: 440 },
  },
  {
    path: 'practice.md',
    content: [
      '# The daily loop',
      '',
      '1. **Drop a folder** (papers, notes, code, drafts) into BaseHalf.',
      '2. **Describe each file** for the AI in its File Badge page - a single',
      '   sentence is usually enough.',
      '3. **Connect related files** by dragging from one badge to another.',
      '   Add a short note on the edge explaining *why* they relate.',
      '4. **Ask your AI agent**, in another window, about the work - it',
      '   reads the structure you just made and answers in context.',
      '',
      'The contract surface is in `.bh/` (intentionally co-located with',
      'your files so it travels with the folder under git). The agent',
      'needs no commands - it just reads those files.',
      '',
    ].join('\n'),
    prompt: 'Concrete walkthrough of the everyday loop.',
    refs: [{ to: 'theory.md', note: 'this is the theory in motion' }],
    canvas: { x: 300, y: 440 },
  },
  {
    path: 'cheatsheet.md',
    content: [
      '# Cheatsheet',
      '',
      '## Canvas',
      '- **Single-click a badge** - select it as a canvas object.',
      '- **Double-click a file badge** - open it in the full right-panel editor.',
      '- **Click the pencil icon** - edit a Markdown file directly on the canvas.',
      "- **Click the badge icon** - open that file's File Badge page.",
      '- **Resize a selected badge** - change how much content the canvas shows.',
      '- **Double-click a folder badge** - scope the canvas into that folder.',
      "- **Drag from a badge's right edge** to another badge - create a reference.",
      '- **Drag a badge** - its position persists per workspace.',
      '',
      '## Editor (Markdown)',
      '- **Cmd/Ctrl + S** - save.',
      '- **Esc** or **Cmd/Ctrl + W** - close the editor.',
      '',
      '## Workspace',
      '- **Top bar -> Add folder** - register another workspace.',
      '- **Top bar -> Rename / Remove** - change or unregister this one.',
      '- **Top bar -> New view** - make a named cross-folder grouping.',
      '',
    ].join('\n'),
    prompt: 'Keyboard + interaction reference. Skim, then close.',
    canvas: { x: 560, y: 440 },
  },
];
