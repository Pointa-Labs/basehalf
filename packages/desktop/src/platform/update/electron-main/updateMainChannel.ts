import { ipcMain } from 'electron';
import { type JustInstalled, UPDATE_IPC_CHANNELS, type UpdateState } from '../common/update.js';

export interface UpdateMainService {
  getState(): UpdateState;
  check(opts: { background: boolean }): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  consumeJustInstalled(): JustInstalled | null;
}

export interface IpcMainHandleLike {
  handle(channel: string, listener: (...args: unknown[]) => unknown): void;
}

/**
 * Main-process update IPC channel. Mirrors VS Code's shape where the update
 * state machine is a service and the Electron IPC surface is a small channel
 * object registered around it.
 */
export class UpdateMainChannel {
  constructor(
    private readonly updater: UpdateMainService,
    private readonly ipc: IpcMainHandleLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(UPDATE_IPC_CHANNELS.getState, () => this.updater.getState());
    this.ipc.handle(UPDATE_IPC_CHANNELS.check, async () => {
      await this.updater.check({ background: false });
    });
    this.ipc.handle(UPDATE_IPC_CHANNELS.download, async () => {
      await this.updater.download();
    });
    this.ipc.handle(UPDATE_IPC_CHANNELS.install, async () => {
      await this.updater.install();
    });
    this.ipc.handle(UPDATE_IPC_CHANNELS.justInstalled, () => this.updater.consumeJustInstalled());
  }
}

export function registerUpdaterIpc(updater: UpdateMainService): void {
  new UpdateMainChannel(updater).register();
}
