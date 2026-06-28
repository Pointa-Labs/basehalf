import type { JSX } from 'react';
import { confirm } from '../../../browser/parts/dialogs/Dialog.js';
import { color, font, radius, space } from '../../../browser/style/design.js';
import { Button } from '../../../browser/ui/primitives/Button.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';

interface WorkspaceUnreachableProps {
  name: string;
  missingPath: string;
}

export const WorkspaceUnreachable = ({
  name,
  missingPath,
}: WorkspaceUnreachableProps): JSX.Element => {
  const busy = useWorkspaceStore((s) => s.busy);
  const repath = useWorkspaceStore((s) => s.repath);
  const remove = useWorkspaceStore((s) => s.remove);

  const handleRemove = async (): Promise<void> => {
    const ok = await confirm({
      title: `Unregister "${name}"?`,
      body: 'The folder is already gone from this location, so nothing on disk changes; only the registration is dropped.',
      confirmText: 'Unregister',
      destructive: true,
    });
    if (ok) void remove(name);
  };

  return (
    <div
      style={{
        padding: space[5],
        fontFamily: font.sans,
        color: color.textPrimary,
      }}
    >
      <div
        style={{
          fontSize: font.size.body,
          fontWeight: font.weight.semibold,
          color: color.danger,
          marginBottom: space[2],
        }}
      >
        Workspace folder not found
      </div>
      <div
        style={{
          marginBottom: space[2],
          fontSize: font.size.caption,
          color: color.textSecondary,
          lineHeight: 1.5,
        }}
      >
        BaseHalf can’t find <strong style={{ color: color.textPrimary }}>{name}</strong> at:
      </div>
      <div
        style={{
          fontFamily: font.mono,
          fontSize: font.size.micro,
          background: color.surfaceMuted,
          color: color.textSecondary,
          padding: `${space[2]}px ${space[2]}px`,
          borderRadius: radius.sm,
          border: `1px solid ${color.divider}`,
          marginBottom: space[3],
          wordBreak: 'break-all',
        }}
      >
        {missingPath}
      </div>
      <div
        style={{
          color: color.textTertiary,
          fontSize: font.size.caption,
          marginBottom: space[4],
          lineHeight: 1.5,
        }}
      >
        The folder may have been moved, renamed, or deleted in a file manager.
      </div>
      <div style={{ display: 'flex', gap: space[2] }}>
        <Button variant="primary" onClick={() => void repath(name)} disabled={busy}>
          {busy ? '…' : 'Re-select location'}
        </Button>
        <Button variant="ghost" onClick={() => void handleRemove()} disabled={busy}>
          Unregister
        </Button>
      </div>
    </div>
  );
};
