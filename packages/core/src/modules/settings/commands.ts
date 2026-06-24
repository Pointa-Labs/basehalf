/**
 * The settings command surface — generic over the registry. `inspect` mirrors
 * VS Code's per-layer `inspect()`; `get` is the merged effective value. Writes
 * split by layer: `setGlobal` (any setting) vs `setWorkspace` / `clearWorkspace`
 * (only `scope: 'workspace'` settings, enforced — the small analogue of VS
 * Code refusing an APPLICATION-scoped setting in workspace settings).
 *
 * Read commands tolerate an unbound workspace (`ctx.workspaceRoot === null`):
 * the workspace layer is simply absent. Per-workspace WRITES require a bound
 * root (the sender window's workspace, injected by the desktop's `bh:run`).
 */

import { type Handler, createKeyedMutex, requireWorkspaceRoot } from '../../kernel/index.js';
import {
  SETTINGS,
  type SettingDescriptor,
  type SettingValue,
  getDescriptor,
  isValidValue,
} from './registry.js';
import { readSettings, writeSettings } from './store.js';
import {
  InvalidSettingValue,
  type SettingInspect,
  type SettingsClearWorkspaceArgs,
  type SettingsClearWorkspaceResult,
  type SettingsDescribeArgs,
  type SettingsDescribeResult,
  type SettingsFile,
  type SettingsGetArgs,
  type SettingsGetResult,
  type SettingsInspectArgs,
  type SettingsInspectResult,
  type SettingsSetGlobalArgs,
  type SettingsSetGlobalResult,
  type SettingsSetWorkspaceArgs,
  type SettingsSetWorkspaceResult,
  UnknownSetting,
} from './types.js';

// Serialize every read-modify-write on the single settings.json per config dir
// so a global write and a workspace write can't lose each other's update.
const withSettingsLock = createKeyedMutex();

/** Workspace identity = path, compared case-insensitively (matches the
 *  workspaces registry's `samePath`). Lowercase for the storage key, and strip a
 *  trailing slash so `/work` and `/work/` map to one key — the host injects the
 *  registry's resolve()d root (no trailing slash), so this is defensive against a
 *  caller ever passing one. */
function workspaceKey(root: string): string {
  const stripped = root.replace(/\/+$/, '');
  return (stripped === '' ? root : stripped).toLowerCase();
}

function descriptorOrThrow(key: string): SettingDescriptor {
  const d = getDescriptor(key);
  if (!d) throw new UnknownSetting(key);
  return d;
}

/** Build the per-layer view + merged effective value for one setting. A stored
 *  value that fails its type check is ignored (falls through to the next layer)
 *  rather than poisoning the result. */
function inspectOne(d: SettingDescriptor, file: SettingsFile, root: string | null): SettingInspect {
  const globalRaw = file.global[d.key];
  const globalValue = isValidValue(d, globalRaw) ? globalRaw : undefined;

  let workspaceValue: SettingValue | undefined;
  if (d.scope === 'workspace' && root !== null) {
    const wsRaw = file.workspaces[workspaceKey(root)]?.[d.key];
    workspaceValue = isValidValue(d, wsRaw) ? wsRaw : undefined;
  }

  // `??` (not `||`) and the explicit `!== undefined` spreads above are mandatory:
  // a layer can legitimately hold a falsy value (e.g. `false`), which `||` would
  // wrongly skip. Keep this when widening SettingType to falsy defaults (0, '').
  const value = workspaceValue ?? globalValue ?? d.default;
  return {
    key: d.key,
    scope: d.scope,
    type: d.type,
    defaultValue: d.default,
    ...(globalValue !== undefined && { globalValue }),
    ...(workspaceValue !== undefined && { workspaceValue }),
    value,
  };
}

export const describe: Handler<SettingsDescribeArgs, SettingsDescribeResult> = async () => SETTINGS;

export const inspect: Handler<SettingsInspectArgs, SettingsInspectResult> = async (args, ctx) => {
  const d = descriptorOrThrow(args.key);
  const file = await readSettings(ctx.fs, ctx.configDir);
  return inspectOne(d, file, ctx.workspaceRoot);
};

