import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  type Context,
  type Handler,
  PathEscape,
  assertReadContained,
  assertWorkspaceRelative,
  assertWriteContained,
  canonicalize,
  createKeyedMutex,
  isContained,
  readMaybeNoFollow,
  writeMaybeNoFollow,
} from '../../kernel/index.js';
import { DEMO_FILES } from './demo-content.js';
import { materializeWorkspace } from './materialize.js';
import { runSetup } from './setup.js';
import { readWorkspaces, writeWorkspaces } from './store.js';
import type {
  WorkspaceAddArgs,
  WorkspaceAddResult,
  WorkspaceCreateDemoArgs,
  WorkspaceCreateDemoResult,
  WorkspaceCurrentArgs,
  WorkspaceCurrentResult,
  WorkspaceEntry,
  WorkspaceGetViewportArgs,
  WorkspaceGetViewportResult,
  WorkspaceListArgs,
  WorkspaceListFilesArgs,
  WorkspaceListFilesEntry,
  WorkspaceListFilesResult,
  WorkspaceListResult,
  WorkspaceReadFileArgs,
  WorkspaceReadFileResult,
  WorkspaceRemoveArgs,
  WorkspaceRemoveResult,
  WorkspaceRenameArgs,
  WorkspaceRenameResult,
  WorkspaceRepathArgs,
  WorkspaceRepathResult,
  WorkspaceSetViewportArgs,
  WorkspaceSetViewportResult,
  WorkspaceUseArgs,
  WorkspaceUseResult,
  WorkspaceWriteFileArgs,
  WorkspaceWriteFileResult,
} from './types.js';

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

// Serialize read → mutate → write on the single workspaces.json config per
// configDir. add / use / remove / rename / repath / setViewport all do this
// dance; the desktop fires setViewport as a DEBOUNCED, un-awaited call that
// is NOT behind the renderer's busy guard, so it can race a workspace switch
// in-process — both read the pre-write config and the second write clobbers
// the first (lost workspace, or a reverted `current` pointer silently undoing
// the switch). Reproduced by test/workspace-config-concurrency.test.ts.
// Single-process scope like inbound/views — see kernel/mutex.ts. The lock
// wraps only the config read-modify-write; slow materialization stays
// outside it. No config handler calls another while holding the lock, so
// there is no re-entrancy/deadlock (createDemo delegates to add/use, which
// take and release the lock themselves).
const withConfigLock = createKeyedMutex();

/**
 * `workspace add <path> [--name <name>]`
 *  - Validates the path exists and is a directory.
 *  - Derives a name from basename (or uses `--name`); refuses duplicates.
 *  - Creates `<path>/.bh/` if missing (eager init; lazier feels surprising).
 *  - First workspace added becomes `current` automatically.
 */
