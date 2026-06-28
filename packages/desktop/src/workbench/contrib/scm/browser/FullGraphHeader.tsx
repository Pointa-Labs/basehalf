import type { JSX } from 'react';
import { color, font, radius, space } from '../../../browser/style/design.js';
import { HistoryRefPickerButton } from './HistoryRefPickerButton.js';
import type { GitScmService } from './gitScmService.js';
import type { ScmHistoryFilter } from './scmViewStore.js';

export const FullGraphHeader = ({
  onClose,
  count,
  loading,
  historyFilter,
  onHistoryFilter,
  gitService,
  showRemote,
  onToggleRemote,
  find,
  onFind,
  matchCount,
}: {
  onClose: () => void;
  count: number;
  loading: boolean;
  historyFilter: ScmHistoryFilter;
  onHistoryFilter: (filter: ScmHistoryFilter) => void;
  gitService: GitScmService;
  showRemote: boolean;
  onToggleRemote: () => void;
  find: string;
  onFind: (value: string) => void;
  matchCount: number | null;
}): JSX.Element => (
  <div
    style={{
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: space[2],
      height: 36,
      padding: `0 ${space[3]}px`,
      background: color.surfaceMuted,
      borderBottom: `1px solid ${color.border}`,
      fontFamily: font.sans,
    }}
  >
    <span style={{ fontWeight: font.weight.semibold, color: color.textPrimary }}>Git Graph</span>
    <span style={{ color: color.textTertiary, fontSize: font.size.micro }}>
      {loading ? 'Loading…' : `${count} commits`}
    </span>

    <HistoryRefPickerButton
      disabled={loading}
      filter={historyFilter}
      onFilter={onHistoryFilter}
      gitService={gitService}
      maxWidth={150}
      testId="full-graph-ref-picker"
    />
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space[1],
        color: color.textTertiary,
        fontSize: font.size.micro,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <input type="checkbox" checked={showRemote} onChange={onToggleRemote} />
      Remote branches
    </label>

    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: space[1] }}>
      <input
        value={find}
        onChange={(event) => onFind(event.target.value)}
        placeholder="Find commit…"
        aria-label="Find Commit"
        data-testid="graph-find"
        style={{
          width: 150,
          height: 24,
          boxSizing: 'border-box',
          background: color.bg,
          border: `1px solid ${color.border}`,
          borderRadius: radius.sm,
          color: color.textPrimary,
          fontFamily: font.sans,
          fontSize: font.size.micro,
          padding: `0 ${space[2]}px`,
          outline: 'none',
        }}
      />
      {matchCount !== null && (
        <span style={{ color: color.textTertiary, fontSize: font.size.micro, minWidth: 36 }}>
          {matchCount} matches
        </span>
      )}
      <button
        type="button"
        title="Close (Esc)"
        aria-label="Close Git Graph"
        onClick={onClose}
        style={{
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          borderRadius: radius.sm,
          cursor: 'pointer',
          color: color.textTertiary,
          fontSize: font.size.body,
        }}
      >
        ✕
      </button>
    </span>
  </div>
);
