import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import {
  SEARCH_IPC_CHANNELS,
  type SearchBridge,
  type SearchChannelBridge,
} from '../common/search.js';

export type { SearchBridge } from '../common/search.js';

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
