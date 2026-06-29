import { type CSSProperties, type JSX, useEffect, useState } from 'react';
import { fileUrl } from '../../../../../platform/files/common/fileUrl.js';
import type { BadgeType } from '../../../../browser/labels/FileGlyph.js';
import { color, font, radius, space } from '../../../../browser/style/design.js';
import { workspaceCanvasDataService } from '../../../../services/workspace/browser/workspaceCanvasDataService.js';
import { UnifiedDiff } from '../../../multiDiffEditor/browser/UnifiedDiff.js';
import { useFileDiff } from '../../../multiDiffEditor/browser/useFileDiff.js';
import { PREVIEW_CHARS } from './badgeNodeModel.js';
import {
  type PreviewContent,
  getMarkdownPreviewHtml,
  getPreviewContent,
  invalidatePreviewCache,
  setMarkdownPreviewHtml,
  setPreviewContent,
  subscribeTile,
} from './badgePreviewCache.js';
import { markdownToHtml } from './mdRender.js';

// The "see inside" payload. Cheap, type-aware, and pointer-transparent so it
// never steals the badge's drag. Markdown renders to static, sanitized HTML (the
// shared off-screen converter); other text shows a faded raw excerpt, and images
// show a contained thumbnail.
export const BadgePreview = ({
  type,
  label,
  wsPath,
}: {
  type: BadgeType;
  label: string;
  wsPath: string;
}): JSX.Element | null => {
  const frame: CSSProperties = {
    flex: 1,
    minHeight: 0,
    padding: `${space[2]}px ${space[3]}px ${space[3]}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
  };

  if (type === 'image') {
    return (
      <div style={frame}>
        <img
          src={fileUrl(`${wsPath}/${label}`)}
          alt=""
          draggable={false}
          style={{
            display: 'block',
            maxWidth: '100%',
            width: '100%',
            height: '100%',
            margin: '0 auto',
            objectFit: 'contain',
            borderRadius: radius.sm,
          }}
        />
      </div>
    );
  }

  if (type === 'text' || type === 'code') {
    const isMarkdown = /\.(md|markdown|mdx)$/i.test(label);
    return (
      <div style={frame}>
        {isMarkdown ? (
          <MarkdownPreview label={label} />
        ) : (
          <TextPreview label={label} mono={type === 'code'} />
        )}
      </div>
    );
  }

  return null;
};

// Fade the bottom so the truncation reads as "more below," not a hard cut.
const previewMask: CSSProperties = {
  height: '100%',
  overflow: 'hidden',
  maskImage: 'linear-gradient(to bottom, #000 70%, transparent)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 70%, transparent)',
};

// A changed file's card shows its DIFF preview (red/green/±) — the canvas as a
// spatial review board. HEAD ↔ working tree = all uncommitted changes, compact
// context.
export const BadgeDiffPreview = ({
  type,
  label,
  wsPath,
}: {
  type: BadgeType;
  label: string;
  wsPath: string;
}): JSX.Element => {
  const [rev, setRev] = useState(0);
  useEffect(
    () =>
      subscribeTile((e) => {
        const touched =
          e.type === 'change' || e.type === 'unlink'
            ? e.relPath === label
            : e.type === 'rename'
              ? e.fromRelPath === label || e.toRelPath === label
              : false;
        if (touched) setRev((r) => r + 1);
      }),
    [label],
  );
  const diff = useFileDiff(label, { leftRef: 'HEAD', rightWorktree: true, context: 2 }, rev);
  if (diff.status === 'ready' && diff.rows.length > 0) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={previewMask}>
          <UnifiedDiff rows={diff.rows} oldHtml={diff.oldHtml} newHtml={diff.newHtml} />
        </div>
      </div>
    );
  }
  if (diff.status === 'loading') {
    return <div style={{ flex: 1, minHeight: 0 }} />;
  }
  return <BadgePreview type={type} label={label} wsPath={wsPath} />;
};

function usePreviewSource(label: string): string | null {
  const [content, setContent] = useState<PreviewContent | null>(
    () => getPreviewContent(label) ?? null,
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return subscribeTile((event) => {
      if (event.type === 'change' && event.relPath === label) {
        invalidatePreviewCache(label);
        setTick((t) => t + 1);
      } else if (event.type === 'unlink' && event.relPath === label) {
        invalidatePreviewCache(label);
      } else if (event.type === 'rename' && event.fromRelPath === label) {
        invalidatePreviewCache(label);
      }
    });
  }, [label]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a refetch trigger bumped on disk changes
  useEffect(() => {
    const cached = getPreviewContent(label);
    if (cached) {
      setContent(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      let out: PreviewContent;
      try {
        const res = await workspaceCanvasDataService.readFile(label, { maxChars: PREVIEW_CHARS });
        out = { text: res.content.slice(0, PREVIEW_CHARS).trimEnd() };
      } catch {
        out = { text: '' };
      }
      setPreviewContent(label, out);
      if (!cancelled) setContent(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [label, tick]);

  return content === null ? null : content.text;
}

const previewLoading: CSSProperties = { fontSize: font.size.micro, color: color.textTertiary };

const RawTextBody = ({ text, mono }: { text: string; mono: boolean }): JSX.Element => (
  <div
    style={{
      ...previewMask,
      fontSize: 'var(--bh-card-font-size)',
      fontFamily: mono ? font.mono : 'var(--bh-card-font)',
      color: mono ? color.textTertiary : 'var(--bh-card-text)',
      lineHeight: 'var(--bh-card-line-height)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}
  >
    {text === '' ? 'empty file' : text}
  </div>
);

const TextPreview = ({ label, mono }: { label: string; mono: boolean }): JSX.Element => {
  const text = usePreviewSource(label);
  if (text === null) return <div style={previewLoading}>…</div>;
  return <RawTextBody text={text} mono={mono} />;
};

const MarkdownPreview = ({ label }: { label: string }): JSX.Element => {
  const text = usePreviewSource(label);
  const [html, setHtml] = useState<string | null>(() => getMarkdownPreviewHtml(label) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (text === null || text === '') return;
    const cached = getMarkdownPreviewHtml(label);
    if (cached !== undefined) {
      setHtml(cached);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    void markdownToHtml(text)
      .then((out) => {
        setMarkdownPreviewHtml(label, out);
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        if (!cancelled) {
          setHtml(null);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [label, text]);

  if (text === null) return <div style={previewLoading}>…</div>;
  if (text === '') return <RawTextBody text="" mono={false} />;
  if (html === null) {
    return failed ? <RawTextBody text={text} mono={false} /> : <div style={previewLoading}>…</div>;
  }
  return (
    <div
      className="bh-md-preview"
      style={previewMask}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: html is sanitized in badge-node/mdRender before it reaches here
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
