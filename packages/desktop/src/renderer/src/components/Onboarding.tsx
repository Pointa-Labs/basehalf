/**
 * Onboarding card — shown on the canvas when no workspace is open.
 *
 * Replaces a wall-of-text empty state with a centered, breathing card
 * that explains the product in one line, names the primary action,
 * and walks through the first run in compact numbered steps.
 *
 * Design notes:
 * - Centered card sitting on the page background, not the canvas grid
 *   (so it doesn't fight the dot pattern).
 * - A single primary CTA (Add folder) — no decision paralysis.
 * - The 屏幕注意力 + standalone thesis sits at the bottom as a quiet aside,
 *   so the reader's eye lands on action first.
 */

import type { WorkspaceEntry } from '@basehalf/core';
import { type JSX, useState } from 'react';
import { color, font, radius, shadow, space } from '../design.js';
import { tildifyPath } from '../lib/actions.js';
import { Button } from './primitives/Button.js';

interface OnboardingProps {
  readonly onAddFolder: () => void;
  readonly onTryDemo: () => void;
  /** Registered workspaces, most-recent-first — the returning-user "pick up where
   *  you left off" list. Empty on a true first run (the numbered steps show then). */
  readonly recent?: readonly WorkspaceEntry[];
  /** Open a registered workspace by name (focus its window if already open, else a
   *  new window; reuses THIS welcome window). */
  readonly onOpenWorkspace?: (name: string) => void;
  /** Workspace paths currently shown in another window — those rows get an "Open"
   *  marker so the user knows clicking focuses that window rather than opening anew. */
  readonly openRoots?: readonly string[];
}

/** Cap the welcome list so the card never grows unbounded — ⌘K is the full list. */
const MAX_RECENT = 8;

