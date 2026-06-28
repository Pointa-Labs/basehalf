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
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { color, font, motion, radius, shadow, space } from '../../../browser/style/design.js';
import { Button } from '../../../browser/ui/primitives/Button.js';
import { GithubAccount } from './GithubAccount.js';
import { RegistrySettings } from './RegistrySettings.js';
import { SettingRow, Toggle, matchesSettingQuery, sectionLabelStyle } from './primitives.js';

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
  const [zoomFactor, setZoomFactor] = useState(() => nativeHostService.getZoomFactor());
  const [filter, setFilter] = useState('');
  const autoUpdateSeq = useRef(0);
  const autoDownloadSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void nativeHostService.getPrefs().then((p) => {
      if (cancelled) return;
      setAutoUpdateCheck(p.autoUpdateCheck);
      setAutoDownloadUpdate(p.autoDownloadUpdate);
    });
    void nativeHostService.appVersion().then((nextVersion) => {
      if (!cancelled) setVersion(nextVersion);
    });
    const disposeZoom = nativeHostService.onZoomFactor((nextZoom) => {
      if (!cancelled) setZoomFactor(nextZoom);
    });
    return () => {
      cancelled = true;
      disposeZoom();
    };
  }, []);

  const toggleAutoUpdate = (next: boolean): void => {
    const seq = ++autoUpdateSeq.current;
    setAutoUpdateCheck(next); // optimistic — main echoes the merged truth back
    nativeHostService
      .setPrefs({ autoUpdateCheck: next })
      .then((p) => {
        if (seq === autoUpdateSeq.current) setAutoUpdateCheck(p.autoUpdateCheck);
      })
      .catch(() => {
        if (seq === autoUpdateSeq.current) setAutoUpdateCheck(!next);
      });
  };

  const toggleAutoDownload = (next: boolean): void => {
    const seq = ++autoDownloadSeq.current;
    setAutoDownloadUpdate(next); // optimistic — main echoes the merged truth back
    nativeHostService
      .setPrefs({ autoDownloadUpdate: next })
      .then((p) => {
        if (seq === autoDownloadSeq.current) setAutoDownloadUpdate(p.autoDownloadUpdate);
      })
      .catch(() => {
        if (seq === autoDownloadSeq.current) setAutoDownloadUpdate(!next);
      });
  };

  // The hand-laid app-shell rows as data, so the search box can filter them the
  // same way it filters the registry rows. Controls reference the live state /
  // handlers above (unchanged — only the layout/filtering is new).
  interface AppRow {
    group: 'General' | 'About';
    label: string;
    description: string;
    control: JSX.Element;
  }
  const appRows: AppRow[] = [
    {
      group: 'General',
      label: 'Check for updates automatically',
      description:
        'Looks for new versions in the background. Nothing downloads or installs without asking.',
      control: (
        <Toggle
          checked={autoUpdateCheck}
          onChange={toggleAutoUpdate}
          label="Check for updates automatically"
        />
      ),
    },
    {
      group: 'General',
      label: 'Download updates automatically',
      description:
        'When a new version is found, download it in the background and show “Restart to update” — instead of waiting for you to start it. Installing still asks first.',
      control: (
        <Toggle
          checked={autoDownloadUpdate}
          onChange={toggleAutoDownload}
          label="Download updates automatically"
        />
      ),
    },
    {
      group: 'General',
      label: 'Window zoom',
      description: 'Also on ⌘+ / ⌘− anywhere; ⌘0 resets.',
      control: (
        <>
          <Button
            size="sm"
            aria-label="Zoom out"
            onClick={() => void nativeHostService.zoomWindow('out')}
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
          <Button
            size="sm"
            aria-label="Zoom in"
            onClick={() => void nativeHostService.zoomWindow('in')}
          >
            +
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={Math.round(zoomFactor * 100) === 100}
            onClick={() => void nativeHostService.zoomWindow('reset')}
          >
            Reset
          </Button>
        </>
      ),
    },
    {
      group: 'About',
      label: 'BaseHalf',
      description: version !== '' ? `Version ${version}` : '',
      control: (
        <Button size="sm" onClick={() => void nativeHostService.openExternal(RELEASES_URL)}>
          Releases ↗
        </Button>
      ),
    },
  ];
  const q = filter.trim().toLowerCase();
  const showRow = (r: AppRow): boolean => matchesSettingQuery(q, [r.label, r.description]);
  const generalRows = appRows.filter((r) => r.group === 'General' && showRow(r));
  const aboutRows = appRows.filter((r) => r.group === 'About' && showRow(r));

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

      {/* VS Code's Settings search — filters the rows below by title / description. */}
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search settings"
        aria-label="Search settings"
        data-testid="settings-search"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          height: 30,
          margin: `${space[3]}px 0 ${space[1]}px`,
          background: color.bg,
          border: `1px solid ${color.border}`,
          borderRadius: radius.md,
          color: color.textPrimary,
          fontFamily: font.sans,
          fontSize: font.size.ui,
          padding: `0 ${space[3]}px`,
          outline: 'none',
        }}
      />

      {/* App-shell prefs — main-process owned, not registry settings. The update
          POLICY (auto-check) is a value and lives here; the update STATE/verbs do
          not (they're in the title-bar chip + the "Check for Updates…" menu). */}
      {generalRows.length > 0 && <div style={sectionLabelStyle}>General</div>}
      {generalRows.map((r) => (
        <SettingRow key={r.label} label={r.label} description={r.description} control={r.control} />
      ))}

      {/* Registry settings — data-driven from settings.describe(). */}
      <RegistrySettings filter={filter} />

      {/* GitHub account — sign in to view Pull Requests in-app. Respects the search. */}
      {matchesSettingQuery(q, [
        'GitHub',
        'pull requests',
        'reviews',
        'account',
        'sign in',
        'token',
        'personal access token',
        'PAT',
      ]) && <GithubAccount />}

      {aboutRows.length > 0 && <div style={sectionLabelStyle}>About</div>}
      {aboutRows.map((r) => (
        <SettingRow key={r.label} label={r.label} description={r.description} control={r.control} />
      ))}
    </div>
  );
};

export const SettingsHost = (): JSX.Element | null => {
  const open = useSettingsStore((s) => s.open);
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const search = container.querySelector<HTMLElement>('[data-testid="settings-search"]');
      const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (search ?? firstFocusable)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const restore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [open]);

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
