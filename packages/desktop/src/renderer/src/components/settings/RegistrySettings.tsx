/**
 * Registry-driven settings rows — the data-driven heart of the Settings surface.
 *
 * Instead of hand-coding a section per setting, this reads `settings.describe()`
 * (the core registry, introspectable) and renders every descriptor through a
 * renderer-per-type switch. Adding a setting is now ONE registry entry in core
 * with NO UI change — the promise the settings scaffold was built to keep.
 *
 * Each descriptor carries its own two-layer controls: a GLOBAL DEFAULT plus,
 * for `scope: 'workspace'` settings when a folder is open, a per-workspace
 * OVERRIDE (follow default / on / off) resolved from `settings.inspect`.
 */

import type { SettingDescriptor, SettingInspect } from '@basehalf/core';
import { type JSX, useCallback, useEffect, useState } from 'react';
import { READING_MODE_KEY, useReadingMode } from '../../lib/readingMode.js';
import { useWorkspaceStore } from '../../store/workspace.js';
import { Segmented, SettingRow, Toggle, sectionLabelStyle } from './primitives.js';

type WsOverride = 'default' | 'on' | 'off';

/** Settings whose effective value is mirrored elsewhere in the renderer and so
 *  must be nudged when changed here (the editor reads reading mode live, off the
 *  shared store, not by re-inspecting). A no-op for every other setting.
 *  Generalize this map if more live-mirrored settings appear. */
const ON_CHANGE: Record<string, (next: SettingInspect) => void> = {
  [READING_MODE_KEY]: (next) => {
    useReadingMode.getState().setOptimistic(next.value === true);
    void useReadingMode.getState().refresh();
  },
};

/** Section label from a key's namespace prefix (`editor.readingMode` → "Editor").
 *  Forward-compatible with a future explicit `category` field on the descriptor. */
function sectionLabelFor(key: string): string {
  const ns = key.includes('.') ? key.slice(0, key.indexOf('.')) : key;
  return ns.charAt(0).toUpperCase() + ns.slice(1);
}

/** A boolean setting: a global-default Toggle + (for workspace-scoped settings
 *  with a folder open) a per-workspace override tri-state. Generalized from the
 *  former hand-coded ReadingSection. */
const BooleanSettingRow = ({ descriptor }: { descriptor: SettingDescriptor }): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const [view, setView] = useState<SettingInspect | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setView((await window.bh.run('settings.inspect', { key: descriptor.key })) as SettingInspect);
    } catch {
      setView(null);
    }
  }, [descriptor.key]);

  // Re-read on open and whenever the bound workspace changes (its override may
  // differ). `current` keys the workspace layer the inspect resolves against.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the intentional re-run trigger (re-inspect when the bound workspace changes); the body reads nothing off it.
  useEffect(() => {
    void reload();
  }, [reload, current]);

  // Every write returns the fresh inspect — apply it, then run any side effect
  // (e.g. nudge the reading-mode mirror) so live consumers update immediately.
  const applied = useCallback(
    (next: SettingInspect): void => {
      setView(next);
      ON_CHANGE[descriptor.key]?.(next);
    },
    [descriptor.key],
  );

  const setGlobal = useCallback(
    (next: boolean): void => {
      window.bh
        .run('settings.setGlobal', { key: descriptor.key, value: next })
        .then((g) => applied(g as SettingInspect))
        .catch(() => void reload());
    },
    [applied, reload, descriptor.key],
  );

  const setOverride = useCallback(
    (mode: WsOverride): void => {
      const call =
        mode === 'default'
          ? window.bh.run('settings.clearWorkspace', { key: descriptor.key })
          : window.bh.run('settings.setWorkspace', { key: descriptor.key, value: mode === 'on' });
      call.then((g) => applied(g as SettingInspect)).catch(() => void reload());
    },
    [applied, reload, descriptor.key],
  );

  const globalOn = view
    ? (view.globalValue ?? view.defaultValue) === true
    : descriptor.default === true;
  const override: WsOverride =
    view?.workspaceValue === undefined ? 'default' : view.workspaceValue ? 'on' : 'off';
  const effective = view ? view.value === true : descriptor.default === true;
  const overridable = descriptor.scope === 'workspace';

  return (
    <>
      <SettingRow
        label={descriptor.label}
        description={
          overridable
            ? `${descriptor.description} This is the default for every folder.`
            : descriptor.description
        }
        control={
          <Toggle
            checked={globalOn}
            onChange={setGlobal}
            label={`${descriptor.label} (global default)`}
          />
        }
      />
      {overridable && current !== null && (
        <SettingRow
          inset
          label="This folder"
          description={`Override the default for the open folder. Currently ${effective ? 'on' : 'off'} here.`}
          control={
            <Segmented
              value={override}
              onChange={(v) => setOverride(v as WsOverride)}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
            />
          }
        />
      )}
    </>
  );
};

/** Render one descriptor by its declared value type. The exhaustiveness guard
 *  makes a new SettingType fail to compile until it has a renderer here. */
const SettingDescriptorRow = ({
  descriptor,
}: { descriptor: SettingDescriptor }): JSX.Element | null => {
  switch (descriptor.type) {
    case 'boolean':
      return <BooleanSettingRow descriptor={descriptor} />;
    default: {
      const _exhaustive: never = descriptor.type;
      return _exhaustive;
    }
  }
};

/** All registry settings, grouped by key namespace into labeled sections.
 *  `filter` (the Settings search query) hides non-matching rows + empty groups. */
export const RegistrySettings = ({ filter = '' }: { filter?: string }): JSX.Element | null => {
  const [descriptors, setDescriptors] = useState<readonly SettingDescriptor[] | null>(null);

  useEffect(() => {
    void window.bh
      .run('settings.describe', {})
      .then((d) => setDescriptors(d as readonly SettingDescriptor[]))
      .catch(() => setDescriptors([]));
  }, []);

  if (!descriptors || descriptors.length === 0) return null;

  const q = filter.trim().toLowerCase();
  const matches = (d: SettingDescriptor): boolean =>
    q === '' ||
    d.label.toLowerCase().includes(q) ||
    d.description.toLowerCase().includes(q) ||
    d.key.toLowerCase().includes(q);

  // Group by namespace prefix, preserving the registry's order within a group.
  const groups: Array<[string, SettingDescriptor[]]> = [];
  for (const d of descriptors) {
    if (!matches(d)) continue;
    const label = sectionLabelFor(d.key);
    const group = groups.find(([l]) => l === label);
    if (group) group[1].push(d);
    else groups.push([label, [d]]);
  }
  if (groups.length === 0) return null;

  return (
    <>
      {groups.map(([label, ds]) => (
        <div key={label}>
          <div style={sectionLabelStyle}>{label}</div>
          {ds.map((d) => (
            <SettingDescriptorRow key={d.key} descriptor={d} />
          ))}
        </div>
      ))}
    </>
  );
};
