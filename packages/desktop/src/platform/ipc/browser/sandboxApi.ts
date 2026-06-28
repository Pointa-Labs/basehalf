import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';

export type SandboxChannelFactory<T extends object> = (api: BaseHalfSandboxApi) => T;

export function getBaseHalfSandboxApi(): BaseHalfSandboxApi {
  return window.bh;
}

/**
 * Lazy browser-side channel proxy. Importing browser services in tests should
 * not require a real Electron preload; the sandbox API is resolved only when the
 * default channel is actually used by the running workbench.
 */
export function createLazySandboxChannel<T extends object>(factory: SandboxChannelFactory<T>): T {
  let api: BaseHalfSandboxApi | undefined;
  let channel: T | undefined;
  const getChannel = (): T => {
    const nextApi = getBaseHalfSandboxApi();
    if (channel === undefined || api !== nextApi) {
      api = nextApi;
      channel = factory(nextApi);
    }
    return channel;
  };
  return new Proxy({} as T, {
    get(_target, property) {
      const current = getChannel();
      const value = Reflect.get(current, property, current);
      return typeof value === 'function' ? value.bind(current) : value;
    },
  });
}
