import { Fragment, type JSX, type ReactNode, useState } from 'react';
import { color, font, layout, radius, space, transition } from '../design.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { FileGlyph, badgeType } from './FileGlyph.js';
import { PopoverSurface, usePopover } from './primitives/Popover.js';

/** Small house glyph for the workspace-root crumb (the trail's anchor). */
const HomeGlyph = (): JSX.Element => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden
    style={{ flexShrink: 0, marginTop: -1 }}
  >
    <path
      d="M2.5 7L8 2.5 13.5 7M3.75 6v6.5h8.5V6"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const crumbPadding = `${space[0.5]}px ${space[1]}px`;

/**
 * The workspace-root crumb — the trail's anchor, always carrying the house
 * glyph. It's a single button whose action follows your location:
 *   • at root (you're already home) → opens the working-folder switcher;
 *   • anywhere deeper → links straight back to root.
 * One affordance, no separate ▾ — "go home" and "switch folder" never compete
 * for the same click because they can't both apply at once.
 */
const HomeCrumb = ({
  label,
  rootIsCurrent,
}: {
  label: string;
  rootIsCurrent: boolean;
}): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const use = useWorkspaceStore((s) => s.use);
  const pickAndAdd = useWorkspaceStore((s) => s.pickAndAdd);
  const navigateToFolder = useWorkspaceStore((s) => s.navigateToFolder);
  const { open, toggle, close, triggerRef, floatingRef, coords } = usePopover({ align: 'left' });
  const [hover, setHover] = useState(false);

  const pick = (name: string): void => {
    close();
    if (name === current) void navigateToFolder(null);
    else void use(name);
  };

  const base = rootIsCurrent ? color.textPrimary : color.textSecondary;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={rootIsCurrent ? toggle : () => void navigateToFolder(null)}
        aria-expanded={rootIsCurrent ? open : undefined}
        aria-haspopup={rootIsCurrent ? 'menu' : undefined}
        data-testid="breadcrumb-home"
        title={rootIsCurrent ? 'Switch working folder' : `Back to ${label}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: space[1],
          flexShrink: 0,
          maxWidth: 220,
          padding: crumbPadding,
          fontSize: font.size.ui,
          fontFamily: font.sans,
          fontWeight: rootIsCurrent ? font.weight.semibold : font.weight.medium,
          color: hover || open ? color.textPrimary : base,
          background: hover || open ? color.divider : 'transparent',
          border: 'none',
          outline: 'none',
          borderRadius: radius.sm,
          cursor: 'pointer',
          letterSpacing: rootIsCurrent ? -0.1 : 0,
          transition: transition(['color', 'background']),
        }}
      >
        <HomeGlyph />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </button>
      {rootIsCurrent && open && (
        <PopoverSurface
          coords={coords}
          floatingRef={floatingRef}
          role="menu"
          style={{ minWidth: 240, maxWidth: 380, maxHeight: 360, overflowY: 'auto' }}
        >
          {workspaces.map((ws) => (
            <SwitcherItem
              key={ws.name}
              name={ws.name}
              path={ws.path}
              active={ws.name === current}
              onClick={() => pick(ws.name)}
            />
          ))}
          <div style={{ height: 1, background: color.border, margin: `${space[1]}px 0` }} />
          <SwitcherRow
            testId="workspace-open-folder"
            onClick={() => {
              close();
              void pickAndAdd();
            }}
          >
            <span aria-hidden style={{ color: color.textGhost, width: 13, textAlign: 'center' }}>
              +
            </span>
            <span style={{ fontSize: font.size.ui, color: color.textSecondary }}>Open folder…</span>
          </SwitcherRow>
        </PopoverSurface>
      )}
    </>
  );
};

/** A bare clickable row inside the switcher popover (shared hover treatment). */
const SwitcherRow = ({
  children,
  onClick,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  testId?: string;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[1.5],
        width: '100%',
        textAlign: 'left',
        padding: `${space[1.5]}px ${space[2]}px`,
        border: 'none',
        outline: 'none',
        borderRadius: radius.sm,
        background: hover ? color.divider : 'transparent',
        cursor: 'pointer',
        fontFamily: font.sans,
      }}
    >
      {children}
    </button>
  );
};

const SwitcherItem = ({
  name,
  path,
  active,
  onClick,
}: {
  name: string;
  path: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element => (
  <SwitcherRow testId="workspace-switcher-item" onClick={onClick}>
    <span
      aria-hidden
      style={{ width: 13, flexShrink: 0, color: color.accent, fontSize: font.size.ui }}
    >
      {active ? '✓' : ''}
    </span>
    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span
        style={{
          fontSize: font.size.ui,
          color: active ? color.textPrimary : color.textSecondary,
          fontWeight: active ? font.weight.semibold : font.weight.regular,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      <span
        style={{
          fontSize: font.size.micro,
          color: color.textGhost,
          fontFamily: font.mono,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {path}
      </span>
    </span>
  </SwitcherRow>
);

// VS Code's breadcrumb separator is a chevron (codicon chevron-right), not a slash.
const Separator = (): JSX.Element => (
  <svg
    width={11}
    height={11}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color.textGhost}
    strokeWidth={1.5}
    aria-hidden
    style={{ flexShrink: 0 }}
  >
    <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Per-segment icon — a folder glyph for ancestors, the file-type glyph for the
 *  leaf (VS Code shows an icon on every breadcrumb segment). */
const CrumbIcon = ({ name, kind }: { name: string; kind: 'folder' | 'file' }): JSX.Element => (
  <span style={{ flexShrink: 0, display: 'inline-flex' }}>
    <FileGlyph
      type={kind === 'folder' ? 'folder' : badgeType(name, false)}
      tone={color.textTertiary}
      size={13}
    />
  </span>
);

/** The trailing crumb — where you already are. Plain, non-clickable text. */
const CurrentCrumb = ({ label, kind }: { label: string; kind: 'folder' | 'file' }): JSX.Element => (
  <span
    data-testid="breadcrumb-current"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: space[1],
      padding: crumbPadding,
      fontSize: font.size.ui,
      fontWeight: font.weight.semibold,
      color: color.textPrimary,
      letterSpacing: -0.1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: 280,
      flexShrink: 1,
      minWidth: 0,
    }}
  >
    <CrumbIcon name={label} kind={kind} />
    {label}
  </span>
);

/** A crumb link — scopes the canvas to one of the ancestor folders in the trail. */
const LinkCrumb = ({ label, onClick }: { label: string; onClick: () => void }): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Go to ${label}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space[1],
        flexShrink: 0,
        maxWidth: 200,
        padding: crumbPadding,
        fontSize: font.size.ui,
        fontFamily: font.sans,
        fontWeight: font.weight.medium,
        color: hover ? color.textPrimary : color.textSecondary,
        background: hover ? color.divider : 'transparent',
        border: 'none',
        outline: 'none',
        borderRadius: radius.sm,
        cursor: 'pointer',
        transition: transition(['color', 'background']),
      }}
    >
      <CrumbIcon name={label} kind="folder" />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </button>
  );
};

/**
 * The breadcrumb — one document-header bar for EVERY context: the main canvas
 * (`workspace`), a scoped folder (`workspace / folder / …`), and an open file
 * (`workspace / folder / … / file.md`). The {@link HomeCrumb} leads the bar —
 * a house glyph whose click follows your location (switch working folder at
 * root, back to root anywhere deeper); ancestor folders are links; the trailing
 * segment is plain text. There is deliberately no ✕ — you leave a document by
 * clicking an ancestor crumb (or Esc / ⌘W).
 *
 * `actions` renders trailing controls flush-right inside the bar (the canvas
 * passes its compact "Edit prompt" control there).
 */
export const Breadcrumb = ({ actions }: { actions?: ReactNode }): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const folderScope = useWorkspaceStore((s) => s.folderScope);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const navigateToFolder = useWorkspaceStore((s) => s.navigateToFolder);

  let folderPath = '';
  let leaf: string | null = null;
  if (openFile !== null) {
    const slash = openFile.lastIndexOf('/');
    folderPath = slash === -1 ? '' : openFile.slice(0, slash);
    leaf = slash === -1 ? openFile : openFile.slice(slash + 1);
  } else if (folderScope !== null) {
    folderPath = folderScope;
  }

  const folderCrumbs: { label: string; scope: string }[] = [];
  if (folderPath) {
    let acc = '';
    for (const part of folderPath.split('/')) {
      acc = acc ? `${acc}/${part}` : part;
      folderCrumbs.push({ label: part, scope: acc });
    }
  }
  const rootIsCurrent = folderCrumbs.length === 0 && leaf === null;
  const wsLabel = current ?? 'Workspace';

  return (
    <nav
      data-testid="breadcrumb"
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[0.5],
        // One height with the terminal's tab strip (layout.chromeBarHeight) so the
        // two top bands sit flush as a single strip; horizontal padding only.
        height: layout.chromeBarHeight,
        padding: `0 ${space[3]}px`,
        background: color.surfaceMuted,
        borderBottom: `1px solid ${color.border}`,
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
        fontFamily: font.sans,
      }}
    >
      <HomeCrumb label={wsLabel} rootIsCurrent={rootIsCurrent} />
      {folderCrumbs.map((crumb, i) => {
        const isLast = leaf === null && i === folderCrumbs.length - 1;
        return (
          <Fragment key={`${crumb.scope}`}>
            <Separator />
            {isLast ? (
              <CurrentCrumb label={crumb.label} kind="folder" />
            ) : (
              <LinkCrumb label={crumb.label} onClick={() => void navigateToFolder(crumb.scope)} />
            )}
          </Fragment>
        );
      })}
      {leaf !== null && (
        <>
          <Separator />
          <CurrentCrumb label={leaf} kind="file" />
        </>
      )}
      {actions !== undefined && (
        <div
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: space[1],
            paddingLeft: space[3],
          }}
        >
          {actions}
        </div>
      )}
    </nav>
  );
};
