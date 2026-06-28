import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import { GIT_IPC_CHANNELS, type GitChannelBridge } from '../common/git.js';

export interface GitBridgeContainer {
  readonly git: GitChannelBridge;
}

export function createGitBridge(ipcRenderer: IpcRendererLike): GitBridgeContainer {
  return {
    git: {
      init: () => ipcRenderer.invoke(GIT_IPC_CHANNELS.init) as Promise<void>,
      stage: (paths) => ipcRenderer.invoke(GIT_IPC_CHANNELS.stage, [...paths]) as Promise<void>,
      stageAll: () => ipcRenderer.invoke(GIT_IPC_CHANNELS.stageAll) as Promise<void>,
      unstage: (paths) => ipcRenderer.invoke(GIT_IPC_CHANNELS.unstage, [...paths]) as Promise<void>,
      unstageAll: () => ipcRenderer.invoke(GIT_IPC_CHANNELS.unstageAll) as Promise<void>,
      discard: (paths) => ipcRenderer.invoke(GIT_IPC_CHANNELS.discard, [...paths]) as Promise<void>,
      deleteWorkspaceEntry: (path, kind) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.deleteWorkspaceEntry, { path, kind }) as Promise<void>,
      commit: (message, options = {}) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.commit, { message, ...options }) as Promise<void>,
      push: (options = {}) => ipcRenderer.invoke(GIT_IPC_CHANNELS.push, options) as Promise<void>,
      pull: (options = {}) => ipcRenderer.invoke(GIT_IPC_CHANNELS.pull, options) as Promise<void>,
      fetch: () => ipcRenderer.invoke(GIT_IPC_CHANNELS.fetch) as Promise<void>,
      sync: () => ipcRenderer.invoke(GIT_IPC_CHANNELS.sync) as Promise<void>,
      reset: (args) => ipcRenderer.invoke(GIT_IPC_CHANNELS.reset, args) as Promise<void>,
      checkout: (branch, options = {}) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.checkout, { branch, ...options }) as Promise<void>,
      createBranch: (name, options = {}) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.createBranch, { name, ...options }) as Promise<void>,
      renameBranch: (from, to) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.renameBranch, { from, to }) as Promise<void>,
      renameCurrentBranch: (to) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.renameCurrentBranch, { to }) as Promise<void>,
      deleteBranch: (name, options = {}) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.deleteBranch, { name, ...options }) as Promise<void>,
      merge: (branch) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.merge, branch) as ReturnType<GitChannelBridge['merge']>,
      cherryPick: (ref) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.cherryPick, ref) as ReturnType<
          GitChannelBridge['cherryPick']
        >,
      revert: (ref) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.revert, ref) as ReturnType<GitChannelBridge['revert']>,
      rebaseInteractive: (args) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.rebaseInteractive, args) as ReturnType<
          GitChannelBridge['rebaseInteractive']
        >,
      tag: (name, ref) =>
        ipcRenderer.invoke(
          GIT_IPC_CHANNELS.tag,
          ref !== undefined ? { name, ref } : { name },
        ) as Promise<void>,
      tagDelete: (name) => ipcRenderer.invoke(GIT_IPC_CHANNELS.tagDelete, name) as Promise<void>,
      status: () =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.status) as ReturnType<GitChannelBridge['status']>,
      show: (ref, path) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.show, { ref, path }) as ReturnType<
          GitChannelBridge['show']
        >,
      diff: (path, options = {}) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.diff, { path, ...options }) as ReturnType<
          GitChannelBridge['diff']
        >,
      apply: (args) => ipcRenderer.invoke(GIT_IPC_CHANNELS.apply, args) as Promise<void>,
      blame: (path, options = {}) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.blame, { path, ...options }) as ReturnType<
          GitChannelBridge['blame']
        >,
      conflictStages: (path) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.conflictStages, path) as ReturnType<
          GitChannelBridge['conflictStages']
        >,
      refs: (args = {}) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.refs, args) as ReturnType<GitChannelBridge['refs']>,
      log: (args) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.log, args) as ReturnType<GitChannelBridge['log']>,
      searchHistory: (args) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.searchHistory, args) as ReturnType<
          GitChannelBridge['searchHistory']
        >,
      commitFiles: (ref) =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.commitFiles, ref) as ReturnType<
          GitChannelBridge['commitFiles']
        >,
      stash: (message, options = {}) =>
        ipcRenderer.invoke(
          GIT_IPC_CHANNELS.stash,
          message === undefined ? { ...options } : { message, ...options },
        ) as ReturnType<GitChannelBridge['stash']>,
      stashList: () =>
        ipcRenderer.invoke(GIT_IPC_CHANNELS.stashList) as ReturnType<GitChannelBridge['stashList']>,
      stashApply: (ref) => ipcRenderer.invoke(GIT_IPC_CHANNELS.stashApply, ref) as Promise<void>,
      stashPop: (ref) => ipcRenderer.invoke(GIT_IPC_CHANNELS.stashPop, ref) as Promise<void>,
      stashDrop: (ref) => ipcRenderer.invoke(GIT_IPC_CHANNELS.stashDrop, ref) as Promise<void>,
    },
  };
}
