/**
 * Settings overlay — the app-level preferences surface, on the conventional
 * ⌘, (app menu ▸ Settings…, or the command palette). A centered modal in the
 * Dialog family's visual language, but with its own host: dialogs are
 * transient questions, Settings is a browsable surface that will grow
 * (updates land here next).
 *
 * Only settings that actually exist live here: the background update check
 * (main-process pref — main polls before any window exists) and window zoom
 * (the View menu's authoritative level, mirrored so the row and ⌘+/− never
 * disagree). About shows the installed version — the anchor for "is this the
 * latest?" once the update check arrives.
 */

import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { create } from 'zustand';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
import { READING_MODE_KEY, useReadingMode } from '../lib/readingMode.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { Button } from './primitives/Button.js';

const RELEASES_URL = 'https://github.com/Pointa-Labs/basehalf/releases';

interface SettingsStore {
  open: boolean;
}

const useSettingsStore = create<SettingsStore>(() => ({ open: false }));

export function openSettings(): void {
  useSettingsStore.setState({ open: true });
}

function closeSettings(): void {
  useSettingsStore.setState({ open: false });
}

// ---- Self-update mirror -----------------------------------------------------
// Main owns the real state machine (main/updater.ts); this store mirrors its
// pushes so the Updates row reflects background activity even if it started
// before Settings was ever opened.

export type UpdateUiState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'upToDate'; version: string }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; received: number; total: number }
  | { phase: 'staged'; version: string }
  | { phase: 'error'; message: string };

/** Narrow main's `unknown` push into the UI union; anything unrecognized
 *  degrades to idle rather than crashing the row. */
function asUpdateUiState(raw: unknown): UpdateUiState {
  if (typeof raw !== 'object' || raw === null) return { phase: 'idle' };
  const r = raw as Record<string, unknown>;
  switch (r.phase) {
    case 'checking':
      return { phase: 'checking' };
    case 'upToDate':
      return typeof r.version === 'string'
        ? { phase: 'upToDate', version: r.version }
        : { phase: 'idle' };
    case 'available':
      return typeof r.version === 'string'
        ? { phase: 'available', version: r.version }
        : { phase: 'idle' };
    case 'downloading':
      return typeof r.version === 'string' &&
        typeof r.received === 'number' &&
        typeof r.total === 'number'
        ? { phase: 'downloading', version: r.version, received: r.received, total: r.total }
        : { phase: 'idle' };
    case 'staged':
      return typeof r.version === 'string'
        ? { phase: 'staged', version: r.version }
        : { phase: 'idle' };
    case 'error':
      return typeof r.message === 'string'
        ? { phase: 'error', message: r.message }
        : { phase: 'idle' };
    default:
      return { phase: 'idle' };
  }
}

const useUpdateStore = create<{ state: UpdateUiState }>(() => ({
  state: { phase: 'idle' },
}));

let updateBridgeWired = false;

/** Idempotent: sync the mirror once and subscribe to pushes. App calls this at
 *  startup so background-check results are never missed. */
export function wireUpdateBridge(): void {
  if (updateBridgeWired) return;
  updateBridgeWired = true;
  void window.bh
    .updateGetState()
    .then((s) => useUpdateStore.setState({ state: asUpdateUiState(s) }));
  window.bh.onUpdateState((s) => useUpdateStore.setState({ state: asUpdateUiState(s) }));
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: color.backdrop,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  animation: `bh-fade-in ${motion.fast}`,
};

const cardStyle: CSSProperties = {
  background: color.surface,
  borderRadius: radius.xl,
  boxShadow: shadow.floating,
  width: 520,
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 96px)',
  overflowY: 'auto',
  padding: `${space[5]}px ${space[5]}px ${space[5]}px`,
  fontFamily: font.sans,
  color: color.textPrimary,
  animation: `bh-dialog-in ${motion.normal}`,
};

const sectionLabelStyle: CSSProperties = {
  fontSize: font.size.micro,
  fontWeight: font.weight.medium,
  letterSpacing: font.trackedCaps,
  textTransform: 'uppercase',
  color: color.textTertiary,
  marginTop: space[5],
  marginBottom: space[1],
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** One setting: label + explanation on the left, its control on the right.
 *  Every section row goes through here so the grid stays aligned as rows
 *  accumulate. */
const SettingRow = ({
  label,
  description,
  descriptionColor,
  control,
}: {
  label: string;
  description?: string;
  /** Override for state-carrying descriptions (e.g. errors in danger red). */
  descriptionColor?: string;
  control: ReactNode;
}): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: space[4],
      padding: `${space[3]}px 0`,
      borderBottom: `1px solid ${color.divider}`,
    }}
  >
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: font.size.body, color: color.textPrimary }}>{label}</div>
      {description && (
        <div
          style={{
            fontSize: font.size.caption,
            color: descriptionColor ?? color.textTertiary,
            marginTop: space[0.5],
            lineHeight: 1.45,
          }}
        >
          {description}
        </div>
      )}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: space[1.5], flexShrink: 0 }}>
      {control}
    </div>
  </div>
);

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}): JSX.Element => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    style={{
      width: 36,
      height: 20,
      borderRadius: radius.pill,
      border: `1px solid ${checked ? color.accent : color.borderStrong}`,
      background: checked ? color.accent : color.surfaceMuted,
      position: 'relative',
      cursor: 'pointer',
      padding: 0,
      outline: 'none',
      flexShrink: 0,
      transition: transition(['background', 'border-color']),
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: 2,
        left: checked ? 18 : 2,
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transition: transition(['left']),
      }}
    />
  </button>
);

