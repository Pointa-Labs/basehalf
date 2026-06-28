import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FileFocusPushContext,
  canPushFileFocus,
  makeFileFocusPusher,
} from '../src/workbench/services/mirror/browser/focusPush.js';

describe('makeFileFocusPusher', () => {
  let context: FileFocusPushContext;
  let setFocus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    context = {
      currentWorkspace: 'demo',
      openFile: 'a.md',
      mirrorWritesSuspended: false,
    };
    setFocus = vi.fn(async (args: unknown) => args);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists block-only viewport focus fields', async () => {
    const push = makeFileFocusPusher('a.md', {
      debounceMs: 10,
      getContext: () => context,
      setFocus,
    });

    push(() => ({ visible_blocks: { start: 4 } }));
    await vi.advanceTimersByTimeAsync(10);

    expect(setFocus).toHaveBeenCalledWith({
      path: 'a.md',
      kind: 'file',
      visible_blocks: { start: 4 },
    });
  });

  it('does not write after the file loses workbench focus', async () => {
    const push = makeFileFocusPusher('a.md', {
      debounceMs: 10,
      getContext: () => context,
      setFocus,
    });

    push(() => ({ visible_lines: { start: 8 } }));
    context = { ...context, openFile: 'b.md' };
    await vi.advanceTimersByTimeAsync(10);

    expect(setFocus).not.toHaveBeenCalled();
  });

  it('deduplicates unchanged focus payloads', async () => {
    const push = makeFileFocusPusher('a.md', {
      debounceMs: 10,
      getContext: () => context,
      setFocus,
    });

    push(() => ({ visible_lines: { start: 8 } }));
    await vi.advanceTimersByTimeAsync(10);
    push(() => ({ visible_lines: { start: 8 } }));
    await vi.advanceTimersByTimeAsync(10);

    expect(setFocus).toHaveBeenCalledTimes(1);
  });
});

describe('canPushFileFocus', () => {
  it('requires an active workspace, matching file, and unsuspended mirror writes', () => {
    expect(
      canPushFileFocus('a.md', {
        currentWorkspace: 'demo',
        openFile: 'a.md',
        mirrorWritesSuspended: false,
      }),
    ).toBe(true);

    expect(
      canPushFileFocus('a.md', {
        currentWorkspace: null,
        openFile: 'a.md',
        mirrorWritesSuspended: false,
      }),
    ).toBe(false);
    expect(
      canPushFileFocus('a.md', {
        currentWorkspace: 'demo',
        openFile: 'b.md',
        mirrorWritesSuspended: false,
      }),
    ).toBe(false);
    expect(
      canPushFileFocus('a.md', {
        currentWorkspace: 'demo',
        openFile: 'a.md',
        mirrorWritesSuspended: true,
      }),
    ).toBe(false);
  });
});
