/**
 * "What's new" — a one-shot panel shown the first time the app launches after a
 * self-update. Main persists the release notes at install time (updater.ts) and
 * hands them over exactly once via `update:just-installed` (the on-disk record is
 * cleared on read), so this only ever appears right after an update, never on a
 * normal launch or a fresh DMG install. Purely informational: it shows the
 * changelog for the version you just got, nothing actionable.
 */

import { type CSSProperties, type JSX, useEffect, useState } from 'react';
import { updateService } from '../../../../platform/update/browser/updateService.js';
import { color, font, motion, radius, shadow, space } from '../../style/design.js';
import { Button } from '../../ui/primitives/Button.js';

interface JustInstalled {
  version: string;
  notes: string;
}

/** Narrow the `unknown` IPC payload; null unless it's a real record with notes. */
function asJustInstalled(v: unknown): JustInstalled | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.version === 'string' && typeof r.notes === 'string' && r.notes.length > 0) {
    return { version: r.version, notes: r.notes };
  }
  return null;
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
  width: 460,
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 96px)',
  display: 'flex',
  flexDirection: 'column',
  padding: `${space[5]}px ${space[5]}px ${space[4]}px`,
  fontFamily: font.sans,
  color: color.textPrimary,
  animation: `bh-dialog-in ${motion.normal}`,
};

export const WhatsNewHost = (): JSX.Element | null => {
  const [info, setInfo] = useState<JustInstalled | null>(null);

  // Ask main once at startup whether we just self-updated. The record is cleared
  // on read, so this never re-fires for the same update.
  useEffect(() => {
    let cancelled = false;
    void updateService
      .justInstalled()
      .then((v) => {
        if (!cancelled) setInfo(asJustInstalled(v));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Esc closes (matches the Settings / Dialog surfaces).
  useEffect(() => {
    if (!info) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setInfo(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [info]);

  if (!info) return null;
  return (
    <div
      style={backdropStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bh-whatsnew-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setInfo(null);
      }}
    >
      <div style={cardStyle}>
        <div
          id="bh-whatsnew-title"
          style={{
            fontSize: font.size.display,
            fontWeight: font.weight.semibold,
            letterSpacing: -0.2,
            flexShrink: 0,
          }}
        >
          What’s new in {info.version}
        </div>
        {/* Plain text with preserved line breaks — notes are author-written prose,
            rendered as text (never HTML) so there's no injection surface. */}
        <div
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: font.size.body,
            color: color.textSecondary,
            lineHeight: 1.55,
            marginTop: space[3],
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {info.notes}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: space[4],
            flexShrink: 0,
          }}
        >
          <Button variant="primary" onClick={() => setInfo(null)}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
};
