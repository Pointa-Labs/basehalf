import { Handle, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, type JSX, useEffect, useRef, useState } from 'react';
import { color, font, radius, shadow, space, transition } from '../design.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { markdownToHtml } from '../lib/mdRender.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { type BadgeType, FileGlyph, badgeType } from './FileGlyph.js';

// A badge is a *living tile*: it always shows a real preview of the file's
// contents (a text excerpt / image thumbnail), so the canvas reads as "my
// documents in space," not a graph of names. React-flow's transform scales the
// whole tile with zoom — so the content shrinks to a thumbnail when you zoom
// out and becomes readable as you zoom in, with no detail-toggling needed.

// Cache previews per path so a transient unmount (Canvas rebuilds nodes on file
// events) doesn't refetch/re-render. Staleness self-heals on the next refresh.
// Markdown renders to HTML (via BlockNote — same engine as the editor); other
// text falls back to a raw excerpt.
type PreviewContent = { html: string } | { text: string };
const previewCache = new Map<string, PreviewContent>();
const PREVIEW_CHARS = 600;

// One shared file-event subscription fans out to all mounted tiles, instead of
// each tile registering its own ipcRenderer listener (which trips Node's
// MaxListeners warning past ~10 text badges and fans out O(N) per event).
type FileEvent = Parameters<Parameters<typeof window.bh.onFileEvent>[0]>[0];
const tileListeners = new Set<(e: FileEvent) => void>();
let tileHubUnsub: (() => void) | null = null;
function subscribeTile(listener: (e: FileEvent) => void): () => void {
  if (!tileHubUnsub) {
    tileHubUnsub = window.bh.onFileEvent((event) => {
      for (const l of tileListeners) l(event);
    });
  }
  tileListeners.add(listener);
  return () => {
    tileListeners.delete(listener);
  };
}

