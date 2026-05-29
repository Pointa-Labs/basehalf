import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { JSX } from 'react';
import { color, font, radius, shadow, space, transition } from '../design.js';

export interface BadgeNodeData extends Record<string, unknown> {
  label: string;
  kind: 'file' | 'folder';
  orphan?: boolean;
  prompt?: string;
}

// Handles sit on the L/R edges. Default react-flow renders them as small
// black circles which look like terminal dots. Custom-style them so they
// recede until you hover the badge (no clutter on a busy canvas) and
// turn into a clear "drag from here" affordance on hover.
const handleStyle = {
  background: color.surface,
  border: `1.5px solid ${color.textTertiary}`,
  width: 9,
  height: 9,
  transition: transition(['background', 'border-color', 'transform']),
};

// File-type identity. The canvas is the product's hero surface — "a canvas
// for any file, organized the way you think" — so a photo, a song, a PDF
// and a note must be distinguishable at a glance, not five identical grey
// boxes. We carry type by SHAPE (monochrome line glyphs), not by a rainbow
// of fills, to stay inside the "one accent" restraint of the design system.
// Folders keep their warm tint as the one kind-level color distinction.
type BadgeType = 'folder' | 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'code' | 'generic';

const EXT_TYPE: Record<string, BadgeType> = {
  md: 'text',
  markdown: 'text',
  mdx: 'text',
  txt: 'text',
  rst: 'text',
  org: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  heic: 'image',
  avif: 'image',
  ico: 'image',
  tiff: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  flac: 'audio',
  aac: 'audio',
  ogg: 'audio',
  opus: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  m4v: 'video',
  pdf: 'pdf',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  java: 'code',
  rb: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  cs: 'code',
  php: 'code',
  swift: 'code',
  kt: 'code',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  css: 'code',
  scss: 'code',
  html: 'code',
  xml: 'code',
  sh: 'code',
  sql: 'code',
};

const badgeType = (label: string, isFolder: boolean): BadgeType => {
  if (isFolder) return 'folder';
  const dot = label.lastIndexOf('.');
  if (dot === -1 || dot === label.length - 1) return 'generic';
  return EXT_TYPE[label.slice(dot + 1).toLowerCase()] ?? 'generic';
};

// Each glyph is a 16-unit-viewBox line drawing. Strokes use currentColor so
// the parent controls tone (muted grey for files, warm for folders, danger
// for orphans). Shapes are deliberately distinct at 15px: prose lines for
// text, photo frame for images, waveform for audio, play for video, a
// folded page for documents, chevrons for code.
const GLYPH_PATHS: Record<BadgeType, JSX.Element> = {
  text: <path d="M3.5 4h9M3.5 7h9M3.5 10h9M3.5 13h5.5" />,
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
      <circle cx="5.8" cy="6.3" r="1.1" />
      <path d="M3 12l3-3 2.3 2.3L11 8l2.2 2.2" />
    </>
  ),
  audio: <path d="M4 7v2M6.5 4.8v6.4M9 3.2v9.6M11.5 5.6v4.8" />,
  video: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.6" />
      <path d="M6.8 6.3l3 1.7-3 1.7z" fill="currentColor" stroke="none" />
    </>
  ),
  pdf: (
    <>
      <path d="M4 2.5h4.5l3 3V13H4z" />
      <path d="M8.5 2.5v3h3" />
      <path d="M5.8 9h4M5.8 11h4" />
    </>
  ),
  code: <path d="M6 5L3 8l3 3M10 5l3 3-3 3" />,
  generic: (
    <>
      <path d="M4 2.5h4.5l3 3V13H4z" />
      <path d="M8.5 2.5v3h3" />
    </>
  ),
  folder: (
    <path d="M2.5 4.7a1 1 0 0 1 1-1h2.7a1 1 0 0 1 .72.3l.86.9a1 1 0 0 0 .72.3h4a1 1 0 0 1 1 1v5.3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  ),
};

const FileGlyph = ({ type, tone }: { type: BadgeType; tone: string }): JSX.Element => (
  // Fixed 20px box so the glyph optically centers against the basename's
  // first line regardless of how many lines (dirname / prompt) follow.
  <span
    aria-hidden
    style={{ display: 'flex', alignItems: 'center', height: 20, flexShrink: 0, color: tone }}
  >
    <svg
      width={15}
      height={15}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {GLYPH_PATHS[type]}
    </svg>
  </span>
);

export const BadgeNode = ({ data, selected }: NodeProps): JSX.Element => {
  const d = data as unknown as BadgeNodeData;
  const isFolder = d.kind === 'folder';
  const orphan = d.orphan === true;
  const lastSlash = d.label.lastIndexOf('/');
  const basename = lastSlash === -1 ? d.label : d.label.slice(lastSlash + 1);
  const dirname = lastSlash === -1 ? '' : d.label.slice(0, lastSlash);
  const type = badgeType(d.label, isFolder);

  // Orphan = file referenced but missing on disk. We want the badge to read
  // as "placeholder" rather than "error": muted background + dashed danger
  // border + danger basename + MISSING chip. Three signals max, all
  // pointing the same way — not four overlapping ones.
  const baseBg = orphan ? color.surfaceMuted : isFolder ? color.folder : color.surface;
  const baseBorder = orphan ? color.danger : isFolder ? color.folderBorder : color.borderStrong;
  const borderStyle = orphan ? 'dashed' : 'solid';
  // Glyph tone: muted grey for files (calm on a busy canvas), warm for the
  // folder kind, danger when the target is missing.
  const glyphTone = orphan ? color.danger : isFolder ? '#9a7d12' : color.textTertiary;

  const tooltip = isFolder
    ? `${d.label} — double-click to enter this folder`
    : orphan
      ? `${d.label} — referenced but missing on disk`
      : d.label;

  return (
    <div
      title={tooltip}
      style={{
        background: baseBg,
        border: `1px ${borderStyle} ${selected ? color.accent : baseBorder}`,
        borderRadius: radius.lg,
        padding: `${space[2]}px ${space[3]}px`,
        minWidth: 160,
        maxWidth: 240,
        fontFamily: font.sans,
        boxShadow: selected ? shadow.selectedNode : shadow.card,
        transition: transition(['box-shadow', 'border-color']),
        cursor: 'grab',
      }}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div style={{ display: 'flex', gap: space[2], alignItems: 'flex-start' }}>
        <FileGlyph type={type} tone={glyphTone} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[1.5] }}>
            <span
              style={{
                fontWeight: font.weight.semibold,
                fontSize: font.size.body,
                color: orphan ? color.danger : color.textPrimary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
                letterSpacing: -0.1,
              }}
            >
              {basename}
            </span>
            {orphan && <KindChip label="MISSING" tone="danger" />}
          </div>
          {dirname && (
            <div
              style={{
                fontSize: font.size.micro,
                color: color.textTertiary,
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: font.mono,
                letterSpacing: -0.2,
              }}
            >
              {dirname}/
            </div>
          )}
          {d.prompt && (
            <div
              style={{
                marginTop: space[1.5],
                fontSize: font.size.caption,
                color: color.textSecondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                lineHeight: 1.4,
              }}
            >
              {d.prompt}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
};

const KindChip = ({
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
      letterSpacing: 0.6,
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
