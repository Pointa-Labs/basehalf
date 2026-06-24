/**
 * Settings overlay — the app-level preferences surface, on the conventional
 * ⌘, (app menu ▸ Settings…, or the command palette). A centered modal in the
 * Dialog family's visual language, but with its own host: dialogs are
 * transient questions, Settings is a browsable surface that will grow.
 *
 * Two kinds of rows live here, through the SAME primitives (components/settings):
 *  - APP-SHELL prefs (hand-laid): the background update check + window zoom +
 *    About/Updates. These are main-process owned (main polls before any window
 *    exists; zoom is the View menu's authoritative level) — not registry
 *    settings, so they can't be descriptor-driven.
 *  - REGISTRY settings (data-driven): everything in the core settings registry,
 *    rendered by <RegistrySettings/> from settings.describe(). Adding a setting
 *    is one registry entry in core — no UI change here.
 */

import { type CSSProperties, type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { color, font, motion, radius, shadow, space } from '../design.js';
import { Button } from './primitives/Button.js';
import { RegistrySettings } from './settings/RegistrySettings.js';
import { SettingRow, Toggle, sectionLabelStyle } from './settings/primitives.js';

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

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

      {/* App-shell prefs — main-process owned, not registry settings. */}
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

      {/* Registry settings — data-driven from settings.describe(). */}
      <RegistrySettings />

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
