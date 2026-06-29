import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import { layoutGraph } from '../common/gitGraphLayout.js';
import { HistoryItemRow } from './HistoryItemRow.js';
import { useGitStatusStore } from './gitStatusStore.js';
import { historyGraphWidth } from './historyGraphModel.js';
import { useScmViewStore } from './scmViewStore.js';
import { scm } from './styles.js';
import { useGitGraphHistory } from './useGitGraphHistory.js';

const PAGE_SIZE = 80;

export const GitGraph = (): JSX.Element => {
  const historyFilter = useScmViewStore((s) => s.historyFilter);
  const selected = useScmViewStore((s) => s.selectedHistoryItemId);
  const selectHistoryItem = useScmViewStore((s) => s.selectHistoryItem);
  const reloadRequest = useScmViewStore((s) => s.historyReloadRequest);
  const currentBranch = useGitStatusStore((s) => s.status?.branch ?? null);
  const { commits, loading, error, done, localBranches, loadPage, reload } = useGitGraphHistory(
    PAGE_SIZE,
    historyFilter,
    currentBranch,
  );
  const focusCommit = useScmViewStore((s) => s.focusCommit);
  const consumeFocus = useScmViewStore((s) => s.consumeFocus);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { rows, width } = useMemo(() => layoutGraph(commits), [commits]);
  const gutterWidth = historyGraphWidth(width);

  useEffect(() => {
    if (focusCommit === null) return;
    if (!commits.some((commit) => commit.hash === focusCommit)) return;
    selectHistoryItem(focusCommit);
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-commit="${focusCommit}"]`);
    el?.scrollIntoView({ block: 'center' });
    consumeFocus();
  }, [focusCommit, commits, consumeFocus, selectHistoryItem]);

  useEffect(() => {
    if (reloadRequest === 0) return;
    void reload();
  }, [reloadRequest, reload]);

  if (error !== null) {
    return <Hint tone="danger">{error}</Hint>;
  }

  if (commits.length === 0) {
    return <Hint tone="muted">{loading ? 'Loading commit history...' : 'No commits yet.'}</Hint>;
  }

  return (
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {rows.map((row) => (
        <HistoryItemRow
          key={row.commit.hash}
          row={row}
          gutterWidth={gutterWidth}
          expanded={selected === row.commit.hash}
          onToggle={() => selectHistoryItem(selected === row.commit.hash ? null : row.commit.hash)}
          localBranches={localBranches}
          onMutate={reload}
        />
      ))}
      {!done && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadPage(commits.length)}
          style={{
            width: '100%',
            height: scm.rowHeight,
            padding: 0,
            background: 'none',
            border: 'none',
            borderTop: `1px solid ${color.divider}`,
            color: color.textTertiary,
            fontFamily: font.sans,
            fontSize: font.size.caption,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
};

const Hint = ({
  children,
  tone,
}: {
  children: string;
  tone: 'danger' | 'muted';
}): JSX.Element => (
  <div
    style={{
      padding: space[4],
      color: tone === 'danger' ? color.danger : color.textTertiary,
      fontFamily: font.sans,
      fontSize: font.size.caption,
    }}
  >
    {children}
  </div>
);
