import { type JSX, useCallback, useEffect, useState } from 'react';
import { color, font, radius, space } from '../../../browser/style/design.js';
import { Button } from '../../../browser/ui/primitives/Button.js';
import { textFileService } from '../../../services/textfile/browser/textFileService.js';
import { gitScmService } from '../../scm/browser/gitScmService.js';
import { useGitStatusStore } from '../../scm/browser/gitStatusStore.js';
import {
  type ConflictBlock,
  type ConflictChoice,
  findConflicts,
  resolveConflict,
} from './mergeConflict.js';

/**
 * MergeEditor — VS Code's 3-way merge editor: the conflicted file shown as
 * Current (ours) ↔ Incoming (theirs) read-only panes on top, and an editable
 * Result below. Each remaining conflict offers Accept Current / Incoming / Both,
 * which rewrites that block in the working-tree file (resolveConflict) and saves.
 * When no markers remain, "Complete Merge" stages the file.
 *
 * Sides come from git index stages 2/3 (git.conflictStages); the result is the
 * working-tree file. Read-modify-write goes through textFileService — the disk
 * file stays the truth, same as the inline conflict UI this complements.
 */

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const MergeEditor = ({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}): JSX.Element => {
  const [ours, setOurs] = useState<string | null>(null);
  const [theirs, setTheirs] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useGitStatusStore((s) => s.refresh);
  const name = path.slice(path.lastIndexOf('/') + 1);

  const load = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      const st = await gitScmService.conflictStages(path);
      setOurs(st.ours ?? '');
      setTheirs(st.theirs ?? '');
      const f = await textFileService.read(path);
      setResult(f.content ?? '');
    } catch (e) {
      setErr(msg(e));
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);

  const blocks = result !== null ? findConflicts(result) : [];

  const accept = (block: ConflictBlock, choice: ConflictChoice): void =>
    void (async () => {
      if (result === null) return;
      const lines = result.split('\n');
      const replacement = resolveConflict(result, block, choice).split('\n');
      const next = [
        ...lines.slice(0, block.startLine - 1),
        ...replacement,
        ...lines.slice(block.endLine),
      ].join('\n');
      try {
        await textFileService.write(path, next);
        setResult(next);
        await refresh();
      } catch (e) {
        setErr(msg(e));
      }
    })();

  const markResolved = (): void =>
    void (async () => {
      try {
        await gitScmService.stage([path]);
        await refresh();
        onClose();
      } catch (e) {
        setErr(msg(e));
      }
    })();

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
        <span style={{ color: color.textTertiary }}>Merge Editor</span>
        <span style={{ color: blocks.length > 0 ? color.warning : color.success }}>
          {blocks.length > 0 ? `${blocks.length} conflict(s) to resolve` : 'No conflict markers'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: space[2] }}>
          <Button variant="primary" size="sm" disabled={blocks.length > 0} onClick={markResolved}>
            Complete Merge
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </span>
      </div>
      {err !== null && (
        <div
          style={{
            padding: `${space[1]}px ${space[3]}px`,
            color: color.danger,
            fontFamily: font.sans,
            fontSize: font.size.micro,
            flexShrink: 0,
          }}
        >
          {err}
        </div>
      )}
      {/* Top: the two sides, read-only. Bottom: the editable result. */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          borderBottom: `1px solid ${color.divider}`,
        }}
      >
        <SidePane title="Current (Ours)" tone={color.success} text={ours} />
        <div style={{ width: 1, background: color.divider }} />
        <SidePane title="Incoming (Theirs)" tone={color.accent} text={theirs} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <PaneTitle>Result</PaneTitle>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <ResultView text={result} blocks={blocks} onAccept={accept} />
        </div>
      </div>
    </div>
  );
};

const PaneTitle = ({ children }: { children: JSX.Element | string }): JSX.Element => (
  <div
    style={{
      flexShrink: 0,
      padding: `${space[1]}px ${space[3]}px`,
      background: color.surfaceMuted,
      borderBottom: `1px solid ${color.divider}`,
      color: color.textTertiary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      fontWeight: font.weight.semibold,
      letterSpacing: font.trackedCaps,
      textTransform: 'uppercase',
    }}
  >
    {children}
  </div>
);

const SidePane = ({
  title,
  tone,
  text,
}: {
  title: string;
  tone: string;
  text: string | null;
}): JSX.Element => (
  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
    <PaneTitle>
      <span style={{ color: tone }}>{title}</span>
    </PaneTitle>
    <pre
      style={{
        flex: 1,
        minHeight: 0,
        margin: 0,
        overflow: 'auto',
        padding: space[2],
        fontFamily: font.mono,
        fontSize: 12,
        lineHeight: '18px',
        color: color.textPrimary,
        background: color.bg,
        whiteSpace: 'pre',
      }}
    >
      {text ?? '(missing)'}
    </pre>
  </div>
);

// The result file with each remaining conflict tinted + an Accept toolbar above it.
const ResultView = ({
  text,
  blocks,
  onAccept,
}: {
  text: string | null;
  blocks: ConflictBlock[];
  onAccept: (b: ConflictBlock, c: ConflictChoice) => void;
}): JSX.Element => {
  if (text === null) return <Note>Loading…</Note>;
  const lines = text.split('\n');
  const startAt = new Map(blocks.map((b) => [b.startLine, b]));
  const inBlock = (n: number): ConflictBlock | undefined =>
    blocks.find((b) => n >= b.startLine && n <= b.endLine);
  const sideTint = (n: number, b: ConflictBlock): string => {
    const curEnd = (b.baseLine ?? b.sepLine) - 1;
    if (n > b.startLine && n <= curEnd) return `${color.success}1a`;
    if (n > b.sepLine && n < b.endLine) return `${color.accent}1a`;
    return `${color.danger}14`; // the marker lines themselves
  };
  return (
    <div
      data-testid="merge-result"
      style={{
        fontFamily: font.mono,
        fontSize: 12,
        lineHeight: '18px',
        background: color.bg,
        whiteSpace: 'pre',
      }}
    >
      {lines.map((line, i) => {
        const n = i + 1;
        const block = startAt.get(n);
        const b = inBlock(n);
        return (
          <div key={`${n}:${line}`}>
            {block && (
              <div
                style={{
                  display: 'flex',
                  gap: space[1],
                  padding: `2px ${space[2]}px`,
                  background: color.surfaceMuted,
                }}
              >
                <AcceptBtn label="Accept Current" onClick={() => onAccept(block, 'current')} />
                <AcceptBtn label="Accept Incoming" onClick={() => onAccept(block, 'incoming')} />
                <AcceptBtn label="Accept Both" onClick={() => onAccept(block, 'both')} />
              </div>
            )}
            <div
              style={{ padding: `0 ${space[2]}px`, background: b ? sideTint(n, b) : 'transparent' }}
            >
              {line === '' ? ' ' : line}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const AcceptBtn = ({ label, onClick }: { label: string; onClick: () => void }): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: `1px ${space[2]}px`,
      background: color.surface,
      border: `1px solid ${color.border}`,
      borderRadius: radius.sm,
      color: color.accent,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      cursor: 'pointer',
    }}
  >
    {label}
  </button>
);

const Note = ({ children }: { children: string }): JSX.Element => (
  <div
    style={{ padding: space[4], color: color.textTertiary, fontFamily: font.sans, fontSize: 12 }}
  >
    {children}
  </div>
);
