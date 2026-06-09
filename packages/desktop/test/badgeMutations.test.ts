import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeBadgeChange } from '../src/renderer/src/lib/badgeBus.js';
import { badgeMutations } from '../src/renderer/src/lib/badgeMutations.js';

// The whole point of routing badge writes through badgeMutations is that the
// cross-view change signal fires automatically — so no call site can forget it
// (which is how the canvas→panel sync used to silently break). These lock that
// invariant: emit on success, NOT on failure, tagged with the caller's origin.

describe('badgeMutations', () => {
  let runMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runMock = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as unknown as { window: unknown }).window = { bh: { run: runMock } };
  });

  afterEach(() => {
    (globalThis as unknown as { window?: unknown }).window = undefined;
  });

  it('emits a change tagged with the origin after a successful write', async () => {
    const seen: (string | undefined)[] = [];
    const unsub = subscribeBadgeChange((origin) => seen.push(origin));
    await badgeMutations.addRef({ file: 'a.md', to: 'b.md', kind: 'file' }, 'canvas');
    unsub();
    expect(runMock).toHaveBeenCalledWith('badge.addRef', {
      file: 'a.md',
      to: 'b.md',
      kind: 'file',
    });
    expect(seen).toEqual(['canvas']);
  });

  it('does NOT emit when the underlying write throws', async () => {
    runMock.mockRejectedValueOnce(new Error('nope'));
    const seen: (string | undefined)[] = [];
    const unsub = subscribeBadgeChange((origin) => seen.push(origin));
    await expect(
      badgeMutations.removeRef({ file: 'a.md', to: 'b.md', kind: 'file' }, 'panel'),
    ).rejects.toThrow('nope');
    unsub();
    expect(seen).toEqual([]);
  });

  it('forwards the origin verbatim as an opaque id (per-instance, not a fixed enum)', async () => {
    // The origin is the EMITTING instance's id — a second badge panel uses its
    // own useId so peers ignore only their own writes. Passing through verbatim
    // is what lets that work, so lock it against re-narrowing to a 2-value union.
    const seen: (string | undefined)[] = [];
    const unsub = subscribeBadgeChange((origin) => seen.push(origin));
    await badgeMutations.addRef({ file: 'a.md', to: 'b.md', kind: 'file' }, ':r7:');
    unsub();
    expect(seen).toEqual([':r7:']);
  });

  it('setPrompt wraps badge.set with a prompt patch', async () => {
    const unsub = subscribeBadgeChange(() => {});
    await badgeMutations.setPrompt('a.md', 'hello', 'panel');
    unsub();
    expect(runMock).toHaveBeenCalledWith('badge.set', {
      file: 'a.md',
      kind: 'file',
      patch: { prompt: 'hello' },
    });
  });
});