/** A small segmented (single-choice) control — used for the per-workspace
 *  override's tri-state (follow default / on / off). */
const Segmented = ({
  value,
  options,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}): JSX.Element => (
  <div
    style={{
      display: 'inline-flex',
      border: `1px solid ${color.borderStrong}`,
      borderRadius: radius.md,
      overflow: 'hidden',
    }}
  >
    {options.map((o, i) => {
      const selected = o.value === value;
      return (
        <button
          key={o.value}
          type="button"
          aria-pressed={selected}
          onClick={() => onChange(o.value)}
          style={{
            border: 'none',
            borderLeft: i === 0 ? 'none' : `1px solid ${color.borderStrong}`,
            background: selected ? color.accent : color.surfaceMuted,
            color: selected ? '#fff' : color.textSecondary,
            cursor: 'pointer',
            padding: `4px ${space[2]}px`,
            fontFamily: font.sans,
            fontSize: font.size.ui,
          }}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

/** Per-layer view of one setting (the subset the UI reads from
 *  `settings.inspect`). */
interface SettingInspectView {
  defaultValue: boolean;
  globalValue?: boolean;
  workspaceValue?: boolean;
  value: boolean;
}

type WsOverride = 'default' | 'on' | 'off';

/**
 * The Reading section — Reading mode (the ADHD reading aids) wired to the core
 * settings module's two-layer model: a GLOBAL DEFAULT toggle plus, when a folder
 * is open in this window, a per-workspace OVERRIDE (follow default / on / off).
 * The first consumer of the settings scaffold — adding the next setting is a
 * registry entry + a row like this, no new IPC.
 */
const ReadingSection = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const [view, setView] = useState<SettingInspectView | null>(null);

  const reload = useCallback(async () => {
    try {
      const got = (await window.bh.run('settings.inspect', {
        key: READING_MODE_KEY,
      })) as SettingInspectView;
      setView(got);
    } catch {
      setView(null);
    }
  }, []);

  // Re-read on open and whenever the bound workspace changes (its override may
  // differ). `current` keys the workspace layer the inspect resolves against.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the intentional re-run trigger (re-inspect when the bound workspace changes); the body reads nothing off it.
  useEffect(() => {
    void reload();
  }, [reload, current]);

  // Every write returns the fresh inspect — apply it, then nudge the shared
  // reading-mode mirror so open editors update without waiting for a reload.
  const applied = useCallback((got: SettingInspectView): void => {
    setView(got);
    useReadingMode.getState().setOptimistic(got.value);
    void useReadingMode.getState().refresh();
  }, []);

  const setGlobal = useCallback(
    (next: boolean): void => {
      window.bh
        .run('settings.setGlobal', { key: READING_MODE_KEY, value: next })
        .then((g) => applied(g as SettingInspectView))
        .catch(() => void reload());
    },
    [applied, reload],
  );

  const setOverride = useCallback(
    (mode: WsOverride): void => {
      const call =
        mode === 'default'
          ? window.bh.run('settings.clearWorkspace', { key: READING_MODE_KEY })
          : window.bh.run('settings.setWorkspace', {
              key: READING_MODE_KEY,
              value: mode === 'on',
            });
      call.then((g) => applied(g as SettingInspectView)).catch(() => void reload());
    },
    [applied, reload],
  );

  const globalOn = view ? (view.globalValue ?? view.defaultValue) : false;
  const override: WsOverride =
    view?.workspaceValue === undefined ? 'default' : view.workspaceValue ? 'on' : 'off';
  const effective = view?.value ?? false;

  return (
    <>
      <div style={sectionLabelStyle}>Reading</div>
      <SettingRow
        label="Reading mode"
        description="Show ADHD reading aids — keyword highlights and read/unread dimming — when viewing Markdown. This is the default for every folder."
        control={
          <Toggle checked={globalOn} onChange={setGlobal} label="Reading mode (global default)" />
        }
      />
      {current !== null && (
        <SettingRow
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

const SettingsCard = (): JSX.Element => {
  const [autoUpdateCheck, setAutoUpdateCheck] = useState(true);
  const [version, setVersion] = useState('');
  const [zoomFactor, setZoomFactor] = useState(() => window.bh.getZoomFactor());

  useEffect(() => {
    void window.bh.getPrefs().then((p) => setAutoUpdateCheck(p.autoUpdateCheck));
    void window.bh.appVersion().then(setVersion);
    return window.bh.onZoomFactor(setZoomFactor);
  }, []);

  const toggleAutoUpdate = (next: boolean): void => {
    setAutoUpdateCheck(next); // optimistic — main echoes the merged truth back
    window.bh
      .setPrefs({ autoUpdateCheck: next })
      .then((p) => setAutoUpdateCheck(p.autoUpdateCheck))
      .catch(() => setAutoUpdateCheck(!next));
  };

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          id="bh-settings-title"
          style={{
            fontSize: font.size.display,
            fontWeight: font.weight.semibold,
            letterSpacing: -0.2,
          }}
        >
          Settings
        </div>
        <Button variant="ghost" size="sm" aria-label="Close settings" onClick={closeSettings}>
          ✕
        </Button>
      </div>

      <div style={sectionLabelStyle}>General</div>
      <SettingRow
        label="Check for updates automatically"
        description="Looks for new versions in the background. Nothing downloads or installs without asking."
        control={
          <Toggle
            checked={autoUpdateCheck}
            onChange={toggleAutoUpdate}
            label="Check for updates automatically"
          />
        }
      />
      <SettingRow
        label="Window zoom"
        description="Also on ⌘+ / ⌘− anywhere; ⌘0 resets."
        control={
          <>
            <Button
              size="sm"
              aria-label="Zoom out"
              onClick={() => void window.bh.zoomWindow('out')}
            >
              −
            </Button>
            <span
              style={{
                fontSize: font.size.ui,
                fontFamily: font.mono,
                color: color.textSecondary,
                minWidth: 44,
                textAlign: 'center',
              }}
            >
              {Math.round(zoomFactor * 100)}%
            </span>
            <Button size="sm" aria-label="Zoom in" onClick={() => void window.bh.zoomWindow('in')}>
              +
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={Math.round(zoomFactor * 100) === 100}
              onClick={() => void window.bh.zoomWindow('reset')}
            >
              Reset
            </Button>
          </>
        }
      />

      <ReadingSection />

      <div style={sectionLabelStyle}>About</div>
      <SettingRow
        label="BaseHalf"
        {...(version !== '' && { description: `Version ${version}` })}
        control={
          <Button size="sm" onClick={() => void window.bh.openExternal(RELEASES_URL)}>
            Releases ↗
          </Button>
        }
      />
      <UpdatesRow />
    </div>
  );
};

/** The Updates row: one button whose label/action tracks main's update state
 *  machine, with the row description carrying the detail (progress, errors,
 *  "you're current"). */
const UpdatesRow = (): JSX.Element => {
  const state = useUpdateStore((s) => s.state);

  let description = 'Get new versions as they ship.';
  let descriptionColor: string | undefined;
  let button: ReactNode;
  switch (state.phase) {
    case 'checking':
      button = (
        <Button size="sm" disabled>
          Checking…
        </Button>
      );
      break;
    case 'upToDate':
      description = `You're on the latest version (${state.version}).`;
      button = (
        <Button size="sm" onClick={() => void window.bh.updateCheck()}>
          Check for Updates
        </Button>
      );
      break;
    case 'available':
      description = `Version ${state.version} is available.`;
      button = (
        <Button size="sm" variant="primary" onClick={() => void window.bh.updateDownload()}>
          Download {state.version}
        </Button>
      );
      break;
    case 'downloading': {
      const pct = state.total > 0 ? Math.floor((state.received / state.total) * 100) : 0;
      const mb = (n: number): string => (n / (1024 * 1024)).toFixed(0);
      description = `Downloading ${state.version} — ${mb(state.received)} of ${mb(state.total)} MB.`;
      button = (
        <Button size="sm" disabled>
          {pct}%
        </Button>
      );
      break;
    }
    case 'staged':
      description = `Version ${state.version} is downloaded and verified — restart to finish.`;
      button = (
        <Button size="sm" variant="primary" onClick={() => void window.bh.updateInstall()}>
          Restart to Update
        </Button>
      );
      break;
    case 'error':
      description = state.message;
      descriptionColor = color.danger;
      button = (
        <Button size="sm" onClick={() => void window.bh.updateCheck()}>
          Try Again
        </Button>
      );
      break;
    default:
      button = (
        <Button size="sm" onClick={() => void window.bh.updateCheck()}>
          Check for Updates
        </Button>
      );
  }

  return (
    <SettingRow
      label="Updates"
      description={description}
      {...(descriptionColor !== undefined && { descriptionColor })}
      control={button}
    />
  );
};

export const SettingsHost = (): JSX.Element | null => {
  const open = useSettingsStore((s) => s.open);
  const containerRef = useRef<HTMLDivElement>(null);

  // Esc closes; Tab/Shift+Tab cycle inside the overlay (same trap as Dialog —
  // without it, Tab walks off into the chrome behind the backdrop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSettings();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={containerRef}
      style={backdropStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeSettings();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bh-settings-title"
    >
      <SettingsCard />
    </div>
  );
};
