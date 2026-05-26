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
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('workspace.add', {
      path: args.path,
      ...(typeof args.name === 'string' && args.name.length > 0 && { name: args.name }),
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

const workspace = defineCommand({
  meta: { name: 'workspace', description: 'Manage BaseHalf workspaces' },
  subCommands: {
    add: wsAdd,
    list: wsList,
    use: wsUse,
    current: wsCurrent,
    remove: wsRemove,
  },
});

// ── Root ───────────────────────────────────────────────────────────────────

const main = defineCommand({
  meta: {
    name: 'bh',
    version: '0.0.1',
    description: 'BaseHalf — composable, portable memory for coding agents',
  },
  subCommands: { workspace },
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
