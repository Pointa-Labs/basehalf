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

import type { JSX } from 'react';
import { color, font, radius, shadow, space } from '../design.js';
import { Button } from './primitives/Button.js';

interface OnboardingProps {
  readonly onAddFolder: () => void;
}

export const Onboarding = ({ onAddFolder }: OnboardingProps): JSX.Element => (
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
          Welcome.
        </div>
        <div
          style={{
            fontSize: font.size.body,
            color: color.textSecondary,
            marginBottom: space[6],
            lineHeight: 1.6,
          }}
        >
          A canvas for any file — PDFs, notes, images. Drop a folder; everything stays where it is,
          organized the way you think.
        </div>

        <div style={{ marginBottom: space[6] }}>
          <Button variant="primary" onClick={onAddFolder}>
            Add a folder to begin
          </Button>
        </div>

        <Step n={1} title="Pick a folder">
          Your files stay where they are. BaseHalf only adds a hidden{' '}
          <code style={codeStyle}>.bh/</code> directory inside.
        </Step>
        <Step n={2} title="Open a file">
          Click any file in the sidebar or its badge on the canvas to preview. Markdown opens in a
          block editor; images, PDFs, audio, video each in their viewer.
        </Step>
        <Step n={3} title="Describe it for AI">
          In the Badge panel above the file content, write a prompt — what the AI should know about
          this file. Example:{' '}
          <em style={{ color: color.textSecondary }}>"Chapter 3 — focus on theorem 2."</em>
        </Step>
        <Step n={4} title="Connect things" last>
          Drag from one badge to another to link them. Add a note on the link to explain why. The
          graph is written to <code style={codeStyle}>.bh/</code> so any AI agent can read it.
        </Step>

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
          BaseHalf works fully standalone. Pair it with Claude Code or any AI agent on the left half
          of your screen for compound thinking.
        </div>
      </div>
    </div>
  </div>
);

const codeStyle = {
  fontFamily: font.mono,
  fontSize: '0.92em',
  background: color.surfaceMuted,
  padding: '1px 5px',
  borderRadius: 3,
  border: `1px solid ${color.divider}`,
} as const;

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
