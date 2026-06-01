import type { JSX } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { FileGlyph, badgeType } from './FileGlyph.js';

const basenameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

/**
 * The right panel's tab strip — VS-Code-style: one tab per open file, the active
 * one wears an accent top-rule, click switches (flush-gated), the × (or
 * middle-click) closes. Horizontally scrollable when tabs overflow.
 */
export const TabStrip = (): JSX.Element => {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const currentFile = useWorkspaceStore((s) => s.currentFile);
  const setCurrentFile = useWorkspaceStore((s) => s.setCurrentFile);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  return (
    <div
      role="tablist"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'stretch',
        height: 36,
        borderBottom: `1px solid ${color.border}`,
        background: color.surfaceMuted,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {tabs.map((file) => {
        const active = file === currentFile;
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: tabs are pointer affordances; keyboard tab-switching is covered by the file tree + palette
          <div
            key={file}
            role="tab"
            aria-selected={active}
            title={file}
            data-testid="editor-tab"
            data-active={active ? 'true' : 'false'}
            onMouseDown={(e) => {
              // Middle-click closes the tab — the universal browser/editor idiom.
              if (e.button === 1) {
                e.preventDefault();
                closeTab(file);
              }
            }}
            onClick={() => setCurrentFile(file)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[1.5],
              padding: `0 ${space[2]}px 0 ${space[3]}px`,
              maxWidth: 200,
              minWidth: 0,
              cursor: 'pointer',
              borderRight: `1px solid ${color.border}`,
              background: active ? color.surface : 'transparent',
              color: active ? color.textPrimary : color.textTertiary,
              fontFamily: font.sans,
              fontSize: font.size.caption,
              // Accent top-rule on the active tab (the VS-Code idiom).
              boxShadow: active ? `inset 0 2px 0 ${color.accent}` : 'none',
              transition: transition(['background', 'color']),
            }}
          >
            <FileGlyph
              type={badgeType(basenameOf(file), false)}
              tone={active ? color.accent : color.textGhost}
              size={13}
            />
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {basenameOf(file)}
            </span>
            <button
              type="button"
              title="Close tab"
              aria-label={`Close ${basenameOf(file)}`}
              data-testid="editor-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(file);
              }}
              style={{
                flexShrink: 0,
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                opacity: 0.55,
                cursor: 'pointer',
                fontSize: 15,
                lineHeight: 1,
                padding: `0 ${space[0.5]}px`,
                borderRadius: radius.sm,
                transition: transition(['opacity']),
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.55';
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
};
