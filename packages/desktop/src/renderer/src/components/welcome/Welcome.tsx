/**
 * Welcome — the surface shown in a window with no workspace open.
 *
 * One page, two emphases (see private-docs/welcome_page_spec/welcome-page.md):
 *   first-run  → identity hero + thesis + two doors + three beats + honesty +
 *                pairing footer. Job: teach + activate.
 *   returning  → "Welcome back" + a prominent recent list + Open a folder +
 *                pairing footer. Job: resume fast.
 *
 * Store-connected (no props): reads workspaces/current/openRoots and calls the
 * store/actions directly, like every other top-level component. App renders this
 * as the SOLE occupant of the working region when `current === null` — no
 * sidebar, no canvas — so the welcome is never two surfaces at once.
 *
 * NO card. The welcome is a structural STATE that stands in for the empty canvas,
 * not a transient overlay — so the content sits DIRECTLY on the canvas dot-grid as
 * a centered reading column, with no border / radius / elevation. A bordered,
 * shadow.raised surface here would be the exact silhouette of the modal /
 * recovery-alert tier (Dialog.tsx, the folder-missing panel in Canvas.tsx) — the
 * wrong costume for a place you stand in. That contrast is deliberate: recovery
 * IS an alert (a card), the welcome is NOT.
 */

import type { JSX } from 'react';
import { color, font, space } from '../../design.js';
import { createDemoAtDefault } from '../../lib/actions.js';
import { selectWelcomeView } from '../../lib/welcomeView.js';
import { useWorkspaceStore } from '../../store/workspace.js';
import { Button } from '../primitives/Button.js';
import { FolderDisclosure } from './FolderDisclosure.js';
import { HowItWorks } from './HowItWorks.js';
import { PairingFooter } from './PairingFooter.js';
import { RecentWorkspaces } from './RecentWorkspaces.js';
import { welcomeCopy } from './copy.js';

export const Welcome = (): JSX.Element => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.current);
  const openRoots = useWorkspaceStore((s) => s.openRoots);
  const busy = useWorkspaceStore((s) => s.busy);

  const { variant, recent } = selectWelcomeView(workspaces, current);
  const openFolder = (): void => void useWorkspaceStore.getState().pickAndAdd();
  const openDemo = (): void => void createDemoAtDefault();
  const openWorkspace = (name: string): void => void useWorkspaceStore.getState().use(name);

  return (
    // Two-layer scroll-and-center: the outer block scrolls when content exceeds
    // the viewport (so the hero never clips), the inner flex centers vertically
    // when there's room. min-height on the inner layer gives align-items:center
    // something to push against.
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        backgroundColor: color.bg,
        // The canvas dot texture, at a whisper. Content now sits directly on it
        // (no card), so the dot is dialed a hair below color.border — present at
        // the column's margins, invisible enough behind body text. This IS where
        // the user's canvas will be; the welcome stands on it, doesn't float over.
        backgroundImage: 'radial-gradient(#262626 1px, transparent 1px)',
        backgroundSize: '22px 22px',
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          minHeight: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${space[10]}px ${space[5]}px`,
        }}
      >
        {/* A centered reading column, not a box: maxWidth is a reading MEASURE so
            the thesis never sprawls on a wide window — there is no visible edge. */}
        <div style={{ maxWidth: 520, width: '100%' }}>
          {variant === 'returning' ? (
            <Returning
              recent={recent}
              openRoots={openRoots}
              busy={busy}
              onOpenFolder={openFolder}
              onOpenDemo={openDemo}
              onOpenWorkspace={openWorkspace}
            />
          ) : (
            <FirstRun busy={busy} onOpenFolder={openFolder} onOpenDemo={openDemo} />
          )}
        </div>
      </div>
    </div>
  );
};

const heroStyle = {
  fontSize: 26,
  fontWeight: font.weight.semibold,
  color: color.textPrimary,
  letterSpacing: -0.5,
} as const;

interface FirstRunProps {
  readonly busy: boolean;
  readonly onOpenFolder: () => void;
  readonly onOpenDemo: () => void;
}

const FirstRun = ({ busy, onOpenFolder, onOpenDemo }: FirstRunProps): JSX.Element => (
  <>
    <div style={{ ...heroStyle, marginBottom: space[3] }}>{welcomeCopy.wordmark}</div>
    <div
      style={{
        fontSize: font.size.body,
        color: color.textSecondary,
        lineHeight: 1.6,
        marginBottom: space[6],
      }}
    >
      {welcomeCopy.thesis}
    </div>

    <div style={{ display: 'flex', gap: space[2], alignItems: 'center', marginBottom: space[2] }}>
      <Button variant="primary" autoFocus disabled={busy} onClick={onOpenFolder}>
        {welcomeCopy.openFolder}
      </Button>
      <Button variant="default" disabled={busy} onClick={onOpenDemo}>
        {welcomeCopy.openDemo}
      </Button>
    </div>
    <div style={{ fontSize: font.size.caption, color: color.textTertiary, marginBottom: space[6] }}>
      {welcomeCopy.dropHint}
    </div>

    <div style={{ marginBottom: space[5] }}>
      <HowItWorks />
    </div>
    <FolderDisclosure />
    <PairingFooter />
  </>
);

interface ReturningProps extends FirstRunProps {
  readonly recent: ReturnType<typeof selectWelcomeView>['recent'];
  readonly openRoots: readonly string[];
  readonly onOpenWorkspace: (name: string) => void;
}

const Returning = ({
  recent,
  openRoots,
  busy,
  onOpenFolder,
  onOpenDemo,
  onOpenWorkspace,
}: ReturningProps): JSX.Element => (
  <>
    <div style={{ ...heroStyle, marginBottom: space[6] }}>{welcomeCopy.returningHero}</div>

    <div style={{ marginBottom: space[6] }}>
      <RecentWorkspaces
        recent={recent}
        openRoots={openRoots}
        busy={busy}
        onOpen={onOpenWorkspace}
      />
    </div>

    <div style={{ display: 'flex', gap: space[2], alignItems: 'center' }}>
      <Button variant="primary" autoFocus disabled={busy} onClick={onOpenFolder}>
        {welcomeCopy.openFolder}
      </Button>
      {/* Quiet secondary — the returning user knows the product, so the demo
          recedes to a ghost button (vs the first-run 'default'), but it keeps the
          shared hover/focus/disabled states instead of a hand-rolled link. */}
      <Button variant="ghost" disabled={busy} onClick={onOpenDemo}>
        {welcomeCopy.openDemoLink}
      </Button>
    </div>

    <PairingFooter />
  </>
);
