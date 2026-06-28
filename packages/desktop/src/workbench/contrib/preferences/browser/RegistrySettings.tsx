/**
 * Registry-driven settings rows — the data-driven heart of the Settings surface.
 *
 * Instead of hand-coding a section per setting, this reads `settings.describe()`
 * (the platform configuration registry, introspectable) and renders every
 * descriptor through a renderer-per-type switch. Adding a setting is now ONE
 * registry entry with NO UI change — the promise the settings scaffold was built
 * to keep.
 *
 * Each descriptor carries its own two-layer controls: a GLOBAL DEFAULT plus,
 * for `scope: 'workspace'` settings when a folder is open, a per-workspace
 * OVERRIDE (follow default / on / off) resolved from `settings.inspect`.
 */

import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { settingsService } from '../../../../platform/configuration/browser/settingsService.js';
import type {
  SettingDescriptor,
  SettingInspect,
} from '../../../../platform/configuration/common/configuration.js';
import {
  READING_MODE_KEY,
  useReadingMode,
} from '../../../services/editor/browser/readingModeStore.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import {
  type SettingOverrideMode,
  booleanSettingViewModel,
  groupSettingDescriptors,
} from '../common/preferencesModel.js';
import { Segmented, SettingRow, Toggle, sectionLabelStyle } from './primitives.js';

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

/** A boolean setting: a global-default Toggle + (for workspace-scoped settings
 *  with a folder open) a per-workspace override tri-state. Generalized from the
 *  former hand-coded ReadingSection. */
const BooleanSettingRow = ({ descriptor }: { descriptor: SettingDescriptor }): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const [view, setView] = useState<SettingInspect | null>(null);
  const requestSeq = useRef(0);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const isCurrentRequest = useCallback(
    (seq: number): boolean => mounted.current && seq === requestSeq.current,
    [],
  );

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++requestSeq.current;
    try {
      const next = await settingsService.inspect(descriptor.key);
      if (isCurrentRequest(seq)) setView(next);
    } catch {
      if (isCurrentRequest(seq)) setView(null);
    }
  }, [descriptor.key, isCurrentRequest]);

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
      const seq = ++requestSeq.current;
      settingsService
        .setGlobal(descriptor.key, next)
        .then((inspect) => {
          if (isCurrentRequest(seq)) applied(inspect);
        })
        .catch(() => {
          if (isCurrentRequest(seq)) void reload();
        });
    },
    [applied, reload, descriptor.key, isCurrentRequest],
  );

  const setOverride = useCallback(
    (mode: SettingOverrideMode): void => {
      const seq = ++requestSeq.current;
      const call =
        mode === 'default'
          ? settingsService.clearWorkspace(descriptor.key)
          : settingsService.setWorkspace(descriptor.key, mode === 'on');
      call
        .then((inspect) => {
          if (isCurrentRequest(seq)) applied(inspect);
        })
        .catch(() => {
          if (isCurrentRequest(seq)) void reload();
        });
    },
    [applied, reload, descriptor.key, isCurrentRequest],
  );

  const model = booleanSettingViewModel(descriptor, view);

  return (
    <>
      <SettingRow
        label={descriptor.label}
        description={
          model.canOverride
            ? `${descriptor.description} This is the default for every folder.`
            : descriptor.description
        }
        control={
          <Toggle
            checked={model.globalOn}
            onChange={setGlobal}
            label={`${descriptor.label} (global default)`}
          />
        }
      />
      {model.canOverride && current !== null && (
        <SettingRow
          inset
          label="This folder"
          description={`Override the default for the open folder. Currently ${model.effective ? 'on' : 'off'} here.`}
          control={
            <Segmented
              value={model.override}
              onChange={(v) => setOverride(v as SettingOverrideMode)}
              label={`${descriptor.label} override for this folder`}
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
    let cancelled = false;
    void settingsService
      .describe()
      .then((next) => {
        if (!cancelled) setDescriptors(next);
      })
      .catch(() => {
        if (!cancelled) setDescriptors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!descriptors || descriptors.length === 0) return null;

  const groups = groupSettingDescriptors(descriptors, filter);
  if (groups.length === 0) return null;

  return (
    <>
      {groups.map(({ label, descriptors: ds }) => (
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
