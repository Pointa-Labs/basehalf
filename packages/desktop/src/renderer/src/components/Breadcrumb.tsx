import { Fragment, type JSX } from 'react';
import { color, font, radius, shadow, space, transition } from '../design.js';
import { useWorkspaceStore } from '../store/workspace.js';

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

type Crumb = {
  label: string;
  // `string` / `null` → a link that navigates there (`null` = workspace root).
  // `undefined` → the current location (the trailing crumb), shown as plain text.
  scope: string | null | undefined;
};

/**
 * Breadcrumb for the open document / scoped folder. The trail is
 * `workspace / folder / … / leaf`: every ancestor segment is a button that jumps
 * there (closing the editor when one is open, via `navigateToFolder`), and the
 * trailing segment — the file you're reading or the folder you're in — is plain,
 * non-clickable text. It replaces both the old close-button bar (open file) and
 * the "← /path" back button (folder scope); there is deliberately no ✕ — you
 * leave a document by clicking an ancestor crumb (or Esc / ⌘W).
 *
 * Renders `null` at the workspace root with nothing open, mirroring how a
 * top-level page shows no trail.
 *
 * Two looks via `variant`: `bar` is a docked top strip (the editor header),
 * `floating` is a raised pill that hovers over the spatial canvas.
 */
export const Breadcrumb = ({
  variant = 'bar',
}: {
  variant?: 'bar' | 'floating';
}): JSX.Element | null => {
  const current = useWorkspaceStore((s) => s.current);
  const folderScope = useWorkspaceStore((s) => s.folderScope);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const navigateToFolder = useWorkspaceStore((s) => s.navigateToFolder);

  // The folder ancestry to walk + the trailing leaf. A file → its dir chain plus
  // the filename as a plain leaf; a bare folder scope → its chain with the
  // deepest folder AS the current location. Root with nothing open → no trail.
  let folderPath: string;
  let leaf: string | null;
  if (openFile !== null) {
    const slash = openFile.lastIndexOf('/');
    folderPath = slash === -1 ? '' : openFile.slice(0, slash);
    leaf = slash === -1 ? openFile : openFile.slice(slash + 1);
  } else if (folderScope !== null) {
    folderPath = folderScope;
    leaf = null;
  } else {
    return null;
  }

  const crumbs: Crumb[] = [{ label: current ?? 'Workspace', scope: null }];
  if (folderPath) {
    let acc = '';
    for (const part of folderPath.split('/')) {
      acc = acc ? `${acc}/${part}` : part;
      crumbs.push({ label: part, scope: acc });
    }
  }
  if (leaf !== null) crumbs.push({ label: leaf, scope: undefined });
  // The trailing crumb is always the current location — never a link (covers the
  // folder-scope case, where the deepest folder is where you already are).
  const last = crumbs[crumbs.length - 1];
  if (last !== undefined) last.scope = undefined;

  const floating = variant === 'floating';
  return (
    <nav
      data-testid="breadcrumb"
      aria-label="Breadcrumb"
      style={{
        display: floating ? 'inline-flex' : 'flex',
        alignItems: 'center',
        gap: space[0.5],
        padding: floating ? `${space[1]}px ${space[2]}px` : `${space[1.5]}px ${space[3]}px`,
        background: floating ? color.surface : color.surfaceMuted,
        border: floating ? `1px solid ${color.borderStrong}` : undefined,
        borderBottom: floating ? undefined : `1px solid ${color.border}`,
        borderRadius: floating ? radius.md : undefined,
        boxShadow: floating ? shadow.raised : undefined,
        flexShrink: 0,
        minWidth: 0,
        maxWidth: floating ? 480 : undefined,
        overflow: 'hidden',
        fontFamily: font.sans,
      }}
    >
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        const isHome = i === 0;
        return (
          <Fragment key={`${i}:${crumb.label}`}>
            {i > 0 && (
              <span
                aria-hidden
                style={{ color: color.textGhost, flexShrink: 0, fontSize: font.size.ui }}
              >
                /
              </span>
            )}
            {crumb.scope === undefined ? (
              <span
                data-testid="breadcrumb-current"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: space[1],
                  padding: `${space[0.5]}px ${space[1]}px`,
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
                {isHome && <HomeGlyph />}
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void navigateToFolder(crumb.scope ?? null)}
                title={isHome ? `Back to ${crumb.label}` : `Go to ${crumb.label}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: space[1],
                  flexShrink: 0,
                  maxWidth: 200,
                  padding: `${space[0.5]}px ${space[1]}px`,
                  fontSize: font.size.ui,
                  fontFamily: font.sans,
                  fontWeight: font.weight.medium,
                  color: color.textSecondary,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: radius.sm,
                  cursor: 'pointer',
                  transition: transition(['color', 'background']),
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = color.textPrimary;
                  e.currentTarget.style.background = color.divider;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = color.textSecondary;
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {isHome && <HomeGlyph />}
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {crumb.label}
                </span>
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
};
