import type { JSX } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import { ResourceGroup } from './ResourceGroup.js';
import type { GitGroups, GitRow } from './gitStatusModel.js';
import { useResourceGroupsController } from './useResourceGroupsController.js';

export const ResourceGroups = ({
  count,
  groups,
  busy,
  hasStaged,
  openRow,
  stage,
  unstage,
  discardMany,
}: {
  count: number;
  groups: GitGroups;
  busy: boolean;
  hasStaged: boolean;
  openRow: (row: GitRow) => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discardMany: (rows: readonly GitRow[]) => void;
}): JSX.Element => {
  const controller = useResourceGroupsController({
    groups,
    busy,
    openRow,
    stage,
    unstage,
    discardMany,
  });

  return (
    <div>
      {count === 0 ? (
        <div style={{ padding: space[4], color: color.textTertiary, fontSize: font.size.caption }}>
          There are no changes.
        </div>
      ) : (
        <>
          <ResourceGroup
            groupId="merge"
            title="Merge Changes"
            rows={groups.merge}
            show={groups.merge.length > 0}
            open={controller.openGroups.merge}
            onToggle={() => controller.toggleGroup('merge')}
            busy={busy}
            selectedKeys={controller.selectedKeys}
            onRowClick={controller.onRowClick}
            onRowContextMenu={controller.onRowContextMenu}
            onKeyboardContextMenu={controller.onKeyboardContextMenu}
            actions={controller.mergeActions}
          />
          <ResourceGroup
            groupId="staged"
            title="Staged Changes"
            rows={groups.staged}
            show={hasStaged}
            open={controller.openGroups.staged}
            onToggle={() => controller.toggleGroup('staged')}
            busy={busy}
            selectedKeys={controller.selectedKeys}
            groupAction={controller.unstageAllAction}
            onRowClick={controller.onRowClick}
            onRowContextMenu={controller.onRowContextMenu}
            onKeyboardContextMenu={controller.onKeyboardContextMenu}
            actions={controller.stagedActions}
          />
          <ResourceGroup
            groupId="changes"
            title="Changes"
            rows={groups.changes}
            show={groups.changes.length > 0}
            open={controller.openGroups.changes}
            onToggle={() => controller.toggleGroup('changes')}
            busy={busy}
            selectedKeys={controller.selectedKeys}
            groupAction={controller.stageAllAction}
            onRowClick={controller.onRowClick}
            onRowContextMenu={controller.onRowContextMenu}
            onKeyboardContextMenu={controller.onKeyboardContextMenu}
            actions={controller.changesActions}
          />
        </>
      )}
    </div>
  );
};
