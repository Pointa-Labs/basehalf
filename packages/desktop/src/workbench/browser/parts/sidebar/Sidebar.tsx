import type { JSX } from 'react';
import { NavTree } from '../../../contrib/files/browser/NavTree.js';
import { ScmViewPane } from '../../../contrib/scm/browser/ScmViewPane.js';
import { useScmViewPaneModel } from '../../../contrib/scm/browser/useScmViewPaneModel.js';
import { SearchPanel } from '../../../contrib/search/browser/SearchPanel.js';
import { Timeline } from '../../../contrib/timeline/browser/Timeline.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { useLayoutStore } from '../../layout/layoutStore.js';
import { color, font, shadow, space } from '../../style/design.js';
import { ActivityBar } from '../activitybar/ActivityBar.js';
import { SidebarSash } from './SidebarSash.js';

export const Sidebar = (): JSX.Element | null => {
  const current = useWorkspaceStore((s) => s.current);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const sidebarView = useLayoutStore((s) => s.sidebarView);
  const setSidebarView = useLayoutStore((s) => s.setSidebarView);
  const currentWs = workspaces.find((w) => w.name === current);

  // Fully closed — render nothing (the title-bar toggle brings it back), like
  // hiding a primary side panel; no leftover thin strip / vertical icon rail.
  if (!sidebarOpen) return null;

  return (
    <aside
      style={{
        // The LEFT region FLOATS over the canvas (absolute, not a flex sibling),
        // so showing / hiding / resizing it never reflows or shifts the canvas —
        // the canvas is a full-width backdrop the sidebar sits on top of, mirroring
        // how the right editor never pushes the canvas content. Pinned to the
        // canvas region's left edge; clipped to it by the region's overflow.
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 6,
        width: sidebarWidth,
        borderRight: `1px solid ${color.border}`,
        background: color.surfaceMuted,
        boxShadow: shadow.raised,
        fontFamily: font.sans,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Activity bar — the top icon strip; switches the panel below between the
          file tree and Source Control (git). Room for more entries (search, …)
          as those features land. */}
      <ActivityBar view={sidebarView} onSelect={setSidebarView} />
      {sidebarView === 'scm' && currentWs ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <SourceControlView key={currentWs.path} />
        </div>
      ) : sidebarView === 'search' && currentWs ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <SearchPanel key={currentWs.path} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {currentWs ? (
            // NavTree owns its own VS Code-style Explorer header (folder name + New
            // File/Folder/Refresh/Collapse actions) + scroll. No unreachable branch:
            // Workbench selectRegion routes folder-missing to a full-region
            // <WorkspaceMissing/>, so the Sidebar always shows a reachable workspace.
            // Below it: the Timeline (the open file's git history), VS Code-style.
            <>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <NavTree rootPath={currentWs.path} />
              </div>
              <Timeline />
            </>
          ) : (
            <div
              style={{
                padding: `${space[5]}px ${space[4]}px`,
                color: color.textTertiary,
                fontSize: font.size.caption,
                lineHeight: 1.5,
              }}
            >
              Open a folder to get started — press <code>⌘O</code>, or <code>⌘K</code> for
              everything.
            </div>
          )}
        </div>
      )}
      <SidebarSash />
    </aside>
  );
};

const SourceControlView = (): JSX.Element => {
  const model = useScmViewPaneModel();
  return <ScmViewPane model={model} />;
};
