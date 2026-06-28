import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import { SEARCH_IPC_CHANNELS, type SearchChannelBridge } from '../common/search.js';

export interface SearchBridge {
  readonly search: SearchChannelBridge;
}

export function createSearchBridge(ipcRenderer: IpcRendererLike): SearchBridge {
  return {
    search: {
      query: (args) =>
        ipcRenderer.invoke(SEARCH_IPC_CHANNELS.query, args) as ReturnType<
          SearchChannelBridge['query']
        >,
      brief: (args) =>
        ipcRenderer.invoke(SEARCH_IPC_CHANNELS.brief, args) as ReturnType<
          SearchChannelBridge['brief']
        >,
    },
  };
}
