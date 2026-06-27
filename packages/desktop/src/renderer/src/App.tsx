import { type JSX, useEffect, useState } from 'react';
import { Canvas } from './components/Canvas.js';
import {
  CommandPalette,
  isCommandPaletteOpen,
  openCommandPalette,
} from './components/CommandPalette.js';
import { ContextMenuHost } from './components/ContextMenu.js';
import { DialogHost } from './components/Dialog.js';
import { EditorOverlay } from './components/EditorOverlay.js';
import { ErrorBanner } from './components/ErrorBanner.js';
import { FdaTip } from './components/FdaTip.js';
import { SettingsHost, openSettings } from './components/Settings.js';
import { Sidebar } from './components/Sidebar.js';
import { StatusBar } from './components/StatusBar.js';
import { TerminalDock } from './components/TerminalDock.js';
import { TitleBar } from './components/TitleBar.js';
import { WhatsNewHost } from './components/WhatsNew.js';
import { WorkspaceMissing } from './components/WorkspaceMissing.js';
import { Welcome } from './components/welcome/Welcome.js';
import { color, font, motion, radius, space } from './design.js';
import { removeActiveWorkspace, renameActiveWorkspace } from './lib/actions.js';
import { selectRegion } from './lib/appRegion.js';
import { flushAll } from './lib/editorFlush.js';
import { droppedPaths, handleExternalDrop } from './lib/importDrop.js';
import { useReadingMode } from './lib/readingMode.js';
import { scheduleGitStatusRefresh, useGitStatusStore } from './store/gitStatus.js';
import { useLayoutStore } from './store/layout.js';
import { wireUpdateBridge } from './store/updates.js';
import { useWorkspaceStore } from './store/workspace.js';