export interface BadgeNodeData extends Record<string, unknown> {
  label: string;
  kind: 'file' | 'folder';
  orphan?: boolean;
  prompt?: string;
  /** True when this file is in the current focus set — i.e. it's part of what
   *  the AI agent reads from .bh/focus.md right now. Rendered as a persistent
   *  accent ring + corner dot so the human can SEE the context they handed the
   *  agent (the curation payoff was otherwise invisible). */
  focused?: boolean;
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

export const BadgeNode = ({ data, selected }: NodeProps): JSX.Element => {
  const d = data as unknown as BadgeNodeData;
  const isFolder = d.kind === 'folder';
  const orphan = d.orphan === true;
  const focused = d.focused === true;
  const lastSlash = d.label.lastIndexOf('/');
  const basename = lastSlash === -1 ? d.label : d.label.slice(lastSlash + 1);
  const dirname = lastSlash === -1 ? '' : d.label.slice(0, lastSlash);
  const type = badgeType(d.label, isFolder);

  const wsPath = useWorkspaceStore((s) => {
    const w = s.workspaces.find((ws) => ws.name === s.current);
    return w?.path ?? '';
  });
  // Always show a content preview for the types we can render cheaply
  // (text/markdown/code → excerpt, image → thumbnail). Orphans (missing file)
  // and folders have nothing to preview.
  const previewable = type === 'image' || type === 'text' || type === 'code';
  const showPreview = previewable && !orphan && !isFolder;

  // Orphan = file referenced but missing on disk. We want the badge to read
  // as "placeholder" rather than "error": muted background + dashed danger
  // border + danger basename + MISSING chip. Three signals max, all
  // pointing the same way — not four overlapping ones.
  const baseBg = orphan ? color.surfaceMuted : isFolder ? color.folder : color.surface;
  const baseBorder = orphan ? color.danger : isFolder ? color.folderBorder : color.borderStrong;
  const borderStyle = orphan ? 'dashed' : 'solid';
  // Glyph tone: muted grey for files (calm on a busy canvas), warm for the
  // folder kind, danger when the target is missing.
  const glyphTone = orphan ? color.danger : isFolder ? color.folderGlyph : color.textTertiary;

  const tooltip = focused
    ? `${d.label} — in focus; your AI agent reads this now. Shift-click to remove.`
    : isFolder
      ? `${d.label} — double-click to enter this folder`
      : orphan
        ? `${d.label} — referenced but missing on disk`
        : `${d.label} — click to focus · shift-click to add`;

  // Focus is the load-bearing agent signal but was invisible. Render it as a
  // persistent accent ring (distinct from react-flow's transient `selected`)
  // so the focus set stays visible even after the user clicks elsewhere.
  const boxShadow = focused
    ? `${shadow.focus}, ${shadow.card}`
    : selected
      ? shadow.selectedNode
      : shadow.card;

  return (
    <div
      title={tooltip}
      style={{
        position: 'relative',
        background: baseBg,
        border: `1px ${borderStyle} ${focused || selected ? color.accent : baseBorder}`,
        borderRadius: radius.lg,
        padding: `${space[2]}px ${space[3]}px`,
        minWidth: 160,
        // Cap preview tiles at 200 so they don't overlap their neighbour in the
        // 220-pitch auto-layout grid; plain badges keep the roomier 240.
        maxWidth: showPreview ? 200 : 240,
        fontFamily: font.sans,
        boxShadow,
        transition: transition(['box-shadow', 'border-color']),
        cursor: 'grab',
      }}
    >
      {focused && (
        // The unambiguous "in focus" marker — a filled accent dot with a halo,
        // so a focused badge is recognizable at a glance even when unselected.
        <span
          aria-hidden
          title="In focus — your AI agent reads this file"
          style={{
            position: 'absolute',
            top: -5,
            right: -5,
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: color.accent,
            border: `2px solid ${color.surface}`,
            boxShadow: shadow.focus,
          }}
        />
      )}
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div style={{ display: 'flex', gap: space[2], alignItems: 'flex-start' }}>
        {/* Fixed 20px box so the glyph optically centers against the
            basename's first line regardless of how many lines follow. */}
        <span
          aria-hidden
          style={{ display: 'flex', alignItems: 'center', height: 20, flexShrink: 0 }}
        >
          <FileGlyph type={type} tone={glyphTone} size={15} />
        </span>
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
          {showPreview && <BadgePreview type={type} label={d.label} wsPath={wsPath} />}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
};

// The "see inside" payload. Cheap, type-aware, and pointer-transparent so it
// never steals the badge's drag. Markdown renders (via BlockNote) to formatted
// HTML so the tile matches the editor; other text shows a faded raw excerpt;
// images a contained thumbnail. PDF/audio/video/other degrade to nothing extra
// — the glyph + name already say what they are, and a live thumbnail there
// would cost far more than it tells.
const BadgePreview = ({
  type,
  label,
  wsPath,
}: {
  type: BadgeType;
  label: string;
  wsPath: string;
}): JSX.Element | null => {
  const frame: CSSProperties = {
    marginTop: space[2],
    paddingTop: space[2],
    borderTop: `1px solid ${color.border}`,
    pointerEvents: 'none', // never intercept the badge drag
  };

  if (type === 'image') {
    return (
      <div style={frame}>
        <img
          src={`file://${wsPath}/${label}`}
          alt=""
          draggable={false}
          style={{
            display: 'block',
            maxWidth: '100%',
            maxHeight: 116,
            margin: '0 auto',
            objectFit: 'contain',
            borderRadius: radius.sm,
          }}
        />
      </div>
    );
  }

  if (type === 'text' || type === 'code') {
    // Only true Markdown is rendered; source code (and .txt) stay raw — running
    // a .ts file through a markdown renderer would mangle it.
    const isMarkdown = /\.(md|markdown)$/i.test(label);
    return (
      <div style={frame}>
        <TextPreview label={label} markdown={isMarkdown} mono={type === 'code'} />
      </div>
    );
  }

  return null;
};

// Fade the bottom so the truncation reads as "more below," not a hard cut.
const previewMask: CSSProperties = {
  maxHeight: 116,
  overflow: 'hidden',
  maskImage: 'linear-gradient(to bottom, #000 70%, transparent)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 70%, transparent)',
};

const TextPreview = ({
  label,
  markdown,
  mono,
}: {
  label: string;
  markdown: boolean;
  mono: boolean;
}): JSX.Element => {
  const [content, setContent] = useState<PreviewContent | null>(
    () => previewCache.get(label) ?? null,
  );
  // Bumped when this file changes on disk (the user edits it in the editor, or
  // an external/agent edit) — invalidates the cache so the tile re-fetches and
  // the preview always matches the file. Disk is the single source of truth.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return subscribeTile((event) => {
      if (event.type === 'change' && event.relPath === label) {
        previewCache.delete(label);
        setTick((t) => t + 1); // re-read from disk → tile matches the file
      } else if (event.type === 'unlink' && event.relPath === label) {
        previewCache.delete(label); // drop stale cache; the badge orphans
      } else if (event.type === 'rename' && event.fromRelPath === label) {
        previewCache.delete(label); // path reused later won't serve old content
      }
    });
  }, [label]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a refetch trigger — bumped on a disk change to invalidate the cache and re-read
  useEffect(() => {
    const cached = previewCache.get(label);
    if (cached) {
      setContent(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      let out: PreviewContent;
      try {
        // Cap the read: a tile only ever shows PREVIEW_CHARS of body, so don't
        // ship a multi-MB file across IPC for a 600-char preview. Headroom above
        // PREVIEW_CHARS covers a leading frontmatter block + the stripped HTML
        // comment before the body slice. The headroom (16KB) must comfortably
        // exceed any realistic leading frontmatter block — if the cap landed
        // mid-frontmatter, splitFrontmatter couldn't find the closing fence and
        // the tile would render raw YAML or blank. 16KB dwarfs real frontmatter
        // (typically <1KB) while still bounding the read.
        const res = (await window.bh.run('workspace.readFile', {
          path: label,
          maxChars: PREVIEW_CHARS + 16_384,
        })) as { content: string };
        if (markdown) {
          // Strip a leading YAML frontmatter block so the tile previews the
          // note's BODY (matching the editor, which also peels it off) instead
          // of leading with raw `title:`/`tags:` lines — Obsidian/Jekyll notes
          // would otherwise show YAML noise on every canvas tile. Then drop HTML
          // comments (e.g. the bh:workspace-hint marker) before slicing: they
          // don't render in a preview and, adjacent to a heading, break parsing.
          // Render with BlockNote so the tile matches the editor; fall back to
          // raw if conversion throws.
          const { body } = splitFrontmatter(res.content);
          const cleaned = body.replace(/<!--[\s\S]*?-->/g, '').slice(0, PREVIEW_CHARS);
          try {
            out = { html: await markdownToHtml(cleaned.trim()) };
          } catch {
            out = { text: cleaned.trimEnd() };
          }
        } else {
          out = { text: res.content.slice(0, PREVIEW_CHARS).trimEnd() };
        }
      } catch {
        out = { text: '' };
      }
      previewCache.set(label, out);
      if (!cancelled) setContent(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [label, markdown, tick]);

  if (content === null) {
    return <div style={{ fontSize: font.size.micro, color: color.textTertiary }}>…</div>;
  }
  if ('html' in content) {
    return <MarkdownHtml html={content.html} />;
  }
  return (
    <div
      style={{
        ...previewMask,
        fontSize: font.size.micro,
        fontFamily: mono ? font.mono : font.sans,
        color: color.textTertiary,
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {content.text === '' ? 'empty file' : content.text}
    </div>
  );
};

// Inject BlockNote-rendered HTML via a ref (not dangerouslySetInnerHTML) — the
// content is from the user's own local file, the same it sees live in the
// editor; the ref path keeps this lint-clean without disabling the security
// rule project-wide.
const MarkdownHtml = ({ html }: { html: string }): JSX.Element => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, [html]);
  return <div ref={ref} className="bh-md-preview" style={previewMask} />;
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
