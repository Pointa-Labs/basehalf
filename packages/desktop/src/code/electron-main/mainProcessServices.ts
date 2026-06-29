import { join } from 'node:path';
import { type BrowserWindow, type Display, screen, shell } from 'electron';
import { SettingsMainService } from '../../platform/configuration/electron-main/configurationMainService.js';
import { FileSettingsRegistryProvider } from '../../platform/configuration/electron-main/configurationRegistryProvider.js';
import { WorkspaceFilesMainService } from '../../platform/files/electron-main/workspaceFilesMainService.js';
import { WorkspaceWatcherMainService } from '../../platform/files/electron-main/workspaceWatcherMainService.js';
import {
  claimNativeContextMenuSuppression,
  installContextMenu,
} from '../../platform/menubar/electron-main/menubarMainService.js';
import { NativeHostMainService } from '../../platform/native/electron-main/nativeHostMainService.js';
import { createSafeStorageSecrets } from '../../platform/secrets/electron-main/safeStorageSecretStore.js';
import { PrefsStore } from '../../platform/storage/electron-main/prefsStore.js';
import { defaultConfigDir } from '../../platform/storage/node/configDir.js';
import { TerminalMainService } from '../../platform/terminal/node/terminalMainService.js';
import {
  Updater,
  cleanupUpdateLeftovers,
  startBackgroundUpdateChecks,
} from '../../platform/update/electron-main/updater.js';
import { WindowChromeMainService } from '../../platform/windows/electron-main/windowChromeMainService.js';
import { WindowLifecycleMainService } from '../../platform/windows/electron-main/windowLifecycleMainService.js';
import { WindowSecurityMainService } from '../../platform/windows/electron-main/windowSecurityMainService.js';
import { WindowSessionMainService } from '../../platform/windows/electron-main/windowSessionMainService.js';
import { WindowZoomMainService } from '../../platform/windows/electron-main/windowZoomMainService.js';
import {
  clearWorkspaceRoot,
  getWorkspaceRoot,
  getWorkspaceRootById,
  setWorkspaceRoot,
} from '../../platform/windows/electron-main/windows.js';
import { WorkspaceWindowFactoryMainService } from '../../platform/windows/electron-main/workspaceWindowFactoryMainService.js';
import { WorkspaceWindowRouterMainService } from '../../platform/windows/electron-main/workspaceWindowRouterMainService.js';
import { DesktopWorkspaceBackendProvider } from '../../platform/workspaces/electron-main/workspaceBackendProvider.js';
import { FileWorkspaceRegistryBackendProvider } from '../../platform/workspaces/electron-main/workspaceRegistryBackendProvider.js';
import { WorkspaceRegistryMainService } from '../../platform/workspaces/electron-main/workspaceRegistryMainService.js';
import { WorkspaceSurfacesMainService } from '../../platform/workspaces/electron-main/workspaceSurfacesMainService.js';
import { WorkspaceMainService } from '../../platform/workspaces/electron-main/workspacesMainService.js';
import { GithubAuthenticationProvider } from '../../workbench/contrib/githubPullRequests/electron-main/githubAuthenticationProvider.js';
import { createGithubGitRunner } from '../../workbench/contrib/githubPullRequests/electron-main/githubGitCredentials.js';
import {
  type GitRemoteInfoLike,
  GithubMainService,
} from '../../workbench/contrib/githubPullRequests/electron-main/githubMainService.js';
import { GitCliBackendProvider } from '../../workbench/contrib/scm/electron-main/gitBackendProvider.js';
import { GitMainService } from '../../workbench/contrib/scm/electron-main/gitMainService.js';
import { AuthenticationMainService } from '../../workbench/services/authentication/electron-main/authenticationMainService.js';
import { AdhdYamlBackendProvider } from '../../workbench/services/mirror/electron-main/adhdBackendProvider.js';
import { AdhdMainService } from '../../workbench/services/mirror/electron-main/adhdMainService.js';
import { BadgeYamlBackendProvider } from '../../workbench/services/mirror/electron-main/badgeBackendProvider.js';
import { BadgeMainService } from '../../workbench/services/mirror/electron-main/badgeMainService.js';
import { CanvasYamlBackendProvider } from '../../workbench/services/mirror/electron-main/canvasBackendProvider.js';
import { CanvasMainService } from '../../workbench/services/mirror/electron-main/canvasMainService.js';
import { FocusYamlBackendProvider } from '../../workbench/services/mirror/electron-main/focusBackendProvider.js';
import { FocusMainService } from '../../workbench/services/mirror/electron-main/focusMainService.js';
import { MirrorNodeOperationMainService } from '../../workbench/services/mirror/electron-main/mirrorNodeOperationMainService.js';
import { WorkbenchSearchBackendProvider } from '../../workbench/services/search/electron-main/searchBackendProvider.js';
import { SearchMainService } from '../../workbench/services/search/electron-main/searchMainService.js';
import { CanvasListingMainService } from '../../workbench/services/workspace/electron-main/canvasListingMainService.js';
import type { BaseHalfApplicationOptions } from './app.js';
import type { MainChannelRegistryOptions } from './mainChannelRegistry.js';

