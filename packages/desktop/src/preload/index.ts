import { contextBridge, ipcRenderer } from 'electron';

interface SerializedError {
  name: string;
  message: string;
  code?: string;
}
type BhRunResponse = { ok: true; result: unknown } | { ok: false; error: SerializedError };

// The renderer's only door. Mirrors core.run(name, args) over IPC and
// exposes GUI-only Electron helpers (pickWorkspace) that don't belong
// in core. Re-throws serialized errors as real Error instances so
// callsites can use plain try/catch — the IPC tagged-union response is
// an implementation detail of the channel, not something the renderer
// should see.
const bh = {
  run: async (name: string, args?: unknown): Promise<unknown> => {
    const response = (await ipcRenderer.invoke('bh:run', name, args)) as BhRunResponse;
    if (response.ok) return response.result;
    const err = new Error(response.error.message);
    err.name = response.error.name;
    if (response.error.code !== undefined) {
      (err as Error & { code?: string }).code = response.error.code;
    }
    throw err;
  },
  pickWorkspace: (): Promise<string | null> => ipcRenderer.invoke('workspace:pick'),
};

contextBridge.exposeInMainWorld('bh', bh);