export const get: Handler<SettingsGetArgs, SettingsGetResult> = async (args, ctx) => {
  const d = descriptorOrThrow(args.key);
  const file = await readSettings(ctx.fs, ctx.configDir);
  return inspectOne(d, file, ctx.workspaceRoot).value;
};

export const setGlobal: Handler<SettingsSetGlobalArgs, SettingsSetGlobalResult> = async (
  args,
  ctx,
) => {
  const d = descriptorOrThrow(args.key);
  if (!isValidValue(d, args.value)) {
    throw new InvalidSettingValue(`Setting "${d.key}" expects a ${d.type}`);
  }
  return withSettingsLock(ctx.configDir, async () => {
    const file = await readSettings(ctx.fs, ctx.configDir);
    const next: SettingsFile = {
      version: 1,
      global: { ...file.global, [d.key]: args.value },
      workspaces: file.workspaces,
    };
    await writeSettings(ctx.fs, ctx.configDir, next);
    return inspectOne(d, next, ctx.workspaceRoot);
  });
};

export const setWorkspace: Handler<SettingsSetWorkspaceArgs, SettingsSetWorkspaceResult> = async (
  args,
  ctx,
) => {
  const d = descriptorOrThrow(args.key);
  if (d.scope !== 'workspace') {
    throw new InvalidSettingValue(
      `Setting "${d.key}" is global-only and cannot be overridden per workspace`,
    );
  }
  if (!isValidValue(d, args.value)) {
    throw new InvalidSettingValue(`Setting "${d.key}" expects a ${d.type}`);
  }
  const root = requireWorkspaceRoot(ctx);
  const wsKey = workspaceKey(root);
  return withSettingsLock(ctx.configDir, async () => {
    const file = await readSettings(ctx.fs, ctx.configDir);
    const next: SettingsFile = {
      version: 1,
      global: file.global,
      workspaces: {
        ...file.workspaces,
        [wsKey]: { ...file.workspaces[wsKey], [d.key]: args.value },
      },
    };
    await writeSettings(ctx.fs, ctx.configDir, next);
    return inspectOne(d, next, root);
  });
};

export const clearWorkspace: Handler<
  SettingsClearWorkspaceArgs,
  SettingsClearWorkspaceResult
> = async (args, ctx) => {
  const d = descriptorOrThrow(args.key);
  if (d.scope !== 'workspace') {
    // Symmetric with setWorkspace: a global-only setting has no workspace layer
    // to clear, so reject rather than silently no-op.
    throw new InvalidSettingValue(
      `Setting "${d.key}" is global-only and has no per-workspace override`,
    );
  }
  const root = requireWorkspaceRoot(ctx);
  const wsKey = workspaceKey(root);
  return withSettingsLock(ctx.configDir, async () => {
    const file = await readSettings(ctx.fs, ctx.configDir);
    const wsMap = file.workspaces[wsKey];
    if (wsMap && d.key in wsMap) {
      // Drop this key; prune the workspace entry if it becomes empty (keep
      // the file sparse — no empty `{}` overrides accumulating).
      const rest: Record<string, SettingValue> = {};
      for (const [k, v] of Object.entries(wsMap)) {
        if (k !== d.key) rest[k] = v;
      }
      const workspaces = { ...file.workspaces };
      if (Object.keys(rest).length === 0) delete workspaces[wsKey];
      else workspaces[wsKey] = rest;
      const next: SettingsFile = { version: 1, global: file.global, workspaces };
      await writeSettings(ctx.fs, ctx.configDir, next);
      return inspectOne(d, next, root);
    }
    return inspectOne(d, file, root);
  });
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['settings.describe', describe as unknown as Handler<never, unknown>],
    ['settings.inspect', inspect as unknown as Handler<never, unknown>],
    ['settings.get', get as unknown as Handler<never, unknown>],
    ['settings.setGlobal', setGlobal as unknown as Handler<never, unknown>],
    ['settings.setWorkspace', setWorkspace as unknown as Handler<never, unknown>],
    ['settings.clearWorkspace', clearWorkspace as unknown as Handler<never, unknown>],
  ];
}
