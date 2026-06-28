import { type JSX, useEffect, useState } from 'react';
import { prompt } from '../../../browser/parts/dialogs/Dialog.js';
import { toast } from '../../../browser/parts/notifications/toastStore.js';
import { color, font, radius, shadow, space } from '../../../browser/style/design.js';
import { Button } from '../../../browser/ui/primitives/Button.js';
import { RebasePlanRow } from './RebasePlanRow.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import {
  type RebasePlanAction,
  type RebasePlanRow as RebasePlanRowModel,
  canUseRebaseAction,
  commitsToRebaseRows,
  keptRebaseRowCount,
  moveRebaseRow,
  rebasePlanItems,
  rewordRebaseRow,
  setRebaseRowAction,
} from './rebasePlannerModel.js';

/**
 * RebasePlanner — VS Code / Git Graph-style interactive rebase. Lists the commits
 * base..HEAD (oldest→newest, the replay order), each with an action (keep / drop /
 * fixup-into-previous / reword) and up/down reordering. "Apply" runs the all-or-
 * nothing git.rebaseInteractive: it replays the plan onto base, and on any conflict
 * aborts and leaves the branch untouched (the original stays in the reflog).
 */

export const RebasePlanner = ({
  base,
  onClose,
  onApplied,
  gitService: git = gitScmService,
}: {
  base: string;
  onClose: () => void;
  onApplied: () => void;
  gitService?: GitScmService;
}): JSX.Element => {
  const [rows, setRows] = useState<RebasePlanRowModel[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await git.log({
          ref: `${base}..HEAD`,
        });
        if (!cancelled) setRows(commitsToRebaseRows(r.commits));
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, git]);

  const setAction = (index: number, action: RebasePlanAction): void =>
    setRows((current) => (current === null ? current : setRebaseRowAction(current, index, action)));

  const reword = (index: number): void =>
    void (async () => {
      const row = rows?.[index];
      if (!row) return;
      const message = (
        await prompt({
          title: 'Reword commit message',
          label: 'New message',
          defaultValue: row.commit.subject,
        })
      )?.trim();
      if (message) {
        setRows((current) =>
          current === null ? current : rewordRebaseRow(current, index, message),
        );
      }
    })();

  const move = (index: number, direction: -1 | 1): void =>
    setRows((current) => (current === null ? current : moveRebaseRow(current, index, direction)));

  const selectAction = (index: number, action: RebasePlanAction): void => {
    if (action === 'reword') reword(index);
    else setAction(index, action);
  };

  const apply = (): void =>
    void (async () => {
      if (rows === null) return;
      setBusy(true);
      try {
        const res = await git.rebaseInteractive({
          base,
          items: rebasePlanItems(rows),
        });
        if (res.ok) {
          toast.success('Rebase complete.');
          onApplied();
          onClose();
        } else {
          toast.error('The rebase hit conflicts and was aborted (the branch is unchanged).');
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();

  const kept = keptRebaseRowCount(rows);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: color.backdrop,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
      }}
    >
      <div
        data-testid="rebase-planner"
        style={{
          width: 560,
          maxWidth: '92%',
          maxHeight: '80%',
          background: color.surface,
          border: `1px solid ${color.border}`,
          borderRadius: radius.lg,
          boxShadow: shadow.raised,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: font.sans,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: `${space[3]}px ${space[4]}px`,
            borderBottom: `1px solid ${color.divider}`,
          }}
        >
          <div style={{ fontSize: font.size.body, color: color.textPrimary }}>Rebase Commits</div>
          <div style={{ fontSize: font.size.micro, color: color.textTertiary, marginTop: 2 }}>
            Replays the commits below onto <code>{base.slice(0, 7)}</code> . Conflicts auto-abort
            and the branch is left untouched.
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: space[2] }}>
          {rows === null ? (
            <Muted>Loading commits…</Muted>
          ) : rows.length === 0 ? (
            <Muted>No commits after the selected base.</Muted>
          ) : (
            rows.map((row, i) => (
              <RebasePlanRow
                key={row.commit.hash}
                index={i}
                last={i === rows.length - 1}
                row={row}
                canFixup={canUseRebaseAction(rows, i, 'fixup')}
                onActionChange={selectAction}
                onMove={move}
              />
            ))
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: space[2],
            padding: `${space[3]}px ${space[4]}px`,
            borderTop: `1px solid ${color.divider}`,
          }}
        >
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || rows === null || kept === 0}
            onClick={apply}
          >
            Apply ({kept} commits)
          </Button>
        </div>
      </div>
    </div>
  );
};

const Muted = ({ children }: { children: string }): JSX.Element => (
  <div style={{ padding: space[4], color: color.textTertiary, fontSize: font.size.caption }}>
    {children}
  </div>
);