export interface BaseHalfMainServicesOptions {
  readonly preloadPath: string;
  readonly rendererHtmlPath: string;
  readonly rendererUrl?: string | undefined;
  readonly configDir?: string;
  readonly trash?: (path: string) => Promise<void>;
  readonly getDisplays?: () => Display[];
}

export interface BaseHalfMainServices {
  readonly channelRegistry: Pick<
    MainChannelRegistryOptions,
    'getWorkspaceRoot' | 'services' | 'suppressNativeContextMenu'
  >;
  readonly windowLifecycle: WindowLifecycleMainService;
  readonly application: Pick<
    BaseHalfApplicationOptions,
    | 'cleanupUpdateLeftovers'
    | 'prefs'
    | 'spawnWindow'
    | 'startBackgroundUpdateChecks'
    | 'windowSecurity'
    | 'windowSession'
    | 'workspaceSurfaces'
  >;
}

/**
 * Main-process service composition, mirroring VS Code's `CodeMain.createServices`
 * and `CodeApplication.initServices` split at BaseHalf scale. This module wires
 * host services together; the electron-main entrypoint only boots the resulting
 * application.
 */
export function createBaseHalfMainServices(
  opts: BaseHalfMainServicesOptions,
): BaseHalfMainServices {
  const configDir = opts.configDir ?? defaultConfigDir();
  const secrets = createSafeStorageSecrets(configDir);
  const prefs = new PrefsStore(configDir);
  const adhdService = new AdhdMainService(new AdhdYamlBackendProvider());
  const renameCascadeTargets: {
    canvas?: CanvasMainService;
    focus?: FocusMainService;
  } = {};
  const badgeService = new BadgeMainService(
    new BadgeYamlBackendProvider({
      cascade: {
        relocateCanvas: (root, args) => {
          const service = renameCascadeTargets.canvas;
          if (service === undefined) throw new Error('Canvas service not initialized.');
          return service.relocate(root, args);
        },
        relocateAdhd: (root, args) => adhdService.relocate(root, args),
        relocateFocus: (root, args) => {
          const service = renameCascadeTargets.focus;
          if (service === undefined) throw new Error('Focus service not initialized.');
          return service.relocate(root, args);
        },
      },
    }),
  );
  const canvasService = new CanvasMainService(
    new CanvasYamlBackendProvider({ badges: badgeService }),
  );
  renameCascadeTargets.canvas = canvasService;
  const focusService = new FocusMainService(new FocusYamlBackendProvider());
  renameCascadeTargets.focus = focusService;
  const watcherService = new WorkspaceWatcherMainService({
    mirror: {
      getBadge: (root, args) => badgeService.get(root, args),
      setBadge: (root, args) => badgeService.set(root, args),
      markOrphan: (root, args) => badgeService.markOrphan(root, args),
      rename: (root, args) => badgeService.rename(root, args),
      pruneDanglingFocus: (root) => focusService.pruneDangling(root),
    },
  });
  const mirrorNodeOperations = new MirrorNodeOperationMainService({
    badges: badgeService,
    canvas: canvasService,
    focus: focusService,
    adhd: adhdService,
  });
  const workspaceFilesService = new WorkspaceFilesMainService({
    mirror: mirrorNodeOperations,
    trash: opts.trash ?? ((path: string) => shell.trashItem(path)),
  });
  const canvasListingService = new CanvasListingMainService({
    mirror: {
      getBadge: (root, args) => badgeService.get(root, args),
      getCanvas: (root, args) => canvasService.get(root, args),
    },
  });
  const workspaceService = new WorkspaceMainService(
    new DesktopWorkspaceBackendProvider({
      configDir,
      startWatcher: (root) => watcherService.start(root),
      canvasListing: canvasListingService,
      entryMirror: mirrorNodeOperations,
      trash: opts.trash ?? ((path: string) => shell.trashItem(path)),
      demo: {
        setBadge: (root, args) => badgeService.set(root, args),
        setCanvasCard: (root, args) => canvasService.setCard(root, args),
        connectCanvas: (root, args) => canvasService.connect(root, args),
        setFocus: (root, args) => focusService.set(root, args),
      },
    }),
  );
  const searchService = new SearchMainService(
    new WorkbenchSearchBackendProvider({
      workspace: workspaceService,
      badges: badgeService,
    }),
  );
  const authenticationService = new AuthenticationMainService();
  const githubAuthenticationProvider = new GithubAuthenticationProvider({ secrets });
  authenticationService.registerProvider(githubAuthenticationProvider);
  const gitBackend = new GitCliBackendProvider({
    git: createGithubGitRunner(configDir, githubAuthenticationProvider),
    deleteWorkspaceEntry: (workspaceRoot, args) =>
      workspaceFilesService.deleteEntry(workspaceRoot, args),
  });
  const gitService = new GitMainService(gitBackend);
  const nativeHostService = new NativeHostMainService();
  const terminalService = new TerminalMainService();
  const updater = new Updater(configDir, prefs);
  const windowSecurity = new WindowSecurityMainService({
    rendererUrl: opts.rendererUrl,
  });
  const workspaceRegistry = new WorkspaceRegistryMainService({
    backend: new FileWorkspaceRegistryBackendProvider({
      configDir,
      stopWatcher: (root) => watcherService.stop(root).then(() => undefined),
    }),
  });
  const gitRemoteProvider = {
    getRemotes: async (workspaceRoot: string | null): Promise<readonly GitRemoteInfoLike[]> => {
      const { remotes } = await gitService.remotes(workspaceRoot);
      return remotes;
    },
  };
  const githubService = new GithubMainService({
    authentication: authenticationService,
    remoteProvider: gitRemoteProvider,
  });

  function persistWindowState(win: BrowserWindow): void {
    workspaceWindowFactory.persistWindowState(win);
  }

  function createWindow(workspaceRoot: string | null): Promise<BrowserWindow> {
    return workspaceWindowFactory.createWindow(workspaceRoot);
  }

  function spawnWindow(root: string | null): void {
    workspaceWindowFactory.spawnWindow(root);
  }

  const windowZoom = new WindowZoomMainService();
  const settingsService = new SettingsMainService({
    prefs,
    registry: new FileSettingsRegistryProvider({ configDir }),
    zoom: windowZoom.focusedWindowHooks,
  });
  const windowChrome = new WindowChromeMainService({
    installContextMenu,
    applyZoomToWindow: (win) => windowZoom.applyZoomToWindow(win),
  });
  const workspaceSurfaces: WorkspaceSurfacesMainService = new WorkspaceSurfacesMainService({
    registry: workspaceRegistry,
    getWorkspaceRoot,
    zoomHooks: windowZoom.focusedWindowHooks,
    spawnWindow,
    openRecentWorkspace: (name, mode): Promise<void> =>
      workspaceWindowRouter.openRecentWorkspace(name, mode),
    checkForUpdates: () => void updater.check({ background: false }),
  });
  const windowSession = new WindowSessionMainService({
    configDir,
    registry: workspaceRegistry,
    createWindow,
    getWorkspaceRoot,
    currentOpenKeys: () => workspaceSurfaces.currentOpenKeys(),
    getZoomLevel: (win) => windowZoom.getZoomLevel(win),
  });
  const windowLifecycle = new WindowLifecycleMainService({
    captureWindowState: (win) => {
      if (win.isDestroyed()) return null;
      const bounds = win.getBounds();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: win.isMaximized(),
        zoomLevel: windowZoom.getZoomLevel(win),
      };
    },
    persistAllWindows: () => windowSession.persistAllWindowsSync(),
    disposeAllTerminals: () => terminalService.disposeAllTerminals(),
  });
  const workspaceWindowFactory = new WorkspaceWindowFactoryMainService({
    configDir,
    preloadPath: opts.preloadPath,
    rendererHtmlPath: opts.rendererHtmlPath,
    rendererUrl: opts.rendererUrl,
    getDisplays: opts.getDisplays ?? (() => screen.getAllDisplays()),
    getWorkspaceRoot,
    getWorkspaceRootById,
    setWorkspaceRoot,
    clearWorkspaceRoot,
    touchWorkspace: (root) => workspaceSurfaces.touchWorkspace(root),
    currentOpenKeys: () => workspaceSurfaces.currentOpenKeys(),
    refreshWorkspaceSurfaces: () => workspaceSurfaces.refresh(),
    installWindowCloseHandlers: (win, onClosed) =>
      windowLifecycle.installWindowCloseHandlers(win, onClosed),
    disposeTerminalsForWindow: (webContentsId) =>
      terminalService.disposeTerminalsForWindow(webContentsId),
    stopWatcherIfOrphaned: (root) => workspaceWindowRouter.stopWatcherIfOrphaned(root),
    rememberZoom: (win, level) => windowZoom.rememberWindow(win, level),
    forgetZoom: (webContentsId) => windowZoom.forgetWindow(webContentsId),
    getZoomLevel: (win) => windowZoom.getZoomLevel(win),
    installChrome: (win) => windowChrome.install(win),
  });
  windowZoom.setPersistWindowState(persistWindowState);
  const workspaceWindowRouter = new WorkspaceWindowRouterMainService({
    registry: workspaceRegistry,
    rootForName: (name): Promise<string | null> => workspaceSurfaces.rootForName(name),
    getWorkspaceRoot,
    setWorkspaceRoot,
    isRootStillBound: (root) => workspaceSurfaces.isRootStillBound(root),
    touchWorkspace: (root) => workspaceSurfaces.touchWorkspace(root),
    refreshWorkspaceSurfaces: () => workspaceSurfaces.refresh(),
    createWindow,
    flushWindow: (win) => windowLifecycle.flushWindow(win),
    persistWindowState,
    disposeTerminalsForWindow: (webContentsId) =>
      terminalService.disposeTerminalsForWindow(webContentsId),
  });

  return {
    channelRegistry: {
      services: {
        adhd: adhdService,
        authentication: authenticationService,
        badge: badgeService,
        canvas: canvasService,
        focus: focusService,
        git: gitService,
        github: githubService,
        nativeHost: nativeHostService,
        search: searchService,
        settings: settingsService,
        terminal: terminalService,
        updater,
        watcherEvents: watcherService,
        workspaceFiles: workspaceFilesService,
        workspace: workspaceService,
        workspaceWindowRouter,
      },
      getWorkspaceRoot,
      suppressNativeContextMenu: claimNativeContextMenuSuppression,
    },
    windowLifecycle,
    application: {
      windowSecurity,
      workspaceSurfaces,
      prefs,
      windowSession,
      cleanupUpdateLeftovers,
      startBackgroundUpdateChecks: () => startBackgroundUpdateChecks(updater, prefs),
      spawnWindow,
    },
  };
}

export function baseHalfMainPaths(
  here: string,
): Pick<BaseHalfMainServicesOptions, 'preloadPath' | 'rendererHtmlPath'> {
  return {
    preloadPath: join(here, '../preload/index.cjs'),
    rendererHtmlPath: join(here, '../renderer/index.html'),
  };
}

export type DesktopMainServicesOptions = BaseHalfMainServicesOptions;
export type DesktopMainServices = BaseHalfMainServices;
export const createDesktopMainServices = createBaseHalfMainServices;
export const desktopMainPaths = baseHalfMainPaths;
