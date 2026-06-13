import { type JSX, useCallback, useEffect, useState } from 'react';
import { color, font, radius, space } from '../design.js';
import { Button } from './primitives/Button.js';
import { PopoverSurface, usePopover } from './primitives/Popover.js';

interface Proposal {
  readonly line: number;
  readonly raw: string;
  readonly file?: string;
  readonly target?: string;
  readonly reason?: string;
}

/**
 * The agent → human WRITE-BACK surface. While working, an agent appends
 * observations to `.bh/cache/proposals.md` (e.g. "auth.ts -> session.ts: touching
 * auth breaks the session test"). Without a receiving end those notes rot in a
 * gitignored cache file the user must remember to open — so the loop the protocol
 * promises (human curates → agent reads → agent proposes → human triages) only
 * built half a circle. This chip is the other half: it surfaces "N agent
 * proposals", and the panel lets the user read each one and dismiss it once
 * triaged (adoption — turning it into a real badge note — stays a human action
 * through the normal annotation UI; the badge pool is always human-authored).
 *
 * proposals.md is written by an EXTERNAL agent, so the watcher (which ignores
 * `.bh/`) never signals it — a light poll is how the count stays live.
 */
export const ProposalsChip = ({ current }: { current: string | null }): JSX.Element | null => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const popover = usePopover({ align: 'right', gap: 6 });

  const reload = useCallback(async () => {
    try {
      const r = (await window.bh.run('proposals.list', {})) as { proposals: Proposal[] };
      setProposals(r.proposals);
    } catch {
      /* transient — keep the last known list */
    }
  }, []);

  // Reload on workspace change + poll (proposals.md is watcher-ignored).
  useEffect(() => {
    if (!current) {
      setProposals([]);
      return;
    }
    void reload();
    const id = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(id);
  }, [current, reload]);

  const dismiss = useCallback(async (line: number) => {
    try {
      const r = (await window.bh.run('proposals.dismiss', { line })) as {
        proposals: Proposal[];
      };
      setProposals(r.proposals);
    } catch {
      /* keep the list; a transient failure shouldn't drop the panel */
    }
  }, []);

  const clearAll = useCallback(async () => {
    try {
      await window.bh.run('proposals.clear', {});
      setProposals([]);
      popover.close();
    } catch {
      /* no-op */
    }
  }, [popover]);

  if (proposals.length === 0) return null;

  const count = proposals.length;
  return (
    <div style={{ display: 'inline-flex' }}>
      <button
        type="button"
        ref={popover.triggerRef}
        onClick={popover.toggle}
        data-testid="proposals-chip"
        title="Observations your agent wrote back — click to read and triage"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: space[1],
          padding: `${space[1]}px ${space[2]}px`,
          border: `1px solid ${color.accentSoft}`,
          borderRadius: radius.pill,
          background: color.surface,
          color: color.textSecondary,
          fontFamily: font.sans,
          fontSize: font.size.caption,
          cursor: 'pointer',
        }}
      >
        <span style={{ color: color.accent, fontWeight: 600 }}>{count}</span>
        agent {count === 1 ? 'proposal' : 'proposals'}
      </button>
      {popover.open && (
        <PopoverSurface
          coords={popover.coords}
          floatingRef={popover.floatingRef}
          role="dialog"
          style={{ minWidth: 320, maxWidth: 460, maxHeight: 360, overflow: 'auto' }}
        >
          <div
            style={{ padding: space[3], display: 'flex', flexDirection: 'column', gap: space[2] }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: space[2],
              }}
            >
              <span
                style={{
                  fontFamily: font.sans,
                  fontSize: font.size.caption,
                  color: color.textTertiary,
                }}
              >
                Your agent's observations — triage into real notes, then dismiss.
              </span>
              <Button variant="ghost" size="sm" onClick={() => void clearAll()}>
                Clear all
              </Button>
            </div>
            {proposals.map((p) => (
              <div
                key={p.line}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: space[2],
                  padding: `${space[2]}px`,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.md,
                  background: color.bg,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  {p.file !== undefined && p.target !== undefined ? (
                    <div
                      style={{
                        fontFamily: font.mono,
                        fontSize: font.size.caption,
                        color: color.textSecondary,
                      }}
                    >
                      {p.file} <span style={{ color: color.textTertiary }}>→</span> {p.target}
                    </div>
                  ) : (
                    <div
                      style={{
                        fontFamily: font.mono,
                        fontSize: font.size.caption,
                        color: color.textSecondary,
                        wordBreak: 'break-word',
                      }}
                    >
                      {p.raw}
                    </div>
                  )}
                  {p.reason !== undefined && (
                    <div
                      style={{
                        marginTop: 2,
                        fontFamily: font.sans,
                        fontSize: font.size.caption,
                        color: color.textTertiary,
                        lineHeight: 1.45,
                      }}
                    >
                      {p.reason}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void dismiss(p.line)}
                  title="Dismiss this proposal"
                >
                  Dismiss
                </Button>
              </div>
            ))}
          </div>
        </PopoverSurface>
      )}
    </div>
  );
};
