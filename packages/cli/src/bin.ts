#!/usr/bin/env node
// bh — BaseHalf CLI.
//
// Thin shell. Parses argv with `citty` (UnJS, native ESM, nested sub-commands),
// dispatches to `@basehalf/core`'s `run()`, renders the result (pretty by
// default, JSON with `--json`).
//
// No business logic here. New commands are added by writing a module in
// packages/core/src/modules/<name>/ and registering it in createCore().

import { UnknownCommand, createCore } from '@basehalf/core';
import { defineCommand, runMain } from 'citty';
import { render } from './render.js';

const core = createCore();

// ── workspace.* ────────────────────────────────────────────────────────────

const wsAdd = defineCommand({
  meta: { name: 'add', description: 'Register a folder as a BaseHalf workspace' },
  args: {
    path: { type: 'positional', description: 'Path to the folder', required: true },
    name: { type: 'string', description: 'Override workspace name' },
    setup: {
      type: 'boolean',
      description:
        'Also add .bh/cache/ to .gitignore + install the agent hint in CLAUDE.md and AGENTS.md (non-destructive)',
    },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('workspace.add', {
      path: args.path,
      ...(typeof args.name === 'string' && args.name.length > 0 && { name: args.name }),
      ...(args.setup === true && { setup: true }),
    });
    render('workspace.add', result, Boolean(args.json));
  },
});

const wsList = defineCommand({
  meta: { name: 'list', description: 'List registered workspaces' },
  args: { json: { type: 'boolean', description: 'JSON output' } },
  async run({ args }) {
    const result = await core.run('workspace.list', {});
    render('workspace.list', result, Boolean(args.json));
  },
});

const wsUse = defineCommand({
  meta: { name: 'use', description: 'Set the active workspace' },
  args: {
    name: { type: 'positional', description: 'Workspace name', required: true },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('workspace.use', { name: args.name });
    render('workspace.use', result, Boolean(args.json));
  },
});

const wsCurrent = defineCommand({
  meta: { name: 'current', description: 'Show the active workspace' },
  args: { json: { type: 'boolean', description: 'JSON output' } },
  async run({ args }) {
    const result = await core.run('workspace.current', {});
    render('workspace.current', result, Boolean(args.json));
  },
});

const wsRemove = defineCommand({
  meta: { name: 'remove', description: 'Unregister a workspace (does not delete files)' },
  args: {
    name: { type: 'positional', description: 'Workspace name', required: true },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('workspace.remove', { name: args.name });
    render('workspace.remove', result, Boolean(args.json));
  },
});

const wsDemo = defineCommand({
  meta: {
    name: 'demo',
    description:
      'Create a demo workspace pre-seeded with interconnected files + badge prompts + refs',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Absolute path where the demo workspace should live (created if missing)',
      required: true,
    },
    name: { type: 'string', description: 'Workspace name (defaults to basename)' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('workspace.createDemo', {
      path: args.path,
      ...(args.name && { name: args.name }),
    });
    render('workspace.createDemo', result, Boolean(args.json));
  },
});

const wsRepath = defineCommand({
  meta: {
    name: 'repath',
    description: 'Rebind a workspace to a new folder (atomic; preserves name + addedAt)',
  },
  args: {
    name: { type: 'positional', description: 'Workspace name', required: true },
    path: { type: 'positional', description: 'New absolute path', required: true },
    setup: {
      type: 'boolean',
      description: 'Also install the agent-protocol hint in CLAUDE.md and update .gitignore',
    },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('workspace.repath', {
      name: args.name,
      path: args.path,
      ...(args.setup ? { setup: true } : {}),
    });
    render('workspace.repath', result, Boolean(args.json));
  },
});

const wsRename = defineCommand({
  meta: {
    name: 'rename',
    description: 'Rename a workspace (path and .bh/ untouched)',
  },
  args: {
    from: { type: 'positional', description: 'Current workspace name', required: true },
    to: { type: 'positional', description: 'New workspace name', required: true },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('workspace.rename', {
      from: args.from,
      to: args.to,
    });
    render('workspace.rename', result, Boolean(args.json));
  },
});

const workspace = defineCommand({
  meta: { name: 'workspace', description: 'Manage BaseHalf workspaces' },
  subCommands: {
    add: wsAdd,
    list: wsList,
    use: wsUse,
    current: wsCurrent,
    remove: wsRemove,
    rename: wsRename,
    repath: wsRepath,
    demo: wsDemo,
  },
});

// ── badge.* ────────────────────────────────────────────────────────────────

