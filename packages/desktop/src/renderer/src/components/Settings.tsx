/**
 * Settings overlay — the app-level preferences surface, on the conventional
 * ⌘, (app menu ▸ Settings…, or the command palette). A centered modal in the
 * Dialog family's visual language, but with its own host: dialogs are
 * transient questions, Settings is a browsable surface that will grow.
 *
 * Settings holds VALUES ONLY (the VS Code discipline): the update POLICY (the
 * "check automatically" toggle), window zoom, the registry settings, and About.
 * It deliberately does NOT host the update STATE or its verbs — checking,
 * downloading, "Restart to update" live in the title-bar UpdateChip + the app
 * menu's "Check for Updates…", because state and actions are not settings.
 *
 * Two kinds of rows render through the SAME primitives (components/settings):
 *  - APP-SHELL prefs (hand-laid): auto-update policy + window zoom + About.
 *    Main-process owned (main polls before any window exists; zoom is the View
 *    menu's authoritative level), so they can't be descriptor-driven.
 *  - REGISTRY settings (data-driven): everything in the core settings registry,
 *    rendered by <RegistrySettings/> from settings.describe() — adding a setting
 *    is one registry entry in core, no UI change here.
 */

import { type CSSProperties, type JSX, useEffect, useRef, useState } from 'react';
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
  const [autoDownloadUpdate, setAutoDownloadUpdate] = useState(false);
  const [version, setVersion] = useState('');
  const [zoomFactor, setZoomFactor] = useState(() => window.bh.getZoomFactor());

  useEffect(() => {
    void window.bh.getPrefs().then((p) => {
      setAutoUpdateCheck(p.autoUpdateCheck);
      setAutoDownloadUpdate(p.autoDownloadUpdate);
    });
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

  const toggleAutoDownload = (next: boolean): void => {
    setAutoDownloadUpdate(next); // optimistic — main echoes the merged truth back
    window.bh
      .setPrefs({ autoDownloadUpdate: next })
      .then((p) => setAutoDownloadUpdate(p.autoDownloadUpdate))
      .catch(() => setAutoDownloadUpdate(!next));
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

      {/* App-shell prefs — main-process owned, not registry settings. The update
          POLICY (auto-check) is a value and lives here; the update STATE/verbs do
          not (they're in the title-bar chip + the "Check for Updates…" menu). */}
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
        label="Download updates automatically"
        description="When a new version is found, download it in the background and show “Restart to update” — instead of waiting for you to start it. Installing still asks first."
        control={
          <Toggle
            checked={autoDownloadUpdate}
            onChange={toggleAutoDownload}
            label="Download updates automatically"
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
    </div>
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
