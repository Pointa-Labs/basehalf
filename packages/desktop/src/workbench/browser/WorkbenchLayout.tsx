import type { JSX } from 'react';
import { Canvas } from '../contrib/basehalfCanvas/browser/Canvas.js';
import { FdaTip } from '../contrib/fullDiskAccess/browser/FdaTip.js';
import { SettingsHost } from '../contrib/preferences/browser/Settings.js';
import { TerminalDock } from '../contrib/terminal/browser/TerminalDock.js';
import { Welcome } from '../contrib/welcome/browser/Welcome.js';
import { WorkspaceMissing } from '../contrib/workspace/browser/WorkspaceMissing.js';
import { ContextMenuHost } from './parts/contextmenu/ContextMenu.js';
import { DialogHost } from './parts/dialogs/Dialog.js';
import { EditorOverlay } from './parts/editor/EditorOverlay.js';
import { ErrorBanner } from './parts/notifications/ErrorBanner.js';
import { ToastHost } from './parts/notifications/ToastHost.js';
import { WhatsNewHost } from './parts/notifications/WhatsNew.js';
import { Sidebar } from './parts/sidebar/Sidebar.js';
import { StatusBar } from './parts/statusbar/StatusBar.js';
import { TitleBar } from './parts/titlebar/TitleBar.js';
import { CommandPalette } from './quickaccess/CommandPalette.js';
import { color } from './style/design.js';
import { WorkbenchDropOverlay, type WorkbenchDropTarget } from './workbenchDnd.js';
import type { AppRegion } from './workbenchRegion.js';

export interface WorkbenchLayoutProps {
  readonly current: string | null;
  readonly region: AppRegion;
  readonly error: string;
  readonly notice: string;
  readonly clearError: () => void;
  readonly clearNotice: () => void;
  readonly dropTarget: WorkbenchDropTarget;
}

/**
 * Renderer workbench layout, analogous to VS Code's `workbench/browser/layout`.
 * It composes visual parts; global behavior lives in workbench contributions.
 */
export function WorkbenchLayout({
  current,
  region,
  error,
  notice,
  clearError,
  clearNotice,
  dropTarget,
}: WorkbenchLayoutProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        margin: 0,
        background: color.bg,
      }}
      {...dropTarget.rootProps}
    >
      <TitleBar />
      <FdaTip />
      <WorkbenchBody region={region} />
      {region === 'canvas' && <StatusBar />}
      {error && <ErrorBanner message={error} onDismiss={clearError} />}
      {!error && notice && <ErrorBanner message={notice} onDismiss={clearNotice} tone="info" />}
      <WorkbenchHosts />
      <WorkbenchDropOverlay current={current} visible={dropTarget.isActive} />
    </div>
  );
}

function WorkbenchBody({ region }: { readonly region: AppRegion }): JSX.Element {
  if (region === 'welcome') return <Welcome />;
  if (region === 'recovery') return <WorkspaceMissing />;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <main style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
        <Canvas />
        <EditorOverlay />
        <Sidebar />
      </main>
      <TerminalDock />
    </div>
  );
}

function WorkbenchHosts(): JSX.Element {
  return (
    <>
      <SettingsHost />
      <WhatsNewHost />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
      <CommandPalette />
    </>
  );
}
