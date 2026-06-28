import type { JSX } from 'react';
import type { CanvasFolderPreview } from '../../../../../platform/workspaces/common/workspaces.js';
import { FileGlyph, badgeType } from '../../../../browser/labels/FileGlyph.js';
import type { BadgeType } from '../../../../browser/labels/FileGlyph.js';
import { color, font, radius, space } from '../../../../browser/style/design.js';
import {
  MINI_LABEL_CARD_HEIGHT_FRACTION,
  MINI_LABEL_MIN_FLOW_PX,
  MINI_LABEL_TARGET_SCREEN_PX,
} from './cardLod.js';

// The collapsed card: a centred glyph + name that fills the card, so there's no
// dead space at any height. Pointer-transparent enough that the card still
// handles select / double-click; the chip is purely visual.
export const CardTitleChip = ({
  type,
  tone,
  name,
  orphan,
  cardHeightPx,
}: {
  type: BadgeType;
  tone: string;
  name: string;
  orphan: boolean;
  cardHeightPx: number;
}): JSX.Element => {
  const capPx = Math.round(
    Math.max(MINI_LABEL_MIN_FLOW_PX, cardHeightPx * MINI_LABEL_CARD_HEIGHT_FRACTION),
  );
  const fontSize = `clamp(${MINI_LABEL_MIN_FLOW_PX}px, calc(${MINI_LABEL_TARGET_SCREEN_PX}px / var(--bh-zoom, 1)), ${capPx}px)`;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        height: '100%',
        flex: 1,
        minWidth: 0,
        padding: `${space[2]}px ${space[3]}px`,
        fontSize,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flow-root', minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            float: 'left',
            display: 'flex',
            alignItems: 'center',
            height: '1.35em',
            marginRight: '0.4em',
          }}
        >
          <FileGlyph type={type} tone={tone} size="1.15em" />
        </span>
        <span
          style={{
            fontWeight: font.weight.semibold,
            fontSize: '1em',
            lineHeight: 1.35,
            color: orphan ? color.danger : color.textPrimary,
            overflowWrap: 'anywhere',
            letterSpacing: 0,
          }}
        >
          {name}
        </span>
      </div>
    </div>
  );
};

// A folder card's body: a peek at its direct contents (glyph + name per child),
// folders-first, capped by the folder preview service — the rest collapse to "+N more".
export const FolderContents = ({
  preview,
  prompt,
}: {
  preview: CanvasFolderPreview;
  prompt?: string;
}): JSX.Element => {
  const remaining = preview.total - preview.items.length;
  return (
    <div
      aria-hidden
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: space[1],
        padding: `${space[1.5]}px ${space[3]}px ${space[2]}px`,
        overflow: 'hidden',
        pointerEvents: 'none',
        maskImage: 'linear-gradient(to bottom, #000 86%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 86%, transparent)',
      }}
    >
      {preview.total === 0 ? (
        <span style={{ fontSize: font.size.caption, color: color.textGhost }}>Empty folder</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
          {preview.items.map((it) => {
            const isDir = it.kind === 'folder';
            return (
              <div
                key={it.name}
                style={{ display: 'flex', alignItems: 'center', gap: space[1.5], minWidth: 0 }}
              >
                <FileGlyph
                  type={badgeType(it.name, isDir)}
                  tone={isDir ? color.folderGlyph : color.textTertiary}
                  size={12}
                />
                <span
                  style={{
                    fontSize: font.size.caption,
                    color: color.textSecondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                    fontFamily: isDir ? font.sans : font.mono,
                    letterSpacing: 0,
                  }}
                >
                  {it.name}
                  {isDir ? '/' : ''}
                </span>
              </div>
            );
          })}
          {remaining > 0 && (
            <span
              style={{
                fontSize: font.size.micro,
                color: color.textTertiary,
                paddingLeft: 12 + space[1.5],
                marginTop: 1,
              }}
            >
              +{remaining} more
            </span>
          )}
        </div>
      )}
      {prompt && (
        <div
          style={{
            marginTop: space[1],
            paddingTop: space[1.5],
            borderTop: `1px solid ${color.border}`,
            fontSize: font.size.micro,
            color: color.textTertiary,
            lineHeight: 1.4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            wordBreak: 'break-word',
          }}
        >
          {prompt}
        </div>
      )}
    </div>
  );
};

export const KindChip = ({
  label,
  tone,
}: {
  label: string;
  tone: 'folder' | 'danger';
}): JSX.Element => (
  <span
    style={{
      fontSize: 9,
      fontWeight: font.weight.semibold,
      color: tone === 'danger' ? color.danger : '#8a6c00',
      letterSpacing: 0,
      textTransform: 'uppercase',
      background: tone === 'danger' ? color.dangerSoft : 'rgba(0,0,0,0.04)',
      padding: '1px 5px',
      borderRadius: radius.sm,
      flexShrink: 0,
    }}
  >
    {label}
  </span>
);
