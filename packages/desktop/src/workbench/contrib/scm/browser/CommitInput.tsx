import { type JSX, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { color, font, space } from '../../../browser/style/design.js';
import { CommitActionButton } from './CommitActionButton.js';
import {
  commitInputHeight,
  commitInputPlaceholder,
  nextCommitHistoryState,
  recordCommitMessage,
  validateCommitInput,
} from './commitInputModel.js';
import type {
  SourceControlActionButtonModel,
  SourceControlPrimaryAction,
} from './sourceControlActionButtonModel.js';
import { scm } from './styles.js';
import type { CommitActionOptions } from './types.js';

// Platform-correct commit shortcut for the placeholder (the handler accepts
// both Cmd/Ctrl, so the hint should name the right one rather than always Cmd).
const COMMIT_KEY = nativeHostService.platform === 'darwin' ? '⌘Enter' : 'Ctrl+Enter';

export const CommitInput = ({
  message,
  setMessage,
  hasStaged,
  commitBranch,
  commit,
  actionButton,
  primaryAction,
}: {
  message: string;
  setMessage: (s: string) => void;
  hasStaged: boolean;
  commitBranch: string;
  commit: (options?: CommitActionOptions) => void;
  actionButton: SourceControlActionButtonModel;
  primaryAction: (action: SourceControlPrimaryAction) => void;
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
    const nextHeight = commitInputHeight(el.scrollHeight, scm.inputMinHeight, scm.inputMaxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > scm.inputMaxHeight ? 'auto' : 'hidden';
  });

  const updateHistory = useCallback(
    (next: 1 | -1): void => {
      const state = nextCommitHistoryState({
        history: commitHistory,
        cursor: historyCursor,
        direction: next,
      });
      if (state === null) return;
      setHistoryCursor(state.cursor);
      setMessage(state.message);
    },
    [commitHistory, historyCursor, setMessage],
  );

  const attemptCommit = useCallback(
    (options: CommitActionOptions = {}): void => {
      const trimmed = message.trim();
      const validationMessage = validateCommitInput(message, options, hasStaged);
      if (validationMessage !== null) {
        setValidation(validationMessage);
        textareaRef.current?.focus();
        return;
      }
      setCommitHistory((history) => recordCommitMessage(history, trimmed));
      setHistoryCursor(null);
      setValidation(null);
      commit(options);
    },
    [commit, hasStaged, message],
  );

  const commitPlaceholder = commitInputPlaceholder(commitBranch, COMMIT_KEY);
  const onPrimaryAction =
    actionButton.primaryAction === 'commit'
      ? undefined
      : () => primaryAction(actionButton.primaryAction);

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
              padding: '8px',
              outline: 'none',
            }}
          />
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
        model={actionButton}
        onPrimaryAction={onPrimaryAction}
        onAction={attemptCommit}
      />
    </div>
  );
};
