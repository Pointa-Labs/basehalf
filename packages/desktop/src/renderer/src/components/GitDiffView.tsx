import type { GitShowResult, WorkspaceReadFileResult } from '@basehalf/core';
import * as monaco from 'monaco-editor';
import { type JSX, useEffect, useRef, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { ensureBhTheme, languageOf } from '../lib/monacoSetup.js';

/**
 * A read-only git diff in Monaco's diff editor — opened by clicking a changed
 * file in the Source Control panel. Baseline on the left, current on the right:
 *   staged row   → HEAD  vs the staged (index) version
 *   unstaged row → index vs the working-tree file
 * Sides are fetched through core's `git.show` (`<ref>:./path`) and
 * `workspace.readFile`; the view never writes.
 */

// The diff editor's `maxFileSize` option doesn't gate this (it's a workbench-layer
// concept, not part of the embeddable createDiffEditor API), so we cap inputs
// ourselves: above this many CHARS (UTF-16 units — a generous size proxy), skip
// the diff rather than load both sides + churn a worker on a huge file. The
// built-in maxComputationTime only bounds CPU, not memory.
const MAX_DIFF_CHARS = 2 * 1024 * 1024;
export const GitDiffView = ({
  path,
  staged,
  onClose,
}: {
  path: string;
  staged: boolean;
  onClose: () => void;
}): JSX.Element => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let editor: monaco.editor.IStandaloneDiffEditor | null = null;
    let original: monaco.editor.ITextModel | null = null;
    let modified: monaco.editor.ITextModel | null = null;
    void (async () => {
      try {
        // Baseline (left) and current (right). ref '' → the index (`git show :./path`).
        const leftP = window.bh.run('git.show', {
          ref: staged ? 'HEAD' : '',
          path,
        }) as Promise<GitShowResult>;
        const rightP = staged
          ? (window.bh.run('git.show', { ref: '', path }) as Promise<GitShowResult>)
          : (
              window.bh.run('workspace.readFile', { path }) as Promise<WorkspaceReadFileResult>
            ).catch((err: unknown): WorkspaceReadFileResult => {
              // A deleted working-tree file → the right side is simply empty (the
              // read throws PATH_NOT_FOUND). Show the deletion, not an error banner.
              if (err instanceof Error && err.message.startsWith('[PATH_NOT_FOUND]')) {
                return { content: '' } as WorkspaceReadFileResult;
              }
              throw err;
            });
        const [left, right] = await Promise.all([leftP, rightP]);
        if (cancelled) return;
        if (
          (left.content?.length ?? 0) > MAX_DIFF_CHARS ||
          (right.content?.length ?? 0) > MAX_DIFF_CHARS
        ) {
          setError('File is too large to show a diff.');
          return;
        }
        const host = hostRef.current;
        if (!host) return;
        ensureBhTheme();
        const lang = languageOf(path);
        original = monaco.editor.createModel(left.content ?? '', lang);
        modified = monaco.editor.createModel(right.content ?? '', lang);
        editor = monaco.editor.createDiffEditor(host, {
          theme: 'bh-dark',
          readOnly: true,
          originalEditable: false,
          automaticLayout: true,
          renderSideBySide: true,
          // A narrow panel falls back to a single inline view instead of two cramped columns.
          useInlineViewWhenSpaceIsLimited: true,
          renderSideBySideInlineBreakpoint: 600,
          // A git diff should surface whitespace-only changes (re-indents, trailing ws).
          ignoreTrimWhitespace: false,
          // Read-only preview: drop the overview ruler (minimap is already off) and the
          // hunk revert menu (empty when read-only) to keep the chrome clean.
          renderOverviewRuler: false,
          renderGutterMenu: false,
          // Bound the diff computation on a large file (returns a partial result, no hang).
          maxComputationTime: 5000,
          fontFamily: font.mono,
          fontSize: 13,
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
        });
        editor.setModel({ original, modified });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      editor?.dispose();
      original?.dispose();
      modified?.dispose();
    };
  }, [path, staged]);

  const name = path.slice(path.lastIndexOf('/') + 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          padding: `${space[2]}px ${space[3]}px`,
          borderBottom: `1px solid ${color.divider}`,
          fontFamily: font.sans,
          fontSize: font.size.caption,
          color: color.textSecondary,
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: font.weight.medium, color: color.textPrimary }}>{name}</span>
        <span style={{ color: color.textTertiary }}>
          {staged ? 'Staged ↔ HEAD' : 'Working Tree ↔ Index'}
        </span>
        <button
          type="button"
          title="Close diff"
          aria-label="Close diff"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            borderRadius: radius.sm,
            cursor: 'pointer',
            color: color.textTertiary,
            fontSize: font.size.body,
            transition: transition(['background', 'color']),
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = color.divider;
            e.currentTarget.style.color = color.textPrimary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.color = color.textTertiary;
          }}
        >
          ✕
        </button>
      </div>
      {error !== null ? (
        <div
          style={{
            flex: 1,
            padding: space[4],
            color: color.danger,
            fontFamily: font.sans,
            fontSize: font.size.caption,
          }}
        >
          {error}
        </div>
      ) : (
        <div ref={hostRef} style={{ flex: 1, minHeight: 0 }} />
      )}
    </div>
  );
};
