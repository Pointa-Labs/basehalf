import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import { GIT_IPC_CHANNELS, type GitChannelBridge, unwrapGitIpcResult } from '../common/git.js';

export interface GitBridgeContainer {
  readonly git: GitChannelBridge;
}

export function createGitBridge(ipcRenderer: IpcRendererLike): GitBridgeContainer {
  return {
    git: {
      init: () => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.init),
      stage: (paths) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.stage, [...paths]),
      stageAll: () => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.stageAll),
      unstage: (paths) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.unstage, [...paths]),
      unstageAll: () => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.unstageAll),
      discard: (paths) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.discard, [...paths]),
      deleteWorkspaceEntry: (path, kind) =>
        invokeGit(ipcRenderer, GIT_IPC_CHANNELS.deleteWorkspaceEntry, { path, kind }),
      commit: (message, options = {}) =>
        invokeGit(ipcRenderer, GIT_IPC_CHANNELS.commit, { message, ...options }),
      push: (options = {}) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.push, options),
      publish: (options = {}) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.publish, options),
      pull: (options = {}) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.pull, options),
      fetch: () => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.fetch),
      sync: () => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.sync),
      remotes: () => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.remotes),
      reset: (args) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.reset, args),
      checkout: (branch, options = {}) =>
        invokeGit(ipcRenderer, GIT_IPC_CHANNELS.checkout, { branch, ...options }),
      createBranch: (name, options = {}) =>
        invokeGit(ipcRenderer, GIT_IPC_CHANNELS.createBranch, { name, ...options }),
      renameBranch: (from, to) =>
        invokeGit(ipcRenderer, GIT_IPC_CHANNELS.renameBranch, { from, to }),
      renameCurrentBranch: (to) =>
        invokeGit(ipcRenderer, GIT_IPC_CHANNELS.renameCurrentBranch, { to }),
      deleteBranch: (name, options = {}) =>
        invokeGit(ipcRenderer, GIT_IPC_CHANNELS.deleteBranch, { name, ...options }),
      merge: (branch) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.merge, branch),
      cherryPick: (ref) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.cherryPick, ref),
      revert: (ref) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.revert, ref),
      rebaseInteractive: (args) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.rebaseInteractive, args),
      tag: (name, ref) =>
        invokeGit(ipcRenderer, GIT_IPC_CHANNELS.tag, ref !== undefined ? { name, ref } : { name }),
      tagDelete: (name) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.tagDelete, name),
      status: () => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.status),
      show: (ref, path) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.show, { ref, path }),
      diff: (path, options = {}) =>
        invokeGit(ipcRenderer, GIT_IPC_CHANNELS.diff, { path, ...options }),
      apply: (args) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.apply, args),
      blame: (path, options = {}) =>
        invokeGit(ipcRenderer, GIT_IPC_CHANNELS.blame, { path, ...options }),
      conflictStages: (path) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.conflictStages, path),
      refs: (args = {}) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.refs, args),
      log: (args) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.log, args),
      mergeBase: (refs) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.mergeBase, [...refs]),
      searchHistory: (args) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.searchHistory, args),
      commitFiles: (ref, parent) =>
        invokeGit(
          ipcRenderer,
          GIT_IPC_CHANNELS.commitFiles,
          parent === undefined ? { ref } : { ref, parent },
        ),
      stash: (message, options = {}) =>
        invokeGit(
          ipcRenderer,
          GIT_IPC_CHANNELS.stash,
          message === undefined ? { ...options } : { message, ...options },
        ),
      stashList: () => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.stashList),
      stashApply: (ref) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.stashApply, ref),
      stashPop: (ref) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.stashPop, ref),
      stashDrop: (ref) => invokeGit(ipcRenderer, GIT_IPC_CHANNELS.stashDrop, ref),
    },
  };
}

async function invokeGit<T = void>(
  ipcRenderer: IpcRendererLike,
  channel: string,
  ...payload: [] | [unknown]
): Promise<T> {
  const raw =
    payload.length === 0
      ? await ipcRenderer.invoke(channel)
      : await ipcRenderer.invoke(channel, payload[0]);
  return unwrapGitIpcResult<T>(raw);
}
