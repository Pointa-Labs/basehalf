import type { JSX } from 'react';
import { color, radius, shadow, space } from '../design.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { WorkspaceUnreachable } from './WorkspaceUnreachable.js';

/**
 * The recovery surface: shown as the SOLE occupant of the working region when the
 * open workspace's folder has gone missing (`currentReachable === false`). App
 * gates this via selectRegion, so — like Welcome — there is no sidebar/canvas
 * alongside it and the recovery card never renders twice.
 *
 * Unlike Welcome (a place you stand in, no chrome), this IS an alert, so it KEEPS
 * the card silhouette (surface + border + radius.xl + shadow.raised) — the
 * deliberate contrast that tells the two states apart. Store-connected: resolves
 * the active workspace's path from the registry; the inner WorkspaceUnreachable
 * owns the re-select / unregister actions.
 */
export const WorkspaceMissing = (): JSX.Element => {
  const current = useWorkspaceStore((s) => s.current);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const ws = workspaces.find((w) => w.name === current);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color.bg,
        padding: space[5],
      }}
    >
      {ws && (
        <div
          style={{
            maxWidth: 460,
            width: '100%',
            background: color.surface,
            border: `1px solid ${color.border}`,
            borderRadius: radius.xl,
            boxShadow: shadow.raised,
          }}
        >
          <WorkspaceUnreachable name={ws.name} missingPath={ws.path} />
        </div>
      )}
    </div>
  );
};