export const Onboarding = ({
  onAddFolder,
  onTryDemo,
  recent = [],
  onOpenWorkspace,
  openRoots = [],
}: OnboardingProps): JSX.Element => {
  const hasRecent = recent.length > 0;
  const openSet = new Set(openRoots.map((p) => p.toLowerCase()));
  return (
    // Two-layer scroll-and-center pattern: outer block scrolls when content
    // exceeds the viewport (so the title never clips), inner flex centers
    // vertically when there's room. Without min-height on the inner layer,
    // align-items:center has nothing to push against and the card snaps to
    // the top.
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: color.bg,
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          minHeight: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${space[6]}px ${space[5]}px ${space[8]}px`,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: '100%',
            background: color.surface,
            border: `1px solid ${color.border}`,
            borderRadius: radius.xl,
            padding: `${space[8]}px ${space[8]}px ${space[6]}px`,
            boxShadow: shadow.card,
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: font.weight.semibold,
              color: color.textPrimary,
              marginBottom: space[2],
              letterSpacing: -0.5,
            }}
          >
            {hasRecent ? 'Welcome back.' : 'Welcome.'}
          </div>
          <div
            style={{
              fontSize: font.size.body,
              color: color.textSecondary,
              marginBottom: space[6],
              lineHeight: 1.6,
            }}
          >
            A canvas for any file — PDFs, notes, images. Drop a folder; everything stays where it
            is, organized the way you think.
          </div>

          {hasRecent && (
            <div style={{ marginBottom: space[6] }}>
              <div style={sectionLabelStyle}>Recent workspaces</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {recent.slice(0, MAX_RECENT).map((w) => (
                  <RecentRow
                    key={w.path}
                    name={w.name}
                    path={w.path}
                    isOpen={openSet.has(w.path.toLowerCase())}
                    onOpen={() => onOpenWorkspace?.(w.name)}
                  />
                ))}
              </div>
            </div>
          )}

          <div
            style={{ marginBottom: space[6], display: 'flex', gap: space[2], alignItems: 'center' }}
          >
            <Button variant="primary" onClick={onAddFolder}>
              {hasRecent ? 'Add a folder' : 'Add a folder to begin'}
            </Button>
            <Button variant="ghost" onClick={onTryDemo}>
              Try a demo workspace
            </Button>
          </div>

          {!hasRecent && (
            <>
              <Step n={1} title="Pick a folder">
                Your files stay where they are — each appears as a card on the canvas. BaseHalf adds
                a hidden <code style={codeStyle}>.bh/</code> directory, plus two small instruction
                files (<code style={codeStyle}>CLAUDE.md</code>,{' '}
                <code style={codeStyle}>AGENTS.md</code>) that tell AI agents where your notes live.
                Already have them? A short section is appended.
              </Step>
              <Step n={2} title="Open a file">
                Click any file in the sidebar or its card on the canvas to preview. Markdown opens
                in a block editor; images, PDFs, audio, video each in their viewer.
              </Step>
              <Step n={3} title="Describe it for AI">
                Use a File Badge to write what agents should know about a file. Example:{' '}
                <em style={{ color: color.textSecondary }}>"Chapter 3: focus on theorem 2."</em>
              </Step>
              <Step n={4} title="Connect things" last>
                Drag from a card's right edge — a dot appears on hover — to another card to link
                them. Add a note on the link to explain why. The graph is written to{' '}
                <code style={codeStyle}>.bh/</code> so any AI agent can read it.
              </Step>
            </>
          )}

          <div
            style={{
              marginTop: space[6],
              paddingTop: space[4],
              borderTop: `1px solid ${color.divider}`,
              fontSize: font.size.caption,
              color: color.textTertiary,
              lineHeight: 1.5,
            }}
          >
            BaseHalf is the workspace half. Pair it with Claude Code (or any AI agent) on the left
            half of your screen — the agent reads <code style={codeStyle}>.bh/</code> to see what
            you're focused on and how your files relate.
            <div style={{ marginTop: space[2] }}>
              Press <code style={codeStyle}>⌘K</code> anywhere to switch workspace, open a file, or
              run an action.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const codeStyle = {
  fontFamily: font.mono,
  fontSize: '0.92em',
  background: color.surfaceMuted,
  padding: '1px 5px',
  borderRadius: 3,
  border: `1px solid ${color.divider}`,
} as const;

const sectionLabelStyle = {
  fontSize: font.size.caption,
  fontWeight: font.weight.semibold,
  color: color.textTertiary,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  marginBottom: space[2],
} as const;

const openPillStyle = {
  fontSize: 10,
  fontWeight: font.weight.semibold,
  color: color.accent,
  background: color.accentSofter,
  borderRadius: 4,
  padding: '1px 6px',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  flexShrink: 0,
} as const;

/** One recent-workspace row in the welcome card — name (+ an "Open" pill when a
 *  window already shows it) over its tildified path. Click opens-or-focuses it. */
const RecentRow = ({
  name,
  path,
  isOpen,
  onOpen,
}: {
  name: string;
  path: string;
  isOpen: boolean;
  onOpen: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        alignItems: 'flex-start',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        padding: `${space[2]}px ${space[3]}px`,
        background: hover ? color.surfaceMuted : 'transparent',
        border: `1px solid ${hover ? color.border : 'transparent'}`,
        borderRadius: 8,
        fontFamily: font.sans,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: space[2], maxWidth: '100%' }}>
        <span
          style={{
            fontSize: font.size.body,
            fontWeight: font.weight.medium,
            color: color.textPrimary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        {isOpen && <span style={openPillStyle}>Open</span>}
      </span>
      <span
        style={{
          fontSize: font.size.caption,
          color: color.textTertiary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
      >
        {tildifyPath(path)}
      </span>
    </button>
  );
};

const Step = ({
  n,
  title,
  children,
  last,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}): JSX.Element => (
  <div
    style={{
      display: 'flex',
      gap: space[3],
      marginBottom: last ? 0 : space[4],
    }}
  >
    <div
      aria-hidden
      style={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        background: color.accentSofter,
        color: color.accent,
        fontSize: font.size.caption,
        fontWeight: font.weight.semibold,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginTop: 1,
      }}
    >
      {n}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: font.size.body,
          fontWeight: font.weight.medium,
          color: color.textPrimary,
          marginBottom: 2,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: font.size.caption,
          color: color.textSecondary,
          lineHeight: 1.55,
        }}
      >
        {children}
      </div>
    </div>
  </div>
);
