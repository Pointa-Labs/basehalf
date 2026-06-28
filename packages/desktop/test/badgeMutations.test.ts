import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeBadgeChange } from '../src/workbench/services/mirror/browser/badgeBus.js';
import { badgeMutations } from '../src/workbench/services/mirror/browser/badgeMutations.js';

// The whole point of routing badge writes through badgeMutations is that the
// cross-view change signal fires automatically — so no call site can forget it
// (which is how the canvas→panel sync used to silently break). These lock that
// invariant: emit on success, NOT on failure, tagged with the caller's origin.

describe('badgeMutations', () => {
  let badgeAddRefMock: ReturnType<typeof vi.fn>;
  let badgeRemoveRefMock: ReturnType<typeof vi.fn>;
  let badgeSetMock: ReturnType<typeof vi.fn>;
  let canvasConnectMock: ReturnType<typeof vi.fn>;
  let canvasDisconnectMock: ReturnType<typeof vi.fn>;
  let canvasReconnectMock: ReturnType<typeof vi.fn>;
  let canvasSetCardMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    badgeAddRefMock = vi.fn().mockResolvedValue({ ok: true });
    badgeRemoveRefMock = vi.fn().mockResolvedValue({ ok: true });
    badgeSetMock = vi.fn().mockResolvedValue({ ok: true });
    canvasConnectMock = vi.fn().mockResolvedValue({ ok: true });
    canvasDisconnectMock = vi.fn().mockResolvedValue({ ok: true });
    canvasReconnectMock = vi.fn().mockResolvedValue({ ok: true });
    canvasSetCardMock = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as unknown as { window: unknown }).window = {
      bh: {
        badge: {
          addRef: badgeAddRefMock,
          removeRef: badgeRemoveRefMock,
          set: badgeSetMock,
        },
        canvas: {
          connect: canvasConnectMock,
          disconnect: canvasDisconnectMock,
          reconnect: canvasReconnectMock,
          setCard: canvasSetCardMock,
        },
      },
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window?: unknown }).window = undefined;
  });

  it('emits a change tagged with the origin after a successful write', async () => {
    const seen: (string | undefined)[] = [];
    const unsub = subscribeBadgeChange((origin) => seen.push(origin));
    await badgeMutations.addRef({ file: 'a.md', to: 'b.md', kind: 'file' }, 'canvas');
    unsub();
    expect(badgeAddRefMock).toHaveBeenCalledWith({
      file: 'a.md',
      to: 'b.md',
      kind: 'file',
    });
    expect(seen).toEqual(['canvas']);
  });

  it('does NOT emit when the underlying write throws', async () => {
    badgeRemoveRefMock.mockRejectedValueOnce(new Error('nope'));
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

  it('setDescription wraps badge.set with a description patch', async () => {
    const unsub = subscribeBadgeChange(() => {});
    await badgeMutations.setDescription('a.md', 'hello', 'panel');
    unsub();
    // kind lives INSIDE the patch (badge.set reads patch.kind) so the same path
    // serves both file and folder badges.
    expect(badgeSetMock).toHaveBeenCalledWith({
      file: 'a.md',
      patch: { kind: 'file', description: 'hello' },
    });
  });

  it('setDescription threads a folder kind into the patch', async () => {
    const unsub = subscribeBadgeChange(() => {});
    await badgeMutations.setDescription('notes', 'hi', 'panel', 'folder');
    unsub();
    expect(badgeSetMock).toHaveBeenCalledWith({
      file: 'notes',
      patch: { kind: 'folder', description: 'hi' },
    });
  });

  it('connect forwards canvas.connect args and emits', async () => {
    const seen: (string | undefined)[] = [];
    const unsub = subscribeBadgeChange((origin) => seen.push(origin));
    await badgeMutations.connect(
      { folder: null, from: 'a.md', to: 'b.md', from_anchor: 'east', to_anchor: 'west' },
      'canvas',
    );
    unsub();
    expect(canvasConnectMock).toHaveBeenCalledWith({
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    expect(seen).toEqual(['canvas']);
  });

  it('disconnect forwards canvas.disconnect args and emits', async () => {
    const seen: (string | undefined)[] = [];
    const unsub = subscribeBadgeChange((origin) => seen.push(origin));
    await badgeMutations.disconnect({ folder: 'docs', from: 'a.md', to: 'b.md' }, 'canvas');
    unsub();
    expect(canvasDisconnectMock).toHaveBeenCalledWith({
      folder: 'docs',
      from: 'a.md',
      to: 'b.md',
    });
    expect(seen).toEqual(['canvas']);
  });

  it('setCard writes canvas.setCard WITHOUT a cross-view emit (a position is not shown elsewhere)', async () => {
    const seen: (string | undefined)[] = [];
    const unsub = subscribeBadgeChange((origin) => seen.push(origin));
    await badgeMutations.setCard({
      folder: null,
      card: { path: 'a.md', kind: 'file', x: 1, y: 2, width: 300, height: 220 },
    });
    unsub();
    expect(canvasSetCardMock).toHaveBeenCalledWith({
      folder: null,
      card: { path: 'a.md', kind: 'file', x: 1, y: 2, width: 300, height: 220 },
    });
    expect(seen).toEqual([]); // no bus signal — position is not a cross-view concern
  });
});
