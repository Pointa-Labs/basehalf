import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { type JSX, useEffect, useRef, useState } from 'react';
import { color, font, space } from '../design.js';

// xterm palette mapped onto the app's Dark Modern tokens so the terminal reads
// as part of the product, not a foreign box. ANSI 16 ≈ the editor's terminal
// theme (close enough that TUI agents look at home).
const THEME = {
  background: color.surfaceMuted,
  foreground: color.textPrimary,
  cursor: color.accent,
  cursorAccent: color.surfaceMuted,
  selectionBackground: color.accentSoft,
  black: '#1e1e1e',
  red: '#f14c4c',
  green: '#4ec9b0',
  yellow: '#cca700',
  blue: '#3794ff',
  magenta: '#c586c0',
  cyan: '#29b8db',
  white: '#cccccc',
  brightBlack: '#808080',
  brightRed: '#f14c4c',
  brightGreen: '#73c991',
  brightYellow: '#e2c08d',
  brightBlue: '#3794ff',
  brightMagenta: '#d7a3e0',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
} as const;

/**
 * One embedded terminal session. Owns its own pty (created on mount, killed on
 * unmount) and renders it through xterm.js. The pty itself lives in main — this
 * is a thin view wired over window.bh.terminal.*.
 *
 * Lifecycle is keyed by the parent: re-rooting to a new workspace and "Restart"
 * are both done by changing this component's React key (the idiomatic reset), so
 * the spawn effect stays a clean mount-once. `active` drives focus + a refit when
 * this view becomes visible (an inactive tab is display:none, where xterm can't
 * measure itself). `onRestart` asks the parent to remount us after the shell exits.
 */
export const TerminalView = ({
  active,
  onRestart,
}: { active: boolean; onRestart: () => void }): JSX.Element => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XTerm({
      fontFamily: font.mono,
      fontSize: 13,
      lineHeight: 1.2,
      theme: THEME,
      cursorBlink: true,
      // unicode11 + webgl are "proposed" APIs in xterm v6 — opt in explicitly.
      allowProposedApi: true,
      scrollback: 10_000,
      // ⌥ as Meta so word-wise shortcuts (⌥←/→, ⌥-backspace) reach the shell.
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Correct wide-char / CJK / emoji cell widths so TUI box-drawing stays
    // aligned and backspace doesn't over-delete (the user works in Chinese).
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    // Clickable links open in the system browser (never navigate the renderer).
    term.loadAddon(
      new WebLinksAddon((_e, uri) => {
        void window.bh.openExternal(uri);
      }),
    );
    term.open(host);
    // GPU renderer for smooth full-screen TUI redraws; degrade to the DOM
    // renderer if WebGL2 is unavailable or the context is lost.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // DOM renderer (xterm default) — still fully functional.
    }
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      // host not laid out yet; the ResizeObserver below fits once it is.
    }

    let disposed = false;
    void window.bh.terminal.spawn({ cols: term.cols, rows: term.rows }).then((id) => {
      // Unmounted before the id arrived — kill the orphan immediately.
      if (disposed) {
        window.bh.terminal.kill(id);
        return;
      }
      idRef.current = id;
    });

    const offData = window.bh.terminal.onData((id, data) => {
      if (id === idRef.current) term.write(data);
    });
    const offExit = window.bh.terminal.onExit((id, code) => {
      if (id === idRef.current) setExitCode(code);
    });
    const inputSub = term.onData((data) => {
      if (idRef.current) window.bh.terminal.write(idRef.current, data);
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (idRef.current) window.bh.terminal.resize(idRef.current, cols, rows);
    });

    const ro = new ResizeObserver(() => {
      // Skip while hidden (display:none → 0×0): fit on a zero box throws and
      // would wedge the pty at 1×1. The activation effect refits on re-show.
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        try {
          fit.fit();
        } catch {
          // transient layout — ignore
        }
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
      if (idRef.current) {
        window.bh.terminal.kill(idRef.current);
        idRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Becoming visible — the host was display:none (can't measure), so refit to
  // the now-real size and take focus. Also runs once on mount (initial active).
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!term || !fit || !host) return;
    const raf = requestAnimationFrame(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        try {
          fit.fit();
        } catch {
          // ignore
        }
      }
      term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}>
      <div
        ref={hostRef}
        style={{
          position: 'absolute',
          inset: 0,
          // xterm paints its own background; pad so glyphs don't kiss the edge.
          padding: `${space[1]}px ${space[2]}px`,
          background: color.surfaceMuted,
        }}
      />
      {exitCode !== null && (
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
            {exitCode === 0 ? 'Shell exited.' : `Shell exited (code ${exitCode}).`}
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
