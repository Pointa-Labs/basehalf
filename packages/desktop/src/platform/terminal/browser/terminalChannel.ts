import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';
import type { TerminalChannelBridge } from '../common/terminal.js';

export interface TerminalChannel extends TerminalChannelBridge {}

export function createTerminalChannel(bridge: BaseHalfSandboxApi): TerminalChannel {
  return {
    spawn: (opts) => bridge.terminal.spawn(opts),
    write: (id, data) => bridge.terminal.write(id, data),
    resize: (id, cols, rows) => bridge.terminal.resize(id, cols, rows),
    kill: (id) => bridge.terminal.kill(id),
    onData: (handler) => bridge.terminal.onData(handler),
    onExit: (handler) => bridge.terminal.onExit(handler),
  };
}

export const terminalChannel: TerminalChannel = createLazySandboxChannel(createTerminalChannel);
