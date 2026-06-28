import { type WebContents, ipcMain } from 'electron';
import { SEARCH_IPC_CHANNELS, asSearchBriefArgs, asSearchQueryArgs } from '../common/search.js';
import type { SearchMainService } from './searchMainService.js';

type SearchIpcHandler = (event: SearchIpcEvent, payload?: unknown) => unknown;

export interface IpcMainSearchLike {
  handle(channel: string, listener: SearchIpcHandler): void;
}

export type SearchWorkspaceRootResolver = (sender: WebContents) => string | null;

interface SearchIpcEvent {
  readonly sender: WebContents;
}

export class SearchMainChannel {
  constructor(
    private readonly search: SearchMainService,
    private readonly getWorkspaceRoot: SearchWorkspaceRootResolver,
    private readonly ipc: IpcMainSearchLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(SEARCH_IPC_CHANNELS.query, (event, args) =>
      this.search.query(this.root(event), asSearchQueryArgs(args)),
    );
    this.ipc.handle(SEARCH_IPC_CHANNELS.brief, (event, args) =>
      this.search.brief(this.root(event), asSearchBriefArgs(args)),
    );
  }

  private root(event: SearchIpcEvent): string | null {
    return this.getWorkspaceRoot(event.sender);
  }
}
