import { basename, isAbsolute, join, resolve } from 'node:path';
import {
  type Handler,
  assertReadContained,
  assertWriteContained,
  readMaybeNoFollow,
  writeMaybeNoFollow,
} from '../../kernel/index.js';
import { DEMO_FILES } from './demo-content.js';
import { NAME_PATTERN } from './lock.js';
import { runSetup } from './setup.js';
import { readWorkspaces } from './store.js';
import type {
  WorkspaceAddArgs,
  WorkspaceAddResult,
  WorkspaceCreateDemoArgs,
  WorkspaceCreateDemoResult,
} from './types.js';

/**
 * `workspace.createDemo(path)` — seed a brand-new workspace with a tiny
 * interconnected MD set so a first-run user sees the agent-protocol
 * loop in action without having to assemble it themselves.
 *
 * Does:
 *  1. Creates `path` if missing (mkdir recursive).
 *  2. Writes the demo MD files (only if they don't already exist —
 *     never overwrites user content; an existing file is left alone).
 *  3. Registers the workspace via the normal workspace.add path with
 *     `setup: true` so the CLAUDE.md hint + .bh/cache/ gitignore land.
 *  4. Sets badge prompts via badge.set, draws references via
 *     badge.addRef. Cross-module calls go through ctx.run so the dep
 *     arrow points inward.
 *  5. Sets focus to the intro file so an AI agent opened in the folder
 *     immediately has a "what to pay attention to" signal.
 *
 * Why opinionated content (vs an empty folder): the v0 success criterion
 * is "did anyone say 卧槽 bh 救了我一命." A blank canvas after Add folder
 * is not that moment. A pre-populated canvas where Claude Code can
 * answer "what's in here?" in one round-trip IS that moment.
 */
export const createDemo: Handler<WorkspaceCreateDemoArgs, WorkspaceCreateDemoResult> = async (
  args,
  ctx,
) => {
  const absPath = isAbsolute(args.path) ? args.path : resolve(args.path);
  const name = args.name ?? basename(absPath);
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid workspace name: ${JSON.stringify(name)} (allowed: a-z, 0-9, . _ -, 1-64 chars, starts alnum)`,
    );
  }
  // Create the directory if missing — unlike workspace.add, demo
  // assumes the user picked a fresh location.
  await ctx.fs.mkdir(absPath, { recursive: true });

  // Seed the demo files (only if they don't already exist; never
  // overwrite). Tracking filesCreated so the caller can surface what
  // actually appeared.
  const filesCreated: string[] = [];
  for (const file of DEMO_FILES) {
    const fileAbs = join(absPath, file.path);
    // Keep the "every core user-file write is realpath-contained" invariant
    // even on the demo path. Lower risk (a fresh folder the user picked, fixed
    // boilerplate), but a planted symlink named like a demo file shouldn't let
    // the write escape either. Refuse-and-skip rather than clobber outside.
    let existing: string | null;
    let writeAbs: string;
    try {
      existing = await readMaybeNoFollow(
        ctx.fs,
        await assertReadContained(ctx.fs, absPath, fileAbs),
      );
      if (existing !== null) continue;
      writeAbs = await assertWriteContained(ctx.fs, absPath, fileAbs);
    } catch (err) {
      if (err instanceof Error && err.name === 'PathEscape') continue;
      throw err;
    }
    await ctx.fs.mkdir(join(absPath, file.path.split('/').slice(0, -1).join('/') || '.'), {
      recursive: true,
    });
    await writeMaybeNoFollow(ctx.fs, writeAbs, file.content);
    filesCreated.push(file.path);
  }

  // Register the workspace; setup:true so the agent-protocol hint
  // installs. If a workspace with this name already exists (user clicked
  // "Try a demo" a second time), make the operation idempotent: switch
  // to it and proceed to re-apply the demo prompts + refs. Without this
  // the user would hit "Workspace already exists" as a hard error on
  // their second click.
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  let addResult: WorkspaceAddResult;
  if (data.workspaces[name]) {
    const existing = data.workspaces[name];
    if (existing.path !== absPath) {
      // Collision on name but different path — that IS a real conflict
      // the user should resolve. Surface it.
      throw new Error(
        `Workspace name "${name}" is already registered at ${existing.path}. Pick a different demo path.`,
      );
    }
    await ctx.run('workspace.use', { name });
    addResult = {
      workspace: { name, path: existing.path, addedAt: existing.addedAt },
      setAsCurrent: true,
      bhDirCreated: false,
      // Re-run setup so a deleted CLAUDE.md gets recreated. Setup is
      // marker-detected idempotent on existing CLAUDE.md.
      setup: await runSetup(ctx.fs, absPath),
    };
  } else {
    addResult = await ctx.run<WorkspaceAddArgs, WorkspaceAddResult>('workspace.add', {
      path: absPath,
      name,
      setup: true,
    });
  }

  // Apply badge prompts + refs. badge.set + badge.addRef cascade through
  // the inbound index automatically. If a file was already on disk
  // (didn't get re-seeded), its badge still gets the demo prompt to
  // make the loop coherent.
  for (const file of DEMO_FILES) {
    // Build the badge patch from whatever the demo file declares: prompt and
    // the hub-and-spoke canvas position. collapsed:false because BadgePosition
    // requires it. Skip the call only if there's nothing to set.
    const patch: {
      kind: 'file';
      prompt?: string;
      canvas?: { x: number; y: number; collapsed: boolean };
    } = { kind: 'file' };
    if (file.prompt !== undefined) patch.prompt = file.prompt;
    if (file.canvas !== undefined) {
      patch.canvas = { x: file.canvas.x, y: file.canvas.y, collapsed: false };
    }
    if (patch.prompt !== undefined || patch.canvas !== undefined) {
      await ctx.run('badge.set', { file: file.path, patch });
    }
    for (const ref of file.refs ?? []) {
      await ctx.run('badge.addRef', {
        file: file.path,
        to: ref.to,
        ...(ref.note !== undefined && { note: ref.note }),
      });
    }
  }

  // CLAUDE.md is created by setup (not a DEMO_FILE), so it has no position
  // from the loop above. Place it in the top-right corner — present but
  // clearly secondary to the four content files of the tree — instead of
  // letting it land mid-canvas in the auto-grid. Best-effort: if setup
  // skipped CLAUDE.md (e.g. user's own already existed), there may be no
  // badge to position.
  await ctx
    .run('badge.set', {
      file: 'CLAUDE.md',
      patch: { kind: 'file', canvas: { x: 620, y: 60, collapsed: false } },
    })
    .catch(() => undefined);

  // Focus the intro file so the agent's first read of focus.md returns
  // a useful pointer instead of (none) — AND seed an intent so the demo's
  // first-run focus.md showcases the COMPLETE turn brief (intent + active +
  // inlined prompt + refs, #91), not a subset. The intent mirrors the exact
  // question intro.md invites the user to ask, so the agent's first read is a
  // natural, self-contained handoff.
  await ctx.run('focus.set', {
    files: ['intro.md'],
    intent: 'Get oriented in this workspace — what is it about, and how do these files connect?',
  });

  return {
    workspace: addResult.workspace,
    filesCreated,
    setup: addResult.setup ?? {
      gitignoreUpdated: false,
      claudeMdUpdated: false,
      gitignoreSkipped: false,
      claudeMdSkipped: false,
      gitignoreAbsent: true,
    },
  };
};
