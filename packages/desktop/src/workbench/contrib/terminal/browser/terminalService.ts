import {
  type TerminalChannel,
  terminalChannel,
} from '../../../../platform/terminal/browser/terminalChannel.js';
import {
  type TerminalChannelBridge,
  type TerminalRawSpawnResult,
  type TerminalSpawnOptions,
  type TerminalSpawnResult,
  normalizeTerminalSpawnResult,
} from '../../../../platform/terminal/common/terminal.js';

export interface TerminalService extends TerminalChannelBridge {
  spawn(opts?: TerminalSpawnOptions): Promise<TerminalSpawnResult>;
}

export function createTerminalService(channel: TerminalChannel): TerminalService {
  return {
    spawn: async (opts) =>
      normalizeTerminalSpawnResult((await channel.spawn(opts)) as TerminalRawSpawnResult),
    write: (id, data) => channel.write(id, data),
    resize: (id, cols, rows) => channel.resize(id, cols, rows),
    kill: (id) => channel.kill(id),
    onData: (handler) => channel.onData(handler),
    onExit: (handler) => channel.onExit(handler),
  };
}

export const terminalService = createTerminalService(terminalChannel);
