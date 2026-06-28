import { describe, expect, it, vi } from 'vitest';
import { SEARCH_IPC_CHANNELS } from '../src/workbench/services/search/common/search.js';
import { SearchMainChannel } from '../src/workbench/services/search/electron-main/searchMainChannel.js';
import type { SearchMainService } from '../src/workbench/services/search/electron-main/searchMainService.js';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

type Handler = (...args: unknown[]) => unknown;

function fakeIpc(): { handle: ReturnType<typeof vi.fn>; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  };
}

describe('SearchMainChannel', () => {
  it('registers search IPC handlers around the search service', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const search = {
      query: vi.fn(async () => ({ query: 'needle', hits: [] })),
      brief: vi.fn(async () => ({ query: 'needle', brief: 'brief', files: [] })),
    } as unknown as SearchMainService;

    new SearchMainChannel(search, () => '/repo', ipc).register();

    expect([...ipc.handlers.keys()]).toEqual(Object.values(SEARCH_IPC_CHANNELS));
    await expect(
      ipc.handlers.get(SEARCH_IPC_CHANNELS.query)?.(event, { query: 'needle' }),
    ).resolves.toEqual({ query: 'needle', hits: [] });
    await expect(
      ipc.handlers.get(SEARCH_IPC_CHANNELS.brief)?.(event, { query: 'needle' }),
    ).resolves.toEqual({ query: 'needle', brief: 'brief', files: [] });
    expect(search.query).toHaveBeenCalledWith('/repo', { query: 'needle' });
    expect(search.brief).toHaveBeenCalledWith('/repo', { query: 'needle' });
  });
});
