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

// citty returns scalar args as `<type>` but list-valued args (`type: 'string',
// alias: ...` repeated) come through as `string | string[]`. Normalize.
function asArray(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

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

// ── decision.* ─────────────────────────────────────────────────────────────

const decisionAdd = defineCommand({
  meta: {
    name: 'add',
    description: 'Record a decision (rationale + sources + tags) in the current workspace',
  },
  args: {
    title: { type: 'positional', description: 'Decision title', required: true },
    because: { type: 'string', description: 'Rationale (required)', required: true },
    source: { type: 'string', description: 'Source reference (repeatable)' },
    tag: { type: 'string', description: 'Tag (repeatable)' },
    slug: { type: 'string', description: 'Override slug (default: derived from title)' },
    by: { type: 'string', description: 'Override decidedBy (default: $USER)' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('decision.add', {
      title: args.title,
      because: args.because,
      source: asArray(args.source),
      tag: asArray(args.tag),
      ...(typeof args.slug === 'string' && args.slug.length > 0 && { slug: args.slug }),
      ...(typeof args.by === 'string' && args.by.length > 0 && { by: args.by }),
    });
    render('decision.add', result, Boolean(args.json));
  },
});

const decisionRecall = defineCommand({
  meta: {
    name: 'recall',
    description: 'Search decisions by query / tag / status (newest first)',
  },
  args: {
    query: {
      type: 'positional',
      description: 'Search query (substring, case-insensitive)',
      required: false,
    },
    tag: { type: 'string', description: 'Filter by tag (AND semantics; repeatable)' },
    status: { type: 'string', description: 'Filter by status (active|deprecated|superseded)' },
    limit: { type: 'string', description: 'Max results to return' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const limit =
      typeof args.limit === 'string' && args.limit.length > 0 ? Number(args.limit) : undefined;
    const result = await core.run('decision.recall', {
      ...(typeof args.query === 'string' && args.query.length > 0 && { query: args.query }),
      tag: asArray(args.tag),
      ...(typeof args.status === 'string' && args.status.length > 0 && { status: args.status }),
      ...(limit !== undefined && !Number.isNaN(limit) && { limit }),
    });
    render('decision.recall', result, Boolean(args.json));
  },
});

const decisionList = defineCommand({
  meta: { name: 'list', description: 'List all decisions (alias for `recall` with no query)' },
  args: {
    tag: { type: 'string', description: 'Filter by tag (repeatable)' },
    status: { type: 'string', description: 'Filter by status' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('decision.list', {
      tag: asArray(args.tag),
      ...(typeof args.status === 'string' && args.status.length > 0 && { status: args.status }),
    });
    render('decision.list', result, Boolean(args.json));
  },
});

const decisionShow = defineCommand({
  meta: { name: 'show', description: 'Show one decision by slug' },
  args: {
    slug: { type: 'positional', description: 'Decision slug', required: true },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('decision.show', { slug: args.slug });
    render('decision.show', result, Boolean(args.json));
  },
});

const decisionUpdate = defineCommand({
  meta: {
    name: 'update',
    description: 'Update a decision (status / append sources / append tags / mark superseded)',
  },
  args: {
    slug: { type: 'positional', description: 'Decision slug', required: true },
    status: { type: 'string', description: 'New status (active|deprecated|superseded)' },
    'add-source': { type: 'string', description: 'Append a source (repeatable)' },
    'add-tag': { type: 'string', description: 'Append a tag (repeatable)' },
    'superseded-by': {
      type: 'string',
      description: 'Slug of the decision that supersedes this one',
    },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const result = await core.run('decision.update', {
      slug: args.slug,
      ...(typeof args.status === 'string' && args.status.length > 0 && { status: args.status }),
      addSource: asArray(args['add-source']),
      addTag: asArray(args['add-tag']),
      ...(typeof args['superseded-by'] === 'string' &&
        args['superseded-by'].length > 0 && { supersededBy: args['superseded-by'] }),
    });
    render('decision.update', result, Boolean(args.json));
  },
});

const decision = defineCommand({
  meta: {
    name: 'decision',
    description: 'Record and recall design decisions in the current workspace',
  },
  subCommands: {
    add: decisionAdd,
    recall: decisionRecall,
    list: decisionList,
    show: decisionShow,
    update: decisionUpdate,
  },
});

// ── Root ───────────────────────────────────────────────────────────────────

const main = defineCommand({
  meta: {
    name: 'bh',
    version: '0.0.1',
    description: 'BaseHalf — composable, portable memory for coding agents',
  },
  subCommands: { workspace, decision },
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
