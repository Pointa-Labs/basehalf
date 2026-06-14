import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { type JSX, useEffect, useRef, useState } from 'react';
import { color, font, space } from '../design.js';

// The terminal's default palette — a dark, editor-style scheme reproduced in
// xterm: a foreground-colored block cursor and a translucent selection.
// Deliberately its own surface, distinct from the app chrome, so the terminal
// reads as a focused zone.
export const TERMINAL_BG = '#282c34';
// A half-step darker than TERMINAL_BG, same family — used for the dock's tab
// strip so the active terminal (at TERMINAL_BG) reads as raised.
export const TERMINAL_CHROME_BG = '#21252b';
const THEME = {
  background: TERMINAL_BG,
  foreground: '#ffffff',
  // Cursor defaults to the cell foreground → a bright block; the glyph under it
  // shows in the background color (cursorAccent).
  cursor: '#ffffff',
  cursorAccent: TERMINAL_BG,
  // A translucent light selection reads clearly without forcing a foreground
  // swap.
  selectionBackground: 'rgba(255,255,255,0.22)',
  black: '#1d1f21',
  red: '#cc6666',
  green: '#b5bd68',
  yellow: '#f0c674',
  blue: '#81a2be',
  magenta: '#b294bb',
  cyan: '#8abeb7',
  white: '#c5c8c6',
  brightBlack: '#666666',
  brightRed: '#d54e53',
  brightGreen: '#b9ca4a',
  brightYellow: '#e7c547',
  brightBlue: '#7aa6da',
  brightMagenta: '#c397d8',
  brightCyan: '#70c0b1',
  brightWhite: '#eaeaea',
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
  onTitle,
  onDims,
  onActivity,
}: {
  active: boolean;
  onRestart: () => void;
  onTitle?: (title: string) => void;
  onDims?: (cols: number, rows: number) => void;
  onActivity?: () => void;
}): JSX.Element => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  // Held in refs so the mount-once effect always calls the latest callback
  // without re-running (which would respawn the pty).
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const onDimsRef = useRef(onDims);
  onDimsRef.current = onDims;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  // Throttle activity pings — output can arrive in a flood; one ping per ~200ms
  // is plenty to light a tab's dot without a render storm.
  const lastActivityRef = useRef(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XTerm({
      // Bundled "BH Mono" first (the terminal's signature face, shipped so it
      // renders identically everywhere), then the app's system-mono fallbacks.
      fontFamily: `"BH Mono", ${font.mono}`,
      fontSize: 13,
      // Roomier leading reads calmer (closer to a native terminal's default).
      lineHeight: 1.25,
      fontWeight: 400,
      fontWeightBold: 600,
      theme: THEME,
      // A solid block cursor that blinks when focused and hollows out when not —
      // the same legibility cue native terminals use so you can tell at a glance
      // which pane has keyboard focus.
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline',
      // Momentum scroll instead of instant jumps — feels less jarring on a wheel.
      smoothScrollDuration: 90,
      // Powerline / wide glyphs that overflow their cell get scaled to fit,
      // so prompts and TUI borders line up instead of clipping.
      rescaleOverlappingGlyphs: true,
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
    void window.bh.terminal
      .spawn({ cols: term.cols, rows: term.rows })
      .then((res: { id: string; cwd: string } | string) => {
        // Tolerate an older main that still returns a bare id string — e.g. during
        // a dev reload where the renderer updated but the main process hasn't
        // restarted to the new {id, cwd} contract yet. Without this, destructuring
        // a string yields id=undefined and every pty read/write is silently
        // dropped (a blinking cursor with no shell).
        const id = typeof res === 'string' ? res : res.id;
        const cwd = typeof res === 'string' ? undefined : res.cwd;
        // Unmounted before the id arrived — kill the orphan immediately.
        if (disposed) {
          window.bh.terminal.kill(id);
          return;
        }
        idRef.current = id;
        // Seed the tab label with the working-directory name so it's meaningful
        // even before the shell sets an OSC title (which then overrides it).
        const base = cwd?.replace(/\/+$/, '').split('/').pop();
        if (base) onTitleRef.current?.(base);
      });

    // The bundled "BH Mono" face may still be loading on first paint; xterm
    // measures glyph width at open time, so refit once the font is ready to
    // correct the cell metrics (and the pty's cols/rows via onResize).
    void document.fonts?.ready?.then(() => {
      if (!disposed && host.clientWidth > 0 && host.clientHeight > 0) {
        try {
          fit.fit();
        } catch {
          // transient layout — ignore
        }
      }
    });

    const offData = window.bh.terminal.onData((id, data) => {
      if (id !== idRef.current) return;
      term.write(data);
      const now = performance.now();
      if (now - lastActivityRef.current > 200) {
        lastActivityRef.current = now;
        onActivityRef.current?.();
      }
    });
    const offExit = window.bh.terminal.onExit((id, code) => {
      if (id === idRef.current) setExitCode(code);
    });
    const inputSub = term.onData((data) => {
      if (idRef.current) window.bh.terminal.write(idRef.current, data);
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (idRef.current) window.bh.terminal.resize(idRef.current, cols, rows);
      onDimsRef.current?.(cols, rows);
    });
    // The running program's OSC 0/2 title (e.g. "claude", "zsh", a cwd) — the
    // dock names each tab by its focused pane's title.
    const titleSub = term.onTitleChange((t) => onTitleRef.current?.(t));

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
      titleSub.dispose();
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
          // Roomy, even gutter on all sides (native terminals breathe; glyphs
          // kissing the chrome reads cheap).
          padding: `${space[2]}px ${space[3]}px`,
          // Match the xterm theme bg so the gutter is seamless with the canvas.
          background: TERMINAL_BG,
          // Crisper glyph edges on the GPU/DOM renderer.
          WebkitFontSmoothing: 'antialiased',
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