export const App = (): JSX.Element => {
  const error = useWorkspaceStore((s) => s.error);
  const clearError = useWorkspaceStore((s) => s.clearError);
  const notice = useWorkspaceStore((s) => s.notice);
  const clearNotice = useWorkspaceStore((s) => s.clearNotice);
  const current = useWorkspaceStore((s) => s.current);
  const currentReachable = useWorkspaceStore((s) => s.currentReachable);
  const refresh = useWorkspaceStore((s) => s.refresh);
  // Drag-drop folder → add as workspace. Tracked at the App level so the
  // overlay covers everything (TopBar, Sidebar, Canvas, FilePreview).
  // Using a depth counter rather than a boolean — dragenter/dragleave fire
  // on every nested child, so a naive boolean flickers on/off as the
  // pointer moves between them.
  const [dragDepth, setDragDepth] = useState(0);

  useEffect(() => {
    void refresh();
    void useWorkspaceStore.getState().refreshOpenRoots();
  }, [refresh]);

  // The welcome screen's recent list reacts to OTHER windows: when a window opens,
  // closes, or rebinds — or the registry changes — main broadcasts here. Re-list
  // (recency order may have moved) + re-fetch the open set (the "Open" markers).
  useEffect(
    () =>
      window.bh.onWorkspacesWindowsChanged(() => {
        const ws = useWorkspaceStore.getState();
        void ws.refresh();
        void ws.refreshOpenRoots();
      }),
    [],
  );

  // Global rename listener: when the watcher detects a rename of the
  // currently-open file, rebind currentFile to the new path so the user
  // doesn't have to manually re-click in the NavTree. Without this, the
  // editor stays on the OLD path (which the unlink just flagged as
  // deleted) until the user notices the new file in the sidebar.
  useEffect(() => {
    const unsub = window.bh.onFileEvent((event) => {
      if (event.type !== 'rename') return;
      // If the renamed file is open in any tab, rebind its path in place (no
      // flush — the OLD path is gone on disk; flushing would resurrect a deleted
      // file and trap the editor on a vanished path). renameTab no-ops if the
      // file isn't open. The active tab remounts on the new path's bytes.
      useWorkspaceStore.getState().renameTab(event.fromRelPath, event.toRelPath);
    });
    return unsub;
  }, []);

  // Keep git status live for the SCM panel + the tree / canvas / gutter coloring:
  // refresh on workspace change, and (debounced) on any working-tree file event.
  // (A `.git/`-only change — e.g. an external branch switch — fires no fs event;
  // the SCM panel's manual refresh covers those.)
  useEffect(() => {
    if (current === null) {
      useGitStatusStore.getState().reset();
      return;
    }
    void useGitStatusStore.getState().refresh();
    const unsub = window.bh.onFileEvent(() => scheduleGitStatusRefresh());
    return unsub;
  }, [current]);

  // Global keyboard shortcuts:
  //  - Cmd/Ctrl+S  — open search (the primary shortcut; ⌘K is an alias)
  //  - Cmd/Ctrl+K  — open the command palette (alias of ⌘S)
  //  - Cmd/Ctrl+N  — new note prompt (no-op without a current workspace)
  //  - Cmd/Ctrl+B  — toggle the sidebar (the conventional side-panel shortcut)
  // Esc / click-outside close the palette via the palette itself. Lives here
  // (not in TitleBar) so ⌘B keeps working in fullscreen, where the title bar —
  // and its toggle button — unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Safety net for a stranded inline-rename: the InlineEditInput stops Esc
        // propagation WHILE focused (so this never fires mid-rename), so an Esc
        // that reaches here means no rename input mounted (e.g. a create into a
        // surface not currently visible). Clear the flag so the user isn't stuck.
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
        // ⌘K always opens the command palette, even from inside the editor.
        e.preventDefault();
        openCommandPalette();
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        // ⌘S opens search — but NOT while the user is writing. The editor owns
        // ⌘S as "save now" (muscle memory); popping the palette over their text
        // every time they reflexively save was the bug. Yield to the editable
        // surface there; preventDefault still stops the browser save-page dialog.
        if (editable) return;
        e.preventDefault();
        openCommandPalette();
        return;
      }
      if (e.key === 'b' || e.key === 'B') {
        // ⌘B is "bold" inside any editable surface (the BlockNote note editor,
        // inputs, the ⌘K palette field). Yield to it there; only toggle the
        // sidebar when focus is on inert chrome — as well-behaved editors do.
        if (editable) return;
        // The sidebar exists only in the 'canvas' region; on the welcome / recovery
        // surfaces there's nothing to toggle, so ⌘B is inert there (and never flips
        // an invisible sidebarOpen that would surprise on the next workspace open).
        const ws = useWorkspaceStore.getState();
        if (selectRegion(ws.current, ws.currentReachable) !== 'canvas') return;
        e.preventDefault();
        useLayoutStore.getState().toggleSidebar();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        // The command palette is modal (its own backdrop + focused input). ⌘N
        // while it's open would open the New-note dialog UNDERNEATH the palette
        // and steal focus into an obscured input — keystrokes vanish. Let the
        // palette field handle the press instead.
        if (isCommandPaletteOpen()) return;
        // Yield to an editable surface — the note editor, an input, or the focused
        // terminal (xterm's <textarea>) — so ⌘N never steals focus out of where
        // the user is typing.
        if (editable) return;
        // Instant note — a real `untitled-N.md` opens for typing right away;
        // no filename dialog up front (rename later, when it has a subject).
        // Created in the folder the canvas is scoped into, where you're looking.
        e.preventDefault();
        const ws = useWorkspaceStore.getState();
        void ws.newNote({ folder: ws.folderScope });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Quit handshake: main intercepts the window close and asks us to flush every
  // editor before quitting (the auto-save debounce could otherwise drop the last
  // keystrokes). Returning the flush result lets main cancel the quit when a
  // conflict / failed write is blocking, so those edits aren't lost on ⌘Q.
  useEffect(() => window.bh.onFlushRequest(() => flushAll()), []);

  // External links (in a Markdown preview or note) open in the system browser,
  // never in-app. The main process refuses all in-renderer navigation (so a
  // workspace file's link can't hijack the app), which would otherwise make
  // such links dead. We intercept the click here and route http(s) URLs through
  // the allowlisted `shell:open-external` IPC. Delegated at the document so it
  // covers every preview tile and the editor without per-anchor wiring.
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      void window.bh.openExternal(href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // File ▸ Open Folder… (⌘O) and the right-click "Open Folder…" both fire this
  // from the main process. Route it through the same pickAndAdd the in-app
  // flows use so the folder-open UX is identical everywhere (one door).
  useEffect(
    () => window.bh.onMenuOpenFolder(() => void useWorkspaceStore.getState().pickAndAdd()),
    [],
  );

  // File ▸ Rename / Remove Workspace… — the management dialogs live in
  // lib/actions (they no-op when no workspace is open); main just triggers.
  useEffect(
    () =>
      window.bh.onMenuWorkspaceAction((action) => {
        if (action === 'rename') void renameActiveWorkspace();
        else void removeActiveWorkspace();
      }),
    [],
  );

  // App menu ▸ Settings… (⌘,) — the overlay lives in the renderer; main just
  // triggers, same as the other menu relays.
  useEffect(() => window.bh.onMenuOpenSettings(openSettings), []);

  // Reading mode (the `editor.readingMode` setting): resolve the effective value
  // on load and whenever the bound workspace changes (its per-workspace override
  // may differ from the global default). Settings refreshes it on toggle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the intentional re-run trigger (re-resolve when the bound workspace changes); the body reads nothing off it.
  useEffect(() => {
    void useReadingMode.getState().refresh();
  }, [current]);

  // Notices are transient confirmations ("Copied … into …") — they retire
  // themselves; only errors require a human dismissal.
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(clearNotice, 6000);
    return () => window.clearTimeout(id);
  }, [notice, clearNotice]);

  // Self-update: mirror main's state machine from startup. The state surfaces
  // in chrome (the title-bar UpdateChip), not a modal — a background-found update
  // simply makes the chip offer "Download"; nothing installs without a click.
  useEffect(() => {
    wireUpdateBridge();
  }, []);

  const region = selectRegion(current, currentReachable);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        margin: 0,
        background: color.bg,
      }}
      onDragEnter={(e) => {
        // Only react to Finder-drag (or any external drag carrying files).
        // Internal drag-source events (text selections, react-flow node drags)
        // don't have the "Files" type and shouldn't show the overlay.
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragDepth((d) => Math.max(0, d - 1));
      }}
      onDragOver={(e) => {
        // Required to allow drop. Without preventDefault here the browser
        // treats the drop area as inert and onDrop never fires.
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        // Always clear the overlay — even when the canvas (a descendant)
        // already handled this drop and marked it defaultPrevented; routing
        // it again here would import every file twice.
        setDragDepth(0);
        if (e.defaultPrevented) return;
        e.preventDefault();
        // Shared routing (lib/importDrop): folders → add/open as workspace;
        // files → COPY into the open workspace. This is the catch-all for
        // drops outside the canvas (sidebar, editor area); the canvas has its
        // own handler that also places the new card at the drop point.
        void handleExternalDrop(droppedPaths(e.dataTransfer));
      }}
    >
      <TitleBar />
      <FdaTip />
      {/* The top-level gate (one pure decision — selectRegion). Welcome AND the
          folder-missing recovery are each the SOLE occupant of the working region
          — no sidebar/canvas/terminal alongside — so neither surface ever renders
          twice. Only a reachable workspace gets the docked regions. */}
      {region === 'welcome' ? (
        <Welcome />
      ) : region === 'recovery' ? (
        <WorkspaceMissing />
      ) : (
        // Docked regions, left → right: the canvas region (the spatial map, takes
        // whatever the terminal leaves) | TerminalDock (a FIXED right-most home
        // for the embedded terminal — where TUI agents run). Opening a file mounts
        // the EditorOverlay INSIDE the canvas region: a full-canvas editor over the
        // canvas (z-index 5 — above the canvas + its chrome, below the Sidebar's 6
        // so the nav stays clickable). The Sidebar (nav) floats OVER the canvas, so
        // toggling it never reflows the map.
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
          {/* The canvas region — flex:1 so it takes whatever the terminal leaves.
              position:relative anchors the canvas's own absolute chrome (New-note
              button, context chip, empty hint), the EditorOverlay (inset:0 over the
              canvas) AND the floating Sidebar overlay, whose overflow:hidden clips
              the sidebar to this region. The EditorOverlay sits between the canvas
              and the sidebar in DOM order + z-index. */}
          <main style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
            <Canvas />
            <EditorOverlay />
            <Sidebar />
          </main>
          <TerminalDock />
        </div>
      )}
      {region === 'canvas' && <StatusBar />}
      {error && <ErrorBanner message={error} onDismiss={clearError} />}
      {!error && notice && <ErrorBanner message={notice} onDismiss={clearNotice} tone="info" />}
      {/* Before DialogHost/CommandPalette: same z-index, so DOM order keeps
          transient dialogs and the palette above the Settings surface. */}
      <SettingsHost />
      <WhatsNewHost />
      <DialogHost />
      <ContextMenuHost />
      <CommandPalette />
      {dragDepth > 0 && (
        <div
          // The overlay covers everything but doesn't intercept events —
          // pointerEvents:none lets the drag continue to fire on the
          // underlying drop target (the App root div above).
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(40, 100, 200, 0.08)',
            border: `3px dashed ${color.accent}`,
            zIndex: 200,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: `bh-fade-in ${motion.fast}`,
          }}
        >
          <div
            style={{
              background: color.surface,
              borderRadius: radius.xl,
              padding: `${space[4]}px ${space[6]}px`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
              fontFamily: font.sans,
              fontSize: font.size.body,
              color: color.textPrimary,
              fontWeight: font.weight.medium,
              letterSpacing: -0.1,
            }}
          >
            {current
              ? 'Drop files to copy them into this workspace — or a folder to open as a workspace'
              : 'Drop a folder to add as a workspace'}
          </div>
        </div>
      )}
    </div>
  );
};
