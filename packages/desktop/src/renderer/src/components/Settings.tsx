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

import { type CSSProperties, type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
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
  control,
}: {
  label: string;
  description?: string;
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
            color: color.textTertiary,
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
