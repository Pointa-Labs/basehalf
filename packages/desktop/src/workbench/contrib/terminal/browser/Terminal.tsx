import { type JSX, useEffect, useRef, useState } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { color, font, space } from '../../../browser/style/design.js';
import { terminalService } from '../../../services/terminal/browser/terminalService.js';
import { termRegistry } from './termRegistry.js';
import {
  type XtermTerminalHandle,
  createXtermTerminal,
  fitXtermTerminal,
  terminalHostStyle,
} from './xtermTerminal.js';

/**
 * One embedded terminal session. Owns its own pty (created on mount, killed on
 * unmount) and renders it through xterm.js. The pty itself lives in main — this
 * is a thin view wired over terminalService.
 *
 * Lifecycle is keyed by the parent: re-rooting to a new workspace and "Restart"
 * are both done by changing this component's React key (the idiomatic reset), so
 * the spawn effect stays a clean mount-once. `active` drives focus + a refit when
 * this view becomes visible (an inactive tab is display:none, where xterm can't
 * measure itself). `onRestart` asks the parent to remount us after the shell exits.
 */
export const TerminalView = ({
  paneId,
  active,
  onRestart,
  onTitle,
  onDims,
  onActivity,
}: {
  /** The pane this view backs — registers its xterm instance under it so the
   *  dock's context menu can reach Copy/Paste/Clear for the clicked pane. */
  paneId: string;
  active: boolean;
  onRestart: () => void;
  onTitle?: (title: string) => void;
  onDims?: (cols: number, rows: number) => void;
  onActivity?: () => void;
}): JSX.Element => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminalHandle | null>(null);
  const idRef = useRef<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  // Held in refs so the mount-once effect always calls the latest callback
  // without re-running (which would respawn the pty).
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const onDimsRef = useRef(onDims);
  onDimsRef.current = onDims;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  // Held in a ref like the callbacks so the mount-once spawn effect can register
  // this pane's xterm WITHOUT taking paneId as a reactive dep (it's stable per
  // mounted view — the dock keys TerminalView by pane).
  const paneIdRef = useRef(paneId);
  paneIdRef.current = paneId;
  // Throttle activity pings — output can arrive in a flood; one ping per ~200ms
  // is plenty to light a tab's dot without a render storm.
  const lastActivityRef = useRef(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const xterm = createXtermTerminal(host, (uri) => {
      void nativeHostService.openExternal(uri);
    });
    const { term } = xterm;
    terminalRef.current = xterm;
    termRegistry.register(paneIdRef.current, term);
    fitXtermTerminal(xterm);

    let disposed = false;
    void terminalService
      .spawn({ cols: term.cols, rows: term.rows })
      .then(({ id, cwd }) => {
        // Unmounted before the id arrived — kill the orphan immediately.
        if (disposed) {
          terminalService.kill(id);
          return;
        }
        idRef.current = id;
        // Seed the tab label with the working-directory name so it's meaningful
        // even before the shell sets an OSC title (which then overrides it).
        const base = cwd?.replace(/\/+$/, '').split('/').pop();
        if (base) onTitleRef.current?.(base);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const message =
          error instanceof Error && error.message ? error.message : 'Unable to start shell.';
        setTerminalError(message);
      });

    // The bundled "BH Mono" face may still be loading on first paint; xterm
    // measures glyph width at open time, so refit once the font is ready to
    // correct the cell metrics (and the pty's cols/rows via onResize).
    void document.fonts?.ready?.then(() => {
      if (!disposed && host.clientWidth > 0 && host.clientHeight > 0) {
        fitXtermTerminal(xterm);
      }
    });

    const offData = terminalService.onData((id, data) => {
      if (id !== idRef.current) return;
      term.write(data);
      const now = performance.now();
      if (now - lastActivityRef.current > 200) {
        lastActivityRef.current = now;
        onActivityRef.current?.();
      }
    });
    const offExit = terminalService.onExit((id, code) => {
      if (id === idRef.current) setExitCode(code);
    });
    const inputSub = term.onData((data) => {
      if (idRef.current) terminalService.write(idRef.current, data);
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (idRef.current) terminalService.resize(idRef.current, cols, rows);
      onDimsRef.current?.(cols, rows);
    });
    // The running program's OSC 0/2 title (e.g. "claude", "zsh", a cwd) — the
    // dock names each tab by its focused pane's title.
    const titleSub = term.onTitleChange((t) => onTitleRef.current?.(t));

    const ro = new ResizeObserver(() => {
      // Skip while hidden (display:none → 0×0): fit on a zero box throws and
      // would wedge the pty at 1×1. The activation effect refits on re-show.
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        fitXtermTerminal(xterm);
      }
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      offData();
      offExit();
      inputSub.dispose();
      resizeSub.dispose();
      titleSub.dispose();
      if (idRef.current) {
        terminalService.kill(idRef.current);
        idRef.current = null;
      }
      term.dispose();
      terminalRef.current = null;
      termRegistry.unregister(paneIdRef.current);
    };
  }, []);

  // Becoming visible — the host was display:none (can't measure), so refit to
  // the now-real size and take focus. Also runs once on mount (initial active).
  useEffect(() => {
    if (!active) return;
    const xterm = terminalRef.current;
    const host = hostRef.current;
    if (!xterm || !host) return;
    const raf = requestAnimationFrame(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        fitXtermTerminal(xterm);
      }
      xterm.term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}>
      <div ref={hostRef} style={terminalHostStyle()} />
      {(exitCode !== null || terminalError) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space[3],
            background: 'rgba(24,24,24,0.82)',
            backdropFilter: 'blur(1px)',
          }}
        >
          <div
            style={{
              fontFamily: font.sans,
              fontSize: font.size.caption,
              color: color.textSecondary,
            }}
          >
            {terminalError ??
              (exitCode === 0 ? 'Shell exited.' : `Shell exited (code ${exitCode}).`)}
          </div>
          <button
            type="button"
            onClick={onRestart}
            style={{
              fontFamily: font.sans,
              fontSize: font.size.ui,
              color: color.textPrimary,
              background: color.accent,
              border: 'none',
              borderRadius: 6,
              padding: `${space[1]}px ${space[3]}px`,
              cursor: 'pointer',
            }}
          >
            Restart
          </button>
        </div>
      )}
    </div>
  );
};