const badgeGet = defineCommand({
  meta: { name: 'get', description: 'Show one badge JSON (null if not materialized)' },
  args: {
    file: { type: 'positional', description: 'Relative path in workspace', required: true },
    kind: { type: 'string', description: 'file|folder (default: file)' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('badge.get', {
      file: args.file,
      ...(args.kind && { kind: args.kind }),
    });
    render('badge.get', result, Boolean(args.json));
  },
});

const badgeSet = defineCommand({
  meta: { name: 'set', description: 'Create or update a badge (prompt + kind only via CLI)' },
  args: {
    file: { type: 'positional', description: 'Relative path in workspace', required: true },
    kind: { type: 'string', description: 'file|folder (default: file)' },
    prompt: { type: 'string', description: 'Backpack prompt for the agent' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const patch: Record<string, unknown> = {};
    if (args.kind) patch.kind = args.kind;
    if (typeof args.prompt === 'string') patch.prompt = args.prompt;
    const result = await core.run('badge.set', { file: args.file, patch });
    render('badge.set', result, Boolean(args.json));
  },
});

const badgeList = defineCommand({
  meta: { name: 'list', description: 'List annotated badges in current workspace' },
  args: {
    kind: { type: 'string', description: 'Filter by file|folder' },
    query: { type: 'string', description: 'Substring filter (case-insensitive)' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('badge.list', {
      ...(args.kind && { kind: args.kind }),
      ...(typeof args.query === 'string' && { query: args.query }),
    });
    render('badge.list', result, Boolean(args.json));
  },
});

const badgeAddRef = defineCommand({
  meta: { name: 'addRef', description: 'Add a reference from one badge to another' },
  args: {
    file: {
      type: 'positional',
      description: 'The badge that gets the new reference',
      required: true,
    },
    to: { type: 'positional', description: 'Target path being referenced', required: true },
    note: { type: 'string', description: 'Freeform note on the reference' },
    kind: { type: 'string', description: 'file|folder (default: file)' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('badge.addRef', {
      file: args.file,
      to: args.to,
      ...(typeof args.note === 'string' && { note: args.note }),
      ...(args.kind && { kind: args.kind }),
    });
    render('badge.addRef', result, Boolean(args.json));
  },
});

const badgeRemoveRef = defineCommand({
  meta: { name: 'removeRef', description: 'Drop a reference between badges' },
  args: {
    file: {
      type: 'positional',
      description: 'The badge whose reference is being removed',
      required: true,
    },
    to: { type: 'positional', description: 'Target path being de-referenced', required: true },
    kind: { type: 'string', description: 'file|folder (default: file)' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('badge.removeRef', {
      file: args.file,
      to: args.to,
      ...(args.kind && { kind: args.kind }),
    });
    render('badge.removeRef', result, Boolean(args.json));
  },
});

const badgeRename = defineCommand({
  meta: {
    name: 'rename',
    description: 'Atomically rename a badge (cascade refs + focus)',
  },
  args: {
    from: { type: 'positional', description: 'Current file path', required: true },
    to: { type: 'positional', description: 'New file path', required: true },
    kind: { type: 'string', description: 'file|folder (default: file)' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('badge.rename', {
      from: args.from,
      to: args.to,
      ...(args.kind && { kind: args.kind }),
    });
    render('badge.rename', result, Boolean(args.json));
  },
});

const badgeDelete = defineCommand({
  meta: {
    name: 'delete',
    description: 'Delete a badge (cascade: drop its inbound entries + refresh the brief)',
  },
  args: {
    file: { type: 'positional', description: 'Relative path in workspace', required: true },
    kind: { type: 'string', description: 'file|folder (default: file)' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('badge.delete', {
      file: args.file,
      ...(args.kind && { kind: args.kind }),
    });
    render('badge.delete', result, Boolean(args.json));
  },
});

const badge = defineCommand({
  meta: { name: 'badge', description: 'Manage badge JSON (file + backpack)' },
  subCommands: {
    get: badgeGet,
    set: badgeSet,
    list: badgeList,
    addRef: badgeAddRef,
    removeRef: badgeRemoveRef,
    rename: badgeRename,
    delete: badgeDelete,
  },
});

// ── inbound.* ──────────────────────────────────────────────────────────────

const inboundGet = defineCommand({
  meta: { name: 'get', description: 'Show inbound references targeting a file' },
  args: {
    file: { type: 'positional', description: 'Relative path in workspace', required: true },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('inbound.get', { file: args.file });
    render('inbound.get', result, Boolean(args.json));
  },
});

const inboundRebuild = defineCommand({
  meta: { name: 'rebuild', description: 'Rebuild the reverse index from all badges' },
  args: { json: { type: 'boolean', description: 'JSON output' } },
  async run({ args }) {
    const result = await core.run('inbound.rebuild', {});
    render('inbound.rebuild', result, Boolean(args.json));
  },
});

const inbound = defineCommand({
  meta: { name: 'inbound', description: 'Query / rebuild reverse references' },
  subCommands: { get: inboundGet, rebuild: inboundRebuild },
});

// ── proposals.* ──────────────────────────────────────────────────────────────

const proposalsList = defineCommand({
  meta: {
    name: 'list',
    description: 'List agent observations written to .bh/cache/proposals.md',
  },
  args: { json: { type: 'boolean', description: 'JSON output' } },
  async run({ args }) {
    const result = await core.run('proposals.list', {});
    render('proposals.list', result, Boolean(args.json));
  },
});

const proposalsDismiss = defineCommand({
  meta: { name: 'dismiss', description: 'Remove one proposal by its index (from `list`)' },
  args: {
    line: { type: 'positional', description: 'The proposal index to dismiss', required: true },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('proposals.dismiss', { line: Number(args.line) });
    render('proposals.dismiss', result, Boolean(args.json));
  },
});

const proposalsClear = defineCommand({
  meta: { name: 'clear', description: 'Clear all agent proposals' },
  args: { json: { type: 'boolean', description: 'JSON output' } },
  async run({ args }) {
    const result = await core.run('proposals.clear', {});
    render('proposals.clear', result, Boolean(args.json));
  },
});

const proposals = defineCommand({
  meta: { name: 'proposals', description: 'Triage agent observations (the write-back leg)' },
  subCommands: { list: proposalsList, dismiss: proposalsDismiss, clear: proposalsClear },
});

// ── focus.* ────────────────────────────────────────────────────────────────

const focusSet = defineCommand({
  meta: {
    name: 'set',
    description: 'Publish the focus signal (.bh/focus.md) — a file list or a folder',
  },
  args: {
    files: { type: 'string', description: 'Comma-separated list of relative file paths' },
    folder: {
      type: 'string',
      description:
        'A folder path: focus all supported files under it, with the folder prompt as the intent',
    },
    intent: { type: 'string', description: 'Set the turn intent alongside the files' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const hasFolder = typeof args.folder === 'string' && args.folder.length > 0;
    const hasFiles = typeof args.files === 'string' && args.files.length > 0;
    const hasIntent = typeof args.intent === 'string' && args.intent.length > 0;
    // A bare `bh focus set` (no flags) would resolve to files:[] and SILENTLY
    // CLEAR the user's curated focus + intent — a destructive no-op trap for the
    // exact agent/scripting flows the hint invites. Refuse it; `focus clear` is
    // the explicit way to empty the focus.
    if (!hasFolder && !hasFiles && !hasIntent) {
      process.stderr.write(
        'bh focus set: nothing to set. Pass --files <csv>, --folder <path>, and/or --intent <text>.\n' +
          'To empty the focus, use `bh focus clear`.\n',
      );
      process.exit(1);
    }
    if (hasFolder) {
      const result = await core.run('focus.set', {
        folder: args.folder,
        ...(hasIntent && { intent: args.intent }),
      });
      render('focus.set', result, Boolean(args.json));
      return;
    }
    const files = hasFiles
      ? (args.files as string)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    // If only --intent was given (no files), set the intent without touching the
    // active set, instead of clearing it to []. Otherwise set the files (+ intent).
    if (!hasFiles && hasIntent) {
      const result = await core.run('focus.setIntent', { intent: args.intent });
      render('focus.setIntent', result, Boolean(args.json));
      return;
    }
    const result = await core.run('focus.set', {
      files,
      ...(hasIntent && { intent: args.intent }),
    });
    render('focus.set', result, Boolean(args.json));
  },
});

const focusGet = defineCommand({
  meta: { name: 'get', description: 'Show the current focus active list' },
  args: { json: { type: 'boolean', description: 'JSON output' } },
  async run({ args }) {
    const result = await core.run('focus.get', {});
    render('focus.get', result, Boolean(args.json));
  },
});

const focusClear = defineCommand({
  meta: { name: 'clear', description: 'Clear the focus signal (active = none)' },
  args: { json: { type: 'boolean', description: 'JSON output' } },
  async run({ args }) {
    const result = await core.run('focus.clear', {});
    render('focus.clear', result, Boolean(args.json));
  },
});

const focusBrief = defineCommand({
  meta: {
    name: 'brief',
    description: 'Print the current turn brief (.bh/focus.md) — what the agent reads',
  },
  args: {
    json: { type: 'boolean', description: 'JSON output' },
    portable: {
      type: 'boolean',
      description:
        "Append capped file excerpts (for pasting into a chat that can't open your disk)",
    },
  },
  async run({ args }) {
    const result = await core.run('focus.brief', { portable: Boolean(args.portable) });
    render('focus.brief', result, Boolean(args.json));
  },
});

const focusSetIntent = defineCommand({
  meta: {
    name: 'set-intent',
    description:
      "Set (or clear) the turn intent — the user's question — WITHOUT changing the active set",
  },
  args: {
    intent: {
      type: 'positional',
      description: 'The turn intent text; omit (or pass "") to clear it',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('focus.setIntent', {
      intent: typeof args.intent === 'string' ? args.intent : '',
    });
    render('focus.setIntent', result, Boolean(args.json));
  },
});

const focus = defineCommand({
  meta: { name: 'focus', description: 'Read / write the agent focus signal' },
  subCommands: {
    set: focusSet,
    'set-intent': focusSetIntent,
    get: focusGet,
    brief: focusBrief,
    clear: focusClear,
  },
});

// ── search ───────────────────────────────────────────────────────────────────

const search = defineCommand({
  meta: {
    name: 'search',
    description: 'Full-text search the current workspace (find a note by its content)',
  },
  args: {
    query: { type: 'positional', description: 'Text to search for', required: true },
    maxFiles: { type: 'string', description: 'Max files to return (default 50; 8 with --brief)' },
    maxPerFile: {
      type: 'string',
      description: 'Max snippet lines per file (default 5; 3 with --brief)',
    },
    brief: {
      type: 'boolean',
      description:
        'Assemble a paste-ready context brief: matches hydrated with badge prompts + reference notes',
    },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const maxFiles = Number.parseInt(String(args.maxFiles ?? ''), 10);
    const maxPerFile = Number.parseInt(String(args.maxPerFile ?? ''), 10);
    const cmd = args.brief === true ? 'search.brief' : 'search.query';
    const result = await core.run(cmd, {
      query: args.query,
      ...(Number.isFinite(maxFiles) && maxFiles > 0 && { maxFiles }),
      ...(Number.isFinite(maxPerFile) && maxPerFile > 0 && { maxMatchesPerFile: maxPerFile }),
    });
    render(cmd, result, Boolean(args.json));
  },
});

// ── init ───────────────────────────────────────────────────────────────────

const init = defineCommand({
  meta: {
    name: 'init',
    description:
      'Register the current directory as a workspace + setup (.gitignore + agent hints: CLAUDE.md and AGENTS.md)',
  },
  args: {
    name: { type: 'string', description: 'Override workspace name (default: cwd basename)' },
    demo: {
      type: 'boolean',
      description:
        'Instead: create the pre-seeded demo workspace at ~/BaseHalf-Demo (alias of `bh workspace demo`)',
    },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    if (args.demo === true) {
      // Discoverability alias: the demo generator existed but only behind
      // `bh workspace demo <path>` / the desktop onboarding. Same core command.
      const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
      const result = await core.run('workspace.createDemo', { path: `${home}/BaseHalf-Demo` });
      render('workspace.createDemo', result, Boolean(args.json));
      return;
    }
    const cwd = process.cwd();
    const result = await core.run('workspace.add', {
      path: cwd,
      setup: true,
      ...(typeof args.name === 'string' && args.name.length > 0 && { name: args.name }),
    });
    render('workspace.add', result, Boolean(args.json));
  },
});

// ── Root ───────────────────────────────────────────────────────────────────

const main = defineCommand({
  meta: {
    name: 'bh',
    version: '0.0.1',
    description: 'BaseHalf — local-first compound thinking workspace (pre-alpha CLI)',
  },
  subCommands: { init, workspace, badge, inbound, focus, search, proposals },
});

// citty's runMain handles --help/--version/argv parsing. We wrap to translate
// UnknownCommand into a clean exit-1 message.
try {
  await runMain(main);
} catch (err) {
  if (err instanceof UnknownCommand) {
    process.stderr.write(`bh: unknown command: ${err.command}\n`);
    process.exit(1);
  }
  process.stderr.write(`bh: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
