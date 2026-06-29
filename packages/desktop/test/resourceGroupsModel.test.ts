import { describe, expect, it } from 'vitest';
import {
  emptyResourceSelection,
  flattenResourceRows,
  pruneResourceSelection,
  selectResourceOnly,
  selectResourceRange,
  selectedRowsForResourceAction,
  toggleResourceSelection,
} from '../src/workbench/contrib/scm/browser/resourceGroupsModel.js';
import type { GitGroups, GitRow } from '../src/workbench/contrib/scm/common/gitStatusModel.js';

const row = (path: string, status = 'M'): GitRow => ({
  path,
  status,
  staged: false,
  untracked: false,
  conflict: false,
});

const groups: GitGroups = {
  merge: [row('conflict.md', 'U')],
  staged: [{ ...row('staged.md', 'A'), staged: true }],
  changes: [row('a.md'), row('b.md'), row('c.md')],
};

describe('resourceGroupsModel', () => {
  it('flattens resource groups in VS Code SCM tree order', () => {
    expect(flattenResourceRows(groups).map((item) => `${item.index}:${item.key}`)).toEqual([
      '0:merge:conflict.md',
      '1:staged:staged.md',
      '2:changes:a.md',
      '3:changes:b.md',
      '4:changes:c.md',
    ]);
  });

  it('models single, range, and toggled selection', () => {
    const items = flattenResourceRows(groups);
    const single = selectResourceOnly('changes:a.md');
    expect(single).toEqual({ selectedKeys: ['changes:a.md'], anchorKey: 'changes:a.md' });

    const range = selectResourceRange(single, items, 'changes:c.md');
    expect(range.selectedKeys).toEqual(['changes:a.md', 'changes:b.md', 'changes:c.md']);
    expect(range.anchorKey).toBe('changes:a.md');

    const toggledOff = toggleResourceSelection(range, 'changes:b.md');
    expect(toggledOff.selectedKeys).toEqual(['changes:a.md', 'changes:c.md']);
    expect(toggledOff.anchorKey).toBe('changes:b.md');

    const toggledOn = toggleResourceSelection(toggledOff, 'staged:staged.md');
    expect(toggledOn.selectedKeys).toEqual(['changes:a.md', 'changes:c.md', 'staged:staged.md']);
    expect(toggledOn.anchorKey).toBe('staged:staged.md');
  });

  it('prunes stale selected rows and anchors after status refreshes', () => {
    const nextItems = flattenResourceRows({ ...groups, changes: [row('a.md')] });
    expect(
      pruneResourceSelection(
        { selectedKeys: ['changes:a.md', 'changes:b.md'], anchorKey: 'changes:b.md' },
        nextItems,
      ),
    ).toEqual({ selectedKeys: ['changes:a.md'], anchorKey: null });
    expect(pruneResourceSelection(emptyResourceSelection(), nextItems)).toEqual(
      emptyResourceSelection(),
    );
  });

  it('uses selected rows from the same resource group for row actions', () => {
    const items = flattenResourceRows(groups);
    const selectedKeys = ['changes:a.md', 'staged:staged.md', 'changes:c.md'];
    expect(
      selectedRowsForResourceAction(items, selectedKeys, 'changes:a.md', 'changes').map(
        (item) => item.path,
      ),
    ).toEqual(['a.md', 'c.md']);
    expect(
      selectedRowsForResourceAction(items, selectedKeys, 'staged:staged.md', 'staged').map(
        (item) => item.path,
      ),
    ).toEqual(['staged.md']);
    expect(
      selectedRowsForResourceAction(items, selectedKeys, 'changes:b.md', 'changes').map(
        (item) => item.path,
      ),
    ).toEqual(['b.md']);
    expect(
      selectedRowsForResourceAction(
        items,
        ['merge:conflict.md', 'changes:a.md'],
        'merge:conflict.md',
        'merge',
      ).map((item) => item.path),
    ).toEqual(['conflict.md']);
  });
});
