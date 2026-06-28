export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  sendSync(channel: string, ...args: unknown[]): unknown;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
}

export interface WebFrameLike {
  getZoomFactor(): number;
}

export interface WebUtilsLike {
  getPathForFile(file: File): string;
}

export interface PreloadProcessEnv {
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
}

export type Disposable = () => void;
