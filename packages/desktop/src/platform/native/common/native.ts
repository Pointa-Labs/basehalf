export type NativeHostResult = { readonly ok: boolean; readonly error?: string };
export type NativeHostPathKind = 'file' | 'dir' | null;

export const NATIVE_HOST_IPC_CHANNELS = {
  pickWorkspace: 'workspace:pick',
  openPath: 'shell:open-path',
  pathKind: 'path:kind',
  openExternal: 'shell:open-external',
} as const;

export type NativeHostIpcChannel =
  (typeof NATIVE_HOST_IPC_CHANNELS)[keyof typeof NATIVE_HOST_IPC_CHANNELS];
