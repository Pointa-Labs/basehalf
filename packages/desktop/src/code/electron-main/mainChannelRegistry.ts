import { type WebContents, ipcMain } from 'electron';
import { SettingsMainChannel } from '../../platform/configuration/electron-main/configurationMainChannel.js';
import type { SettingsMainService } from '../../platform/configuration/electron-main/configurationMainService.js';
import {
  WatcherEventForwarderMainService,
  type WatcherEventSource,
} from '../../platform/files/electron-main/watcherEventForwarderMainService.js';
import { NativeHostMainChannel } from '../../platform/native/electron-main/nativeHostMainChannel.js';
import type { NativeHostMainService } from '../../platform/native/electron-main/nativeHostMainService.js';
import { TerminalMainChannel } from '../../platform/terminal/electron-main/terminalMainChannel.js';
import type { TerminalMainService } from '../../platform/terminal/node/terminalMainService.js';
import type { UpdateMainService } from '../../platform/update/common/update.js';
import { UpdateMainChannel } from '../../platform/update/electron-main/updateMainChannel.js';
import { WINDOW_IPC_CHANNELS } from '../../platform/windows/common/window.js';
import { WorkspaceWindowMainChannel } from '../../platform/windows/electron-main/workspaceWindowMainChannel.js';
import type { WorkspaceWindowRouterMainService } from '../../platform/windows/electron-main/workspaceWindowRouterMainService.js';
import { WorkspaceMainChannel } from '../../platform/workspaces/electron-main/workspacesMainChannel.js';
import type { WorkspaceMainService } from '../../platform/workspaces/electron-main/workspacesMainService.js';
import { GithubMainChannel } from '../../workbench/contrib/githubPullRequests/electron-main/githubMainChannel.js';
import type { GithubMainService } from '../../workbench/contrib/githubPullRequests/electron-main/githubMainService.js';
import { GitMainChannel } from '../../workbench/contrib/scm/electron-main/gitMainChannel.js';
import type { GitMainService } from '../../workbench/contrib/scm/electron-main/gitMainService.js';
import { AuthenticationMainChannel } from '../../workbench/services/authentication/electron-main/authenticationMainChannel.js';
import type { AuthenticationMainService } from '../../workbench/services/authentication/electron-main/authenticationMainService.js';
import { AdhdMainChannel } from '../../workbench/services/mirror/electron-main/adhdMainChannel.js';
import type { AdhdMainService } from '../../workbench/services/mirror/electron-main/adhdMainService.js';
import { BadgeMainChannel } from '../../workbench/services/mirror/electron-main/badgeMainChannel.js';
import type { BadgeMainService } from '../../workbench/services/mirror/electron-main/badgeMainService.js';
import { CanvasMainChannel } from '../../workbench/services/mirror/electron-main/canvasMainChannel.js';
import type { CanvasMainService } from '../../workbench/services/mirror/electron-main/canvasMainService.js';
import { FocusMainChannel } from '../../workbench/services/mirror/electron-main/focusMainChannel.js';
import type { FocusMainService } from '../../workbench/services/mirror/electron-main/focusMainService.js';
import { SearchMainChannel } from '../../workbench/services/search/electron-main/searchMainChannel.js';
import type { SearchMainService } from '../../workbench/services/search/electron-main/searchMainService.js';

type WorkspaceRootResolver = (sender: WebContents) => string | null;

interface SyncIpcEvent {
  returnValue: unknown;
}

interface SyncIpcMainLike {
  on(channel: string, listener: (event: SyncIpcEvent) => void): void;
}

export interface MainChannelRegistryServices {
  readonly adhd: AdhdMainService;
  readonly authentication: AuthenticationMainService;
  readonly badge: BadgeMainService;
  readonly canvas: CanvasMainService;
  readonly focus: FocusMainService;
  readonly git: GitMainService;
  readonly github: GithubMainService;
  readonly nativeHost: NativeHostMainService;
  readonly search: SearchMainService;
  readonly settings: SettingsMainService;
  readonly terminal: TerminalMainService;
  readonly updater: UpdateMainService;
  readonly watcherEvents: WatcherEventSource;
  readonly workspace: WorkspaceMainService;
  readonly workspaceWindowRouter: WorkspaceWindowRouterMainService;
}

export interface MainChannelRegistryOptions {
  readonly services: MainChannelRegistryServices;
  readonly getWorkspaceRoot: WorkspaceRootResolver;
  readonly suppressNativeContextMenu: () => void;
  readonly ipc?: SyncIpcMainLike;
}

/**
 * Main-process IPC channel composition. This is the BaseHalf-scale analogue of
 * VS Code's `CodeApplication.initChannels(...)`: services are composed once, then
 * exposed through narrow named channels instead of a generic command bus.
 */
export class MainChannelRegistry {
  constructor(private readonly opts: MainChannelRegistryOptions) {}

  register(): void {
    const { services, getWorkspaceRoot } = this.opts;

    new AdhdMainChannel(services.adhd, getWorkspaceRoot).register();
    new AuthenticationMainChannel(services.authentication).register();
    new BadgeMainChannel(services.badge, getWorkspaceRoot).register();
    new CanvasMainChannel(services.canvas, getWorkspaceRoot).register();
    new FocusMainChannel(services.focus, getWorkspaceRoot).register();
    new GitMainChannel(services.git, getWorkspaceRoot).register();
    new GithubMainChannel(services.github, getWorkspaceRoot).register();
    new NativeHostMainChannel(services.nativeHost, getWorkspaceRoot).register();
    new SearchMainChannel(services.search, getWorkspaceRoot).register();
    new SettingsMainChannel(services.settings, getWorkspaceRoot).register();
    new TerminalMainChannel(services.terminal, getWorkspaceRoot).register();
    new UpdateMainChannel(services.updater).register();
    new WatcherEventForwarderMainService({
      events: services.watcherEvents,
      getWorkspaceRoot,
    }).register();
    new WorkspaceMainChannel(services.workspace, getWorkspaceRoot).register();
    new WorkspaceWindowMainChannel(services.workspaceWindowRouter).register();

    this.registerContextMenuSuppression();
  }

  private registerContextMenuSuppression(): void {
    const ipc = this.opts.ipc ?? ipcMain;
    ipc.on(WINDOW_IPC_CHANNELS.suppressNextContextMenu, (event) => {
      this.opts.suppressNativeContextMenu();
      event.returnValue = true;
    });
  }
}
