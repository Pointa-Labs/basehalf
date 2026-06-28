import type { SettingsBridge } from '../../platform/configuration/electron-sandbox/configurationBridge.js';
import type { FileEventBridge } from '../../platform/files/electron-sandbox/fileEventBridge.js';
import type { NativeHostBridge } from '../../platform/native/electron-sandbox/nativeHostBridge.js';
import type { TerminalBridge } from '../../platform/terminal/electron-sandbox/terminalBridge.js';
import type { UpdateBridge } from '../../platform/update/electron-sandbox/updateBridge.js';
import type { WorkspaceBridge } from '../../platform/workspaces/electron-sandbox/workspaceBridge.js';
import type { GithubBridgeContainer } from '../../workbench/contrib/githubPullRequests/electron-sandbox/githubBridge.js';
import type { GitBridgeContainer } from '../../workbench/contrib/scm/electron-sandbox/gitBridge.js';
import type { AuthenticationBridge } from '../../workbench/services/authentication/electron-sandbox/authenticationBridge.js';
import type { AdhdBridge } from '../../workbench/services/mirror/electron-sandbox/adhdBridge.js';
import type { BadgeBridge } from '../../workbench/services/mirror/electron-sandbox/badgeBridge.js';
import type { CanvasBridge } from '../../workbench/services/mirror/electron-sandbox/canvasBridge.js';
import type { FocusBridge } from '../../workbench/services/mirror/electron-sandbox/focusBridge.js';
import type { SearchBridge } from '../../workbench/services/search/electron-sandbox/searchBridge.js';

/**
 * Stable sandbox API exposed to the renderer under `window.bh`. The preload
 * composes the small channel bridges; renderer/browser services consume this
 * single typed surface without owning its shape.
 */
export interface BaseHalfSandboxApi
  extends AdhdBridge,
    BadgeBridge,
    CanvasBridge,
    FocusBridge,
    NativeHostBridge,
    GitBridgeContainer,
    GithubBridgeContainer,
    AuthenticationBridge,
    SearchBridge,
    SettingsBridge,
    WorkspaceBridge,
    UpdateBridge,
    FileEventBridge {
  readonly terminal: TerminalBridge;
}