export const add: Handler<WorkspaceAddArgs, WorkspaceAddResult> = async (args, ctx) => {
  const absPath = isAbsolute(args.path) ? args.path : resolve(args.path);
  const stat = await ctx.fs.stat(absPath);
  if (!stat) {
    throw new Error(`Path does not exist: ${absPath}`);
  }
  if (!stat.isDirectory) {
    throw new Error(`Path is not a directory: ${absPath}`);
  }

  const name = args.name ?? basename(absPath);
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid workspace name: ${JSON.stringify(name)} (allowed: a-z, 0-9, . _ -, 1-64 chars, starts alnum)`,
    );
  }

  const addedAt = new Date().toISOString();
  const bhDir = `${absPath}/.bh`;
  // Atomic config section: dup-check + write must not interleave with a
  // concurrent add/use/setViewport or a workspace gets dropped. bhDir
  // creation lives inside too — cheap, and it's gated on this name winning
  // the dup-check.
  const { setAsCurrent, bhDirCreated } = await withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    if (data.workspaces[name]) {
      throw new Error(`Workspace already exists: ${name}`);
    }
    const bhStat = await ctx.fs.stat(bhDir);
    const created = bhStat === null;
    if (created) {
      await ctx.fs.mkdir(bhDir, { recursive: true });
    }
    const becomesCurrent = data.current === null;
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      current: becomesCurrent ? name : data.current,
      workspaces: { ...data.workspaces, [name]: { path: absPath, addedAt } },
    });
    return { setAsCurrent: becomesCurrent, bhDirCreated: created };
  });

  const setup = args.setup ? await runSetup(ctx.fs, absPath) : undefined;

  // Workspace-becoming-current = "opening" → materialize defaults (SR-v0
  // §3.1). For subsequent adds (not auto-current), materialization is
  // deferred to workspace.use.
  if (setAsCurrent) {
    await materializeWithFallback(ctx, absPath);
  }

  return {
    workspace: { name, path: absPath, addedAt },
    setAsCurrent,
    bhDirCreated,
    ...(setup !== undefined && { setup }),
  };
};

/** `workspace list` — returns all workspaces + which is current. */
export const list: Handler<WorkspaceListArgs, WorkspaceListResult> = async (_args, ctx) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const workspaces: WorkspaceEntry[] = Object.entries(data.workspaces)
    .map(([name, entry]) => ({
      name,
      path: entry.path,
      addedAt: entry.addedAt,
      ...(entry.viewport !== undefined && { viewport: entry.viewport }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { current: data.current, workspaces };
};

/** `workspace use <name>` — switch the active workspace. Triggers eager
 * badge materialization (SR-v0 §3.1) so opening a workspace always leaves
 * every supported-type file with a default badge JSON. Idempotent on
 * re-use because existing badges are short-circuited via badge.get. */
export const use: Handler<WorkspaceUseArgs, WorkspaceUseResult> = async (args, ctx) => {
  const entry = await withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    const found = data.workspaces[args.name];
    if (!found) {
      throw new Error(`No such workspace: ${args.name}`);
    }
    await writeWorkspaces(ctx.fs, ctx.configDir, { ...data, current: args.name });
    return found;
  });
  // Materialize outside the lock — it touches workspace files, not the
  // config, and can be slow; holding the config lock through it would stall
  // a concurrent setViewport for no correctness benefit.
  await materializeWithFallback(ctx, entry.path);
  return { current: { name: args.name, path: entry.path, addedAt: entry.addedAt } };
};

/** `workspace current` — show active workspace (or null if none). */
export const current: Handler<WorkspaceCurrentArgs, WorkspaceCurrentResult> = async (
  _args,
  ctx,
) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) return { current: null };
  const entry = data.workspaces[data.current];
  if (!entry) {
    // Stale pointer: current name no longer in workspaces. Treat as none.
    return { current: null };
  }
  return { current: { name: data.current, path: entry.path, addedAt: entry.addedAt } };
};

/**
 * `workspace remove <name>` — unregister. Does NOT delete files or `.bh/` —
 * BaseHalf is an "observer", never an owner of user files.
 * If the removed one was current, picks an alphabetically-first survivor (or null).
 */
export const remove: Handler<WorkspaceRemoveArgs, WorkspaceRemoveResult> = async (args, ctx) => {
  return withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    if (!data.workspaces[args.name]) {
      throw new Error(`No such workspace: ${args.name}`);
    }
    const { [args.name]: _removed, ...rest } = data.workspaces;
    let newCurrent: string | null = data.current;
    if (data.current === args.name) {
      const survivors = Object.keys(rest).sort((a, b) => a.localeCompare(b));
      newCurrent = survivors[0] ?? null;
    }
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      current: newCurrent,
      workspaces: rest,
    });
    return { removed: args.name, newCurrent };
  });
};

/**
 * `workspace.listFiles({ path })` — single-level directory listing for the
 * desktop NavTree. Lazy by design: only direct children, sorted dirs-first
 * then alphabetical. The renderer drives recursion by calling again with a
 * child dir's path when the user expands it.
 *
 * Filtering (hidden files like .git / .bh / .DS_Store) is the renderer's
 * job — keeping core unopinionated about display lets the same data feed
 * different UIs (CLI, MCP, alternative shells).
 */
export const listFiles: Handler<WorkspaceListFilesArgs, WorkspaceListFilesResult> = async (
  args,
  ctx,
) => {
  const absPath = isAbsolute(args.path) ? args.path : resolve(args.path);
  const stat = await ctx.fs.stat(absPath);
  if (!stat) {
    // Tagged so the desktop NavTree can render a "workspace unreachable"
    // re-select / unregister modal instead of a raw error string.
    throw Object.assign(new Error(`Path does not exist: ${absPath}`), {
      code: 'PATH_NOT_FOUND',
    });
  }
  if (!stat.isDirectory) throw new Error(`Path is not a directory: ${absPath}`);

  // Contain enumeration to the current workspace: listFiles takes an absolute
  // path the renderer drives from NavTree clicks, and ctx.fs.stat FOLLOWS
  // symlinks — so a planted dir-symlink (docs -> /etc) would otherwise let the
  // tree enumerate an arbitrary OUTSIDE directory (a filename/structure oracle
  // even though readFile refuses the content). Require the listed dir to be
  // inside the current workspace root, and skip any child that escapes it.
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const root = data.current !== null ? data.workspaces[data.current]?.path : undefined;
  // With NO current workspace there is no containment boundary — refuse rather
  // than fall through to enumerating an arbitrary absolute path (a planted
  // `listFiles({path:'/etc'})` would otherwise leak external dir structure).
  // Sibling reads (badge.list/view.list) already require a current workspace;
  // listFiles must not be the outlier.
  if (root === undefined) {
    throw new Error('No current workspace; call workspace.use first');
  }
  // Guard the anchor canonicalize (ELOOP/EACCES on the root or the listed dir
  // → refuse rather than crash with a raw fs error).
  let realRoot: string;
  let realDir: string;
  try {
    realRoot = await canonicalize(ctx.fs, root);
    realDir = await canonicalize(ctx.fs, absPath);
  } catch {
    throw new PathEscape(absPath);
  }
  if (!isContained(realRoot, realDir)) {
    throw new PathEscape(absPath);
  }

  const names = await ctx.fs.readdir(absPath);
  const entries: WorkspaceListFilesEntry[] = [];
  for (const name of names) {
    const child = join(absPath, name);
    // Filter a symlinked-out child so it never surfaces in the tree (and
    // can't be expanded into an external dir on the next listFiles call).
    let realChild: string;
    try {
      realChild = await canonicalize(ctx.fs, child);
    } catch {
      continue;
    }
    if (!isContained(realRoot, realChild)) continue;
    const childStat = await ctx.fs.stat(child);
    if (!childStat) continue;
    entries.push({ name, type: childStat.isDirectory ? 'dir' : 'file' });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: absPath, entries };
};

/** `workspace.getViewport()` — last persisted canvas viewport for the current
 * workspace; null if never set. */
export const getViewport: Handler<WorkspaceGetViewportArgs, WorkspaceGetViewportResult> = async (
  _args,
  ctx,
) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) return null;
  const entry = data.workspaces[data.current];
  return entry?.viewport ?? null;
};

/** `workspace.setViewport({ viewport })` — persist canvas viewport for the
 * current workspace. No-op if no current workspace. */
export const setViewport: Handler<WorkspaceSetViewportArgs, WorkspaceSetViewportResult> = async (
  args,
  ctx,
) => {
  return withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    if (data.current === null) return {};
    const entry = data.workspaces[data.current];
    if (!entry) return {};
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      ...data,
      workspaces: {
        ...data.workspaces,
        [data.current]: { ...entry, viewport: args.viewport },
      },
    });
    return {};
  });
};

function ensureInsideWorkspace(rel: string): void {
  // Path comes from renderer via IPC — defensively reject anything that
  // could escape the current workspace root. Delegates to the shared
  // kernel guard so workspace + badges enforce identical rules.
  assertWorkspaceRelative(rel);
}

/** `workspace.readFile({ path })` — read a user file in the current
 * workspace. Path is POSIX-relative; absolute paths or `..` are rejected. */
export const readFile: Handler<WorkspaceReadFileArgs, WorkspaceReadFileResult> = async (
  args,
  ctx,
) => {
  ensureInsideWorkspace(args.path);
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) throw new Error('No current workspace');
  const entry = data.workspaces[data.current];
  if (!entry) throw new Error('Current workspace pointer is stale');
  // Realpath-contain: assertWorkspaceRelative (above) rejects ../absolute in
  // the request string, but a planted symlink whose NAME is innocuous still
  // escapes once node:fs follows it. Canonicalize and require containment, then
  // read the canonical path so check and open agree. (See kernel/contain.ts.)
  const abs = await assertReadContained(ctx.fs, entry.path, join(entry.path, args.path));
  // O_NOFOLLOW read closes the check-then-read TOCTOU: if the leaf is swapped
  // for a symlink between the guard above and this read, the open refuses it
  // rather than re-following. (Residual: an intermediate-component swap still
  // needs openat2/RESOLVE_BENEATH, which Node doesn't expose — see
  // kernel/contain.ts. Falls back to plain readFile under the legacy mock.)
  const content = await readMaybeNoFollow(ctx.fs, abs);
  if (content === null) {
    throw Object.assign(new Error(`Path does not exist: ${abs}`), { code: 'PATH_NOT_FOUND' });
  }
  // Optional cap: a preview/viewer that only renders a slice can ask for just
  // that slice so a multi-MB file isn't serialized across IPC and held whole in
  // the renderer. (FsLike has no partial read yet, so we still read the file in
  // this process; capping here at least bounds what crosses the boundary. A
  // true streamed/partial read is a deeper FsLike change tracked for v0.x.)
  const capped =
    typeof args.maxChars === 'number' && args.maxChars >= 0 && content.length > args.maxChars;
  const slice = capped ? content.slice(0, args.maxChars) : content;
  // Content sniff: a NUL byte never occurs in real text, so its presence in the
  // (capped) prefix means the file is binary. The text viewer shows a message
  // instead of rendering mojibake — this is what lets extension-less files be
  // viewable WITHOUT an ever-growing extension allowlist. `content` is still
  // returned verbatim (never blanked) so a full read for editing can't lose
  // data; consumers decide what to do with the flag.
  const binary = slice.includes('\u0000');
  return {
    path: args.path,
    content: slice,
    ...(capped && { truncated: true }),
    ...(binary && { binary: true }),
  };
};

/** `workspace.writeFile({ path, content })` — write a user file inside the
 * current workspace. The *only* path through which bh modifies user
 * content. Used exclusively by the BlockNote editor in PR 14; everything
 * else is observer-only per IR-v2-13. */
export const writeFile: Handler<WorkspaceWriteFileArgs, WorkspaceWriteFileResult> = async (
  args,
  ctx,
) => {
  ensureInsideWorkspace(args.path);
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) throw new Error('No current workspace');
  const entry = data.workspaces[data.current];
  if (!entry) throw new Error('Current workspace pointer is stale');
  // Realpath-contain the WRITE: this is bh's only user-file write path, so a
  // planted symlink (a `config.md -> ~/.ssh/authorized_keys` leaf, or a
  // `drafts -> ~/Library/LaunchAgents` parent dir for a brand-new note) must
  // not let an editor save / New-Note clobber or plant a file outside the
  // workspace. assertWriteContained proves the real parent is inside and
  // refuses a symlink leaf. (See kernel/contain.ts.)
  const abs = await assertWriteContained(ctx.fs, entry.path, join(entry.path, args.path));
  // Honor the desktop new-note dialog's "folders auto-created" promise:
  // mkdir -p the parent so a path like `subdir/new/note.md` succeeds even
  // when `subdir/new` doesn't exist yet. Top-level paths have an empty
  // dirname (".") and the mkdir is a no-op.
  const parent = dirname(abs);
  if (parent && parent !== abs) {
    await ctx.fs.mkdir(parent, { recursive: true });
  }
  // O_NOFOLLOW write closes the check-then-write TOCTOU at the leaf: a symlink
  // raced onto `abs` after the guard is refused, not written through.
  await writeMaybeNoFollow(ctx.fs, abs, args.content);
  return { path: args.path, bytes: Buffer.byteLength(args.content, 'utf8') };
};

/**
 * Helper for `createCore()` — registers all workspace commands.
 * Modules expose a single `register*Module(core)` function so static composition
 * stays trivial; when external plugins arrive, the same shape is what they emit.
 */
export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['workspace.add', add as unknown as Handler<never, unknown>],
    ['workspace.list', list as unknown as Handler<never, unknown>],
    ['workspace.use', use as unknown as Handler<never, unknown>],
    ['workspace.current', current as unknown as Handler<never, unknown>],
    ['workspace.remove', remove as unknown as Handler<never, unknown>],
    ['workspace.rename', rename as unknown as Handler<never, unknown>],
    ['workspace.repath', repath as unknown as Handler<never, unknown>],
    ['workspace.createDemo', createDemo as unknown as Handler<never, unknown>],
    ['workspace.listFiles', listFiles as unknown as Handler<never, unknown>],
    ['workspace.getViewport', getViewport as unknown as Handler<never, unknown>],
    ['workspace.setViewport', setViewport as unknown as Handler<never, unknown>],
    ['workspace.readFile', readFile as unknown as Handler<never, unknown>],
    ['workspace.writeFile', writeFile as unknown as Handler<never, unknown>],
  ];
}

export function _coerceContext(ctx: unknown): asserts ctx is Context {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('invalid context');
}

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

/**
 * `workspace.rename(from, to)` — change a workspace's name without
 * touching its path / .bh/ / files. Updates the `current` pointer if it
 * was the renamed one.
 *
 * Why a dedicated command (vs remove + re-add): the obvious DIY recipe
 * is `workspace.remove(from) + workspace.add(path, name: to)`, but that
 * isn't atomic — if the add fails (e.g., the new name is taken by
 * another workspace, or `path` no longer exists on disk), the user is
 * left with no workspace registration at all. A single config-update
 * write makes the operation safe.
 */
export const rename: Handler<WorkspaceRenameArgs, WorkspaceRenameResult> = async (args, ctx) => {
  if (args.from === args.to) {
    throw new Error(`workspace.rename: from and to are the same (${args.from})`);
  }
  if (!NAME_PATTERN.test(args.to)) {
    throw new Error(
      `Invalid workspace name: ${JSON.stringify(args.to)} (allowed: a-z, 0-9, . _ -, 1-64 chars, starts alnum)`,
    );
  }
  return withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    const source = data.workspaces[args.from];
    if (!source) {
      throw new Error(`No such workspace: ${args.from}`);
    }
    if (data.workspaces[args.to]) {
      throw new Error(`Workspace name already taken: ${args.to}`);
    }
    // Build the new workspaces map; we re-insert the renamed entry to
    // preserve insertion order on JSON serialization. Other entries are
    // unchanged.
    const next: Record<string, (typeof data.workspaces)[string]> = {};
    for (const [name, entry] of Object.entries(data.workspaces)) {
      if (name === args.from) {
        next[args.to] = entry;
      } else {
        next[name] = entry;
      }
    }
    const currentUpdated = data.current === args.from;
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      current: currentUpdated ? args.to : data.current,
      workspaces: next,
    });
    return {
      workspace: { name: args.to, path: source.path, addedAt: source.addedAt },
      currentUpdated,
    };
  });
};

/**
 * `workspace.repath(name, path)` — rebind an existing workspace to a new
 * folder path. Atomic config-update; preserves name + addedAt; creates
 * `.bh/` at the new path if missing; runs setup if requested.
 *
 * Why a dedicated command (vs remove + re-add): the obvious DIY recipe
 * is `workspace.remove(name)` + `workspace.add(newPath, name)`, but if
 * the add fails (invalid path, missing folder, ...), the user is left
 * with NO workspace registration at all. A single config rewrite
 * skips that danger and the round-trip through `current` demotion.
 */
export const repath: Handler<WorkspaceRepathArgs, WorkspaceRepathResult> = async (args, ctx) => {
  const absPath = isAbsolute(args.path) ? args.path : resolve(args.path);
  const stat = await ctx.fs.stat(absPath);
  if (!stat) {
    throw new Error(`Path does not exist: ${absPath}`);
  }
  if (!stat.isDirectory) {
    throw new Error(`Path is not a directory: ${absPath}`);
  }
  const bhDir = `${absPath}/.bh`;
  // Atomic config section: validate against the live config + rewrite the
  // entry without interleaving with a concurrent config write. bhDir
  // creation is inside too (cheap, gated on validation). isCurrent is
  // captured for the post-lock materialization decision.
  const { existing, bhDirCreated, isCurrent } = await withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    const found = data.workspaces[args.name];
    if (!found) {
      throw new Error(`No such workspace: ${args.name}`);
    }
    if (found.path === absPath) {
      throw new Error(`Workspace ${args.name} is already at ${absPath}`);
    }
    // Ensure .bh/ at the new path so subsequent badges/focus/inbound writes
    // have somewhere to live. Same lifecycle hook as workspace.add.
    const bhStat = await ctx.fs.stat(bhDir);
    const created = bhStat === null;
    if (created) {
      await ctx.fs.mkdir(bhDir, { recursive: true });
    }
    // current pointer stays put (still pointing at this name if it was).
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      current: data.current,
      workspaces: {
        ...data.workspaces,
        [args.name]: { path: absPath, addedAt: found.addedAt },
      },
    });
    return { existing: found, bhDirCreated: created, isCurrent: data.current === args.name };
  });
  const setup = args.setup ? await runSetup(ctx.fs, absPath) : undefined;
  // If this workspace is currently open, re-materialize at the new path
  // (eager badges + focus + inbound seeding). Mirrors workspace.use.
  if (isCurrent) {
    await materializeWithFallback(ctx, absPath);
  }
  return {
    workspace: { name: args.name, path: absPath, addedAt: existing.addedAt },
    bhDirCreated,
    ...(setup !== undefined && { setup }),
  };
};

/**
 * Materialize via the badges module + seed the focus.md contract surface
 * via the focus module. Both are "bootstrap on workspace open" work, and
 * both are tolerant of their module not being registered (tests can wire
 * only the workspace module; production createCore always has all five).
 *
 * Why focus.init lives here: an agent following the CLAUDE.md hint and
 * reading .bh/focus.md on a brand-new workspace used to get ENOENT before
 * any UI click ever happened. Seeding the empty template on every open
 * means the contract surface always exists.
 */
async function materializeWithFallback(ctx: Context, workspaceRoot: string): Promise<void> {
  // If the workspace folder vanished between add/use (e.g. user moved it
  // in Finder), short-circuit materialization. The renderer probes
  // reachability separately via workspace.listFiles and renders the
  // "Workspace folder not found" UI from there — bubbling a hard ENOENT
  // from use() would leave the renderer thinking the switch failed
  // outright and never flipping currentReachable to false in-session.
  const rootStat = await ctx.fs.stat(workspaceRoot);
  if (!rootStat) return;

  try {
    await materializeWorkspace(ctx.fs, ctx.run, workspaceRoot);
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    if (err instanceof Error && err.name === 'PathEscape') return;
    throw err;
  }
  try {
    await ctx.run('focus.init', {});
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    // A planted symlink at .bh/focus.md escapes — skip seeding rather than
    // abort the whole workspace open (the hostile surface is neutralized).
    if (err instanceof Error && err.name === 'PathEscape') return;
    throw err;
  }
  try {
    await ctx.run('inbound.init', {});
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    if (err instanceof Error && err.name === 'PathEscape') return;
    throw err;
  }
}
