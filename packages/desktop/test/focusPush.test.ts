import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  focusSet: vi.fn(async (args: unknown) => args),
  workspaceState: {
    current: 'demo',
    openFile: 'a.md' as string | null,
  },
}));

vi.mock('../src/workbench/services/workspace/browser/workspaceStore.js', () => ({
  useWorkspaceStore: {
    getState: () => mocks.workspaceState,
  },
}));

vi.mock('../src/workbench/services/mirror/browser/focusService.js', () => ({
  focusService: {
    set: mocks.focusSet,
  },
}));

vi.mock('../src/workbench/services/mirror/browser/mirrorWrites.js', () => ({
  mirrorWritesSuspended: () => false,
}));

import { makeFileFocusPusher } from '../src/workbench/services/mirror/browser/focusPush.js';

describe('makeFileFocusPusher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.focusSet.mockClear();
    mocks.workspaceState.current = 'demo';
    mocks.workspaceState.openFile = 'a.md';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists block-only viewport focus fields', async () => {
    const push = makeFileFocusPusher('a.md', 10);

    push(() => ({ visible_blocks: { start: 4 } }));
    await vi.advanceTimersByTimeAsync(10);

    expect(mocks.focusSet).toHaveBeenCalledWith({
      path: 'a.md',
      kind: 'file',
      visible_blocks: { start: 4 },
    });
  });
});
