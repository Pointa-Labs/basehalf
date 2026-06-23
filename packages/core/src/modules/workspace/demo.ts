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

/** Default card size for the demo's seeded canvas cards (matches the spec's
 *  example dimensions; the renderer resizes to taste afterward). */
const DEMO_FILE_CARD_WIDTH = 260;
const DEMO_FILE_CARD_HEIGHT = 150;

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
  // "Try a demo" a second time), make the operation idempotent: proceed to
  // re-apply the demo prompts + refs (the renderer opens it afterward).
  // Without this the user would hit "Workspace already exists" as a hard error
  // on their second click.
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
    addResult = {
      workspace: { name, path: existing.path, addedAt: existing.addedAt },
      bhDirCreated: false,
      alreadyRegistered: true,
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

  // Every mutation below targets the DEMO workspace explicitly: createDemo runs
  // under the CALLER's bound root (the welcome window, often none), so we bind
  // each sub-call to the demo's own root rather than inheriting the caller's.
  const demoRoot = { workspaceRoot: absPath };

  // Apply the badge descriptions (the semantic layer) and the canvas cards (the
  // visual layer) separately, per the focus_mode_spec split. All demo files live
  // at the workspace root, so the root folder's canvas.yaml (folder: null) holds
  // their cards + edges. A file already on disk still gets the demo description so
  // the loop stays coherent.
  for (const file of DEMO_FILES) {
    if (file.prompt !== undefined) {
      await ctx.run(
        'badge.set',
        {
          file: file.path,
          patch: { kind: 'file', description: file.prompt },
        },
        demoRoot,
      );
    }
    if (file.canvas !== undefined) {
      await ctx.run(
        'canvas.setCard',
        {
          folder: null,
          card: {
            path: file.path,
            kind: 'file',
            x: file.canvas.x,
            y: file.canvas.y,
            width: DEMO_FILE_CARD_WIDTH,
            height: DEMO_FILE_CARD_HEIGHT,
          },
        },
        demoRoot,
      );
    }
  }
  // Draw the references AFTER every card exists. canvas.connect writes the visual
  // edge (anchors + the note as its label) AND the semantic badge.references link
  // in lockstep, so the agent's referenced_by graph matches what the canvas shows.
  for (const file of DEMO_FILES) {
    for (const ref of file.refs ?? []) {
      await ctx.run(
        'canvas.connect',
        {
          folder: null,
          from: file.path,
          to: ref.to,
          from_anchor: 'east',
          to_anchor: 'west',
          kind: 'file',
          ...(ref.note !== undefined && { label: ref.note }),
        },
        demoRoot,
      );
    }
  }

  // CLAUDE.md is created by setup (not a DEMO_FILE), so it has no card from the
  // loop above. Place it in the top-right corner — present but clearly secondary
  // to the content tree — instead of landing mid-canvas in the auto-grid.
  // Best-effort: if setup skipped CLAUDE.md (user's own already existed), the
  // card just points at a file the canvas won't render.
  await ctx
    .run(
      'canvas.setCard',
      {
        folder: null,
        card: {
          path: 'CLAUDE.md',
          kind: 'file',
          x: 620,
          y: 60,
          width: DEMO_FILE_CARD_WIDTH,
          height: DEMO_FILE_CARD_HEIGHT,
        },
      },
      demoRoot,
    )
    .catch(() => undefined);

  // Focus the intro file so the agent's first read of `.bh/current_focus.yaml`
  // points at a useful node instead of returning null — the viewport-mirror
  // equivalent of "the user is looking at intro.md."
  await ctx.run('focus.set', { path: 'intro.md', kind: 'file' }, demoRoot);

  return {
    workspace: addResult.workspace,
    filesCreated,
    setup: addResult.setup ?? {
      gitignoreUpdated: false,
      claudeMdUpdated: false,
      agentsMdUpdated: false,
      copilotMdUpdated: false,
      gitignoreSkipped: false,
      claudeMdSkipped: false,
      agentsMdSkipped: false,
      copilotMdSkipped: false,
      gitignoreAbsent: true,
    },
  };
};
