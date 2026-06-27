import { type JSX, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { color, font, space } from '../../design.js';
import { toast } from '../../store/toast.js';
import { Codicon } from '../Codicon.js';
import { CommitActionButton } from './CommitActionButton.js';
import { scm } from './styles.js';
import type { CommitActionOptions } from './types.js';

// Platform-correct commit shortcut for the placeholder (the handler accepts
// both Cmd/Ctrl, so the hint should name the right one rather than always Cmd).
const COMMIT_KEY = window.bh.platform === 'darwin' ? '⌘Enter' : 'Ctrl+Enter';

export const CommitInput = ({
  message,
  setMessage,
  canCommit,
  canCommitAmend,
  hasStaged,
  commitBranch,
  commit,
}: {
  message: string;
  setMessage: (s: string) => void;
  canCommit: boolean;
  canCommitAmend: boolean;
  hasStaged: boolean;
  commitBranch: string;
  commit: (options?: CommitActionOptions) => void;
}): JSX.Element => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [commitHistory, setCommitHistory] = useState<readonly string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, scm.inputMinHeight), scm.inputMaxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > scm.inputMaxHeight ? 'auto' : 'hidden';
  });

  const updateHistory = useCallback(
    (next: 1 | -1): void => {
      if (commitHistory.length === 0) return;
      const end = commitHistory.length;
      const current = historyCursor ?? end;
      const index = Math.max(0, Math.min(end, current + next));
      setHistoryCursor(index === end ? null : index);
      setMessage(index === end ? '' : (commitHistory[index] ?? ''));
    },
    [commitHistory, historyCursor, setMessage],
  );

  const attemptCommit = useCallback(
    (options: CommitActionOptions = {}): void => {
      const trimmed = message.trim();
      if (trimmed === '') {
        setValidation('Please provide a commit message.');
        textareaRef.current?.focus();
        return;
      }
      if (options.amend !== true && !hasStaged) {
        setValidation('There are no staged changes to commit.');
        textareaRef.current?.focus();
        return;
      }
      setCommitHistory((history) => {
        const withoutDuplicate = history.filter((entry) => entry !== trimmed);
        return [...withoutDuplicate, trimmed].slice(-100);
      });
      setHistoryCursor(null);
      setValidation(null);
      commit(options);
    },
    [commit, hasStaged, message],
  );

  const commitPlaceholder =
    commitBranch !== ''
      ? `Message (${COMMIT_KEY} to commit on “${commitBranch}”)`
      : `Message (${COMMIT_KEY} to commit)`;

  return (
    <div
      style={{
        padding: `${space[2]}px ${space[2]}px 0 11px`,
        flexShrink: 0,
      }}
    >
      {/* VS Code's .scm-input > .scm-editor: editor area plus right toolbar. */}
      <div
        className={inputFocused ? 'synthetic-focus' : undefined}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          width: '100%',
          boxSizing: 'border-box',
          background: scm.inputBg,
          border: `1px solid ${scm.inputBorder}`,
          borderRadius: scm.editorRadius,
          outline: inputFocused ? `1px solid ${color.accent}` : 'none',
          outlineOffset: -1,
        }}
      >
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          {message === '' && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                right: 0,
                height: 20,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                pointerEvents: 'none',
                color: scm.inputPlaceholder,
                fontFamily: font.sans,
                fontSize: font.size.ui,
                lineHeight: '20px',
              }}
            >
              {commitPlaceholder}
            </span>
          )}
          <textarea
            ref={textareaRef}
            className="bh-scm-commit-input"
            value={message}
            aria-label="Commit message"
            onFocus={() => setInputFocused(true)}
            onChange={(e) => {
              setMessage(e.target.value);
              setHistoryCursor(null);
              if (validation !== null) setValidation(null);
            }}
            onBlur={() => {
              setInputFocused(false);
              window.setTimeout(() => setValidation(null), 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                attemptCommit();
                return;
              }
              if (e.key === 'Escape' && message !== '') {
                e.preventDefault();
                setMessage('');
                setValidation(null);
                return;
              }
              if (e.key === 'ArrowUp' && (e.altKey || e.currentTarget.selectionStart === 0)) {
                e.preventDefault();
                updateHistory(-1);
                return;
              }
              if (
                e.key === 'ArrowDown' &&
                (e.altKey || e.currentTarget.selectionStart === e.currentTarget.value.length)
              ) {
                e.preventDefault();
                updateHistory(1);
              }
            }}
            rows={1}
            wrap="soft"
            spellCheck={false}
            style={{
              display: 'block',
              width: '100%',
              minHeight: scm.inputMinHeight,
              maxHeight: scm.inputMaxHeight,
              resize: 'none',
              boxSizing: 'border-box',
              background: 'transparent',
              border: 'none',
              color: color.textPrimary,
              fontFamily: font.sans,
              fontSize: font.size.ui,
              lineHeight: '20px',
              padding: '8px 0 8px 8px',
              outline: 'none',
            }}
          />
        </div>
        <div
          style={{
            width: scm.inputToolbarWidth,
            flexShrink: 0,
            boxSizing: 'border-box',
            padding: '1px 3px 1px 1px',
          }}
        >
          <button
            type="button"
            title="Generate Commit Message (AI)"
            aria-label="Generate commit message"
            onClick={() => toast.info('AI commit messages are not wired up yet.')}
            style={{
              width: scm.iconButtonSize,
              height: scm.iconButtonSize,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              borderRadius: 3,
              color: scm.inputPlaceholder,
              cursor: 'pointer',
              fontSize: font.size.body,
              padding: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = scm.buttonHoverBg;
              e.currentTarget.style.color = color.textPrimary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.color = scm.inputPlaceholder;
            }}
          >
            <Codicon name="sparkle" size={16} />
          </button>
        </div>
      </div>
      {validation !== null && (
        <div
          style={{
            marginTop: -1,
            padding: `${space[1]}px ${space[2]}px`,
            background: color.dangerSoft,
            border: `1px solid ${color.danger}`,
            borderTop: 'none',
            borderRadius: `0 0 ${scm.editorRadius}px ${scm.editorRadius}px`,
            color: color.textPrimary,
            fontFamily: font.sans,
            fontSize: font.size.caption,
          }}
        >
          {validation}
        </div>
      )}
      <CommitActionButton
        canCommit={canCommit}
        canCommitAmend={canCommitAmend}
        onAction={attemptCommit}
      />
    </div>
  );
};
