import { type JSX, useEffect, useRef } from 'react';
import { color, font, motion, radius, shadow, space } from '../design.js';
import { FLOAT_PANE_ID, useWorkspaceStore } from '../store/workspace.js';
import { FilePreview } from './FilePreview.js';

const basenameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

const CARD_W = 560;
const CARD_H = 460;

/**
 * The canvas FLOATING preview — double-click a badge opens an editable peek that
 * floats over the canvas near the click. Light-dismiss: a click outside (incl. the
 * blank canvas) or Esc closes it, flushing its edits first. Distinct from the
 * right panel (its editor registers under the FLOAT_PANE_ID flush slot, so a
 * workspace switch also persists it).
 */
export const FloatingPreview = (): JSX.Element | null => {
  const floatingFile = useWorkspaceStore((s) => s.floatingFile);
  const anchor = useWorkspaceStore((s) => s.floatingAnchor);
  const closeFloat = useWorkspaceStore((s) => s.closeFloat);
  const cardRef = useRef<HTMLDivElement>(null);

  // Light-dismiss on a mousedown outside the card. Deferred a tick so the
  // double-click that opened it doesn't immediately close it.
  useEffect(() => {
    if (floatingFile === null) return;
    const onDown = (e: MouseEvent): void => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) closeFloat();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        const tag = (e.target as HTMLElement | null)?.tagName ?? '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        closeFloat();
      }
    };
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [floatingFile, closeFloat]);

  if (floatingFile === null || anchor === null) return null;

  // Anchor near the click, clamped to the viewport.
  const left = Math.min(Math.max(8, anchor.x), window.innerWidth - CARD_W - 8);
  const top = Math.min(Math.max(44, anchor.y), window.innerHeight - CARD_H - 8);

  return (
    <div
      ref={cardRef}
      data-testid="floating-preview"
      style={{
        position: 'fixed',
        left,
        top,
        width: CARD_W,
        height: CARD_H,
        zIndex: 60,
        background: color.surface,
        borderRadius: radius.xl,
        border: `1px solid ${color.border}`,
        boxShadow: shadow.floating,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: `bh-dialog-in ${motion.fast}`,
      }}
    >
      <header
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          padding: `${space[2]}px ${space[2]}px ${space[2]}px ${space[3]}px`,
          borderBottom: `1px solid ${color.border}`,
          background: color.surfaceMuted,
          fontFamily: font.sans,
        }}
        title={floatingFile}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color.accent,
            flexShrink: 0,
          }}
        />
        <strong
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: font.size.caption,
            fontWeight: font.weight.semibold,
            color: color.textPrimary,
          }}
        >
          {basenameOf(floatingFile)}
        </strong>
        <span style={{ fontSize: font.size.micro, color: color.textGhost }}>
          click outside to close
        </span>
        <button
          type="button"
          title="Close (Esc)"
          aria-label="Close preview"
          data-testid="floating-close"
          onClick={() => closeFloat()}
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            color: color.textTertiary,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: `0 ${space[1]}px`,
            borderRadius: radius.sm,
          }}
        >
          ×
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* The float is the canvas-side surface, so it keeps the badge backpack
            panel (prompt + references); the right panel doesn't. */}
        <FilePreview file={floatingFile} paneId={FLOAT_PANE_ID} isActive showBadge />
      </div>
    </div>
  );
};
