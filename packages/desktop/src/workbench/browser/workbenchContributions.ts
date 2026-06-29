import { useEffect } from 'react';
import { nativeHostService } from '../../platform/native/browser/nativeHostService.js';
import { quickInputService } from '../../platform/quickinput/browser/quickInputService.js';
import { openSettings } from '../contrib/preferences/browser/Settings.js';
import {
  scheduleGitStatusRefresh,
  useGitStatusStore,
} from '../contrib/scm/browser/gitStatusStore.js';
import { registerScmWorkbenchContributions } from '../contrib/scm/browser/scm.contribution.js';
import { wireUpdateBridge } from '../contrib/update/browser/updateStore.js';
import { useReadingMode } from '../services/editor/browser/readingModeStore.js';
import { flushAll } from '../services/editor/common/editorFlush.js';
import { workbenchFileChangeService } from '../services/files/browser/fileChangeService.js';
import { useWorkspaceStore } from '../services/workspace/browser/workspaceStore.js';
import { removeActiveWorkspace, renameActiveWorkspace } from './actions/workbenchActions.js';
import { useLayoutStore } from './layout/layoutStore.js';
import { createCommandsQuickAccessContextSnapshot } from './quickaccess/commandPaletteWorkbenchContext.js';
import { CommandsQuickAccessProvider } from './quickaccess/commandsQuickAccess.js';
import { registerCommandPaletteQuickAccessProviders } from './quickaccess/quickAccessContributions.js';
import { selectRegion } from './workbenchRegion.js';

export interface WorkbenchContributionsState {
  readonly current: string | null;
  readonly notice: string;
  readonly clearNotice: () => void;
  readonly refreshWorkspace: () => void | Promise<void>;
}

/**
 * Renderer workbench contributions, following VS Code's workbench contribution
 * split: top-level application effects live here, while Workbench.tsx renders the
 * workbench parts and hosts.
 */
export function useWorkbenchContributions(state: WorkbenchContributionsState): void {
  registerScmWorkbenchContributions();
  useQuickAccessContribution();
  useInitialWorkspaceRefresh(state.refreshWorkspace);
  useWorkspaceWindowRefreshContribution();
  useFileRenameContribution();
  useGitStatusContribution(state.current);
  useWorkbenchKeyboardContribution();
  useQuitFlushContribution();
  useExternalLinksContribution();
  useWorkspaceMenuContribution();
  useSettingsMenuContribution();
  useReadingModeContribution(state.current);
  useTransientNoticeContribution(state.notice, state.clearNotice);
  useUpdateContribution();
}

function useQuickAccessContribution(): void {
  useEffect(() => {
    registerCommandPaletteQuickAccessProviders(undefined, {
      commandsProvider: new CommandsQuickAccessProvider(createCommandsQuickAccessContextSnapshot),
    });
  }, []);
}

function useInitialWorkspaceRefresh(refreshWorkspace: () => void | Promise<void>): void {
  useEffect(() => {
    void refreshWorkspace();
    void useWorkspaceStore.getState().refreshOpenRoots();
  }, [refreshWorkspace]);
}

function useWorkspaceWindowRefreshContribution(): void {
  useEffect(
    () =>
      nativeHostService.onWorkspacesWindowsChanged(() => {
        const ws = useWorkspaceStore.getState();
        void ws.refresh();
        void ws.refreshOpenRoots();
      }),
    [],
  );
}

function useFileRenameContribution(): void {
  useEffect(() => {
    const unsub = workbenchFileChangeService.onDidChangeFiles((event) => {
      if (event.type !== 'rename') return;
      useWorkspaceStore.getState().renameTab(event.fromRelPath, event.toRelPath);
    });
    return unsub;
  }, []);
}

function useGitStatusContribution(current: string | null): void {
  useEffect(() => {
    if (current === null) {
      useGitStatusStore.getState().reset();
      return;
    }
    void useGitStatusStore.getState().refresh();
    const unsub = workbenchFileChangeService.onDidChangeFiles(() => scheduleGitStatusRefresh());
    return unsub;
  }, [current]);
}

function useWorkbenchKeyboardContribution(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        const ws = useWorkspaceStore.getState();
        if (ws.renamingPath !== null) ws.endRename();
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const ae = document.activeElement;
      const editable =
        ae instanceof HTMLElement &&
        (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
      if (e.key === 'k') {
        e.preventDefault();
        quickInputService.quickAccess.show();
        return;
      }
      if (e.key === 'b' || e.key === 'B') {
        if (editable) return;
        const ws = useWorkspaceStore.getState();
        if (selectRegion(ws.current, ws.currentReachable) !== 'canvas') return;
        e.preventDefault();
        useLayoutStore.getState().toggleSidebar();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        if (quickInputService.quickAccess.isVisible()) return;
        if (editable) return;
        e.preventDefault();
        const ws = useWorkspaceStore.getState();
        void ws.newNote({ folder: ws.folderScope });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useQuitFlushContribution(): void {
  useEffect(() => nativeHostService.onFlushRequest(() => flushAll()), []);
}

function useExternalLinksContribution(): void {
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      void nativeHostService.openExternal(href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}

function useWorkspaceMenuContribution(): void {
  useEffect(
    () => nativeHostService.onMenuOpenFolder(() => void useWorkspaceStore.getState().pickAndAdd()),
    [],
  );

  useEffect(
    () =>
      nativeHostService.onMenuWorkspaceAction((action) => {
        if (action === 'rename') void renameActiveWorkspace();
        else void removeActiveWorkspace();
      }),
    [],
  );
}

function useSettingsMenuContribution(): void {
  useEffect(() => nativeHostService.onMenuOpenSettings(openSettings), []);
}

function useReadingModeContribution(current: string | null): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the intentional re-run trigger (re-resolve when the bound workspace changes); the body reads the store directly.
  useEffect(() => {
    void useReadingMode.getState().refresh();
  }, [current]);
}

function useTransientNoticeContribution(notice: string, clearNotice: () => void): void {
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(clearNotice, 6000);
    return () => window.clearTimeout(id);
  }, [notice, clearNotice]);
}

function useUpdateContribution(): void {
  useEffect(() => {
    wireUpdateBridge();
  }, []);
}
