export const formatWorkspaceError = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

// PATH_NOT_FOUND is encoded as a `[PATH_NOT_FOUND] …` prefix in the error
// message because Electron's contextBridge strips both custom Error properties
// (.code) AND instance-assigned standard ones (.name reverts to the prototype
// default "Error"). Message is the only field that reliably survives the bridge.
export const isWorkspacePathNotFoundError = (err: unknown): boolean =>
  err instanceof Error && err.message.startsWith('[PATH_NOT_FOUND]');
