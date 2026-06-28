import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { CSSProperties } from 'react';
import { font, space } from '../../../browser/style/design.js';
import { TERMINAL_BG, TERMINAL_THEME } from './terminalTheme.js';

export interface XtermTerminalHandle {
  readonly term: XTerm;
  readonly fit: FitAddon;
}

/**
 * Thin xterm.js wrapper, following VS Code's `xtermTerminal` boundary: it owns
 * terminal construction, addons, theme, and renderer fallback; process wiring
 * stays with the terminal instance view.
 */
export function createXtermTerminal(
  host: HTMLElement,
  openExternal: (uri: string) => void,
): XtermTerminalHandle {
  const term = new XTerm({
    fontFamily: `"BH Mono", ${font.mono}`,
    fontSize: 13,
    lineHeight: 1.25,
    fontWeight: 400,
    fontWeightBold: 600,
    theme: TERMINAL_THEME,
    cursorBlink: true,
    cursorStyle: 'block',
    cursorInactiveStyle: 'outline',
    smoothScrollDuration: 90,
    rescaleOverlappingGlyphs: true,
    allowProposedApi: true,
    scrollback: 10_000,
    macOptionIsMeta: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.loadAddon(new WebLinksAddon((_event, uri) => openExternal(uri)));
  term.open(host);
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    // DOM renderer (xterm default) remains fully functional.
  }
  return { term, fit };
}

export function fitXtermTerminal(handle: XtermTerminalHandle): void {
  try {
    handle.fit.fit();
  } catch {
    // The host may be hidden or not laid out yet; callers refit on activation.
  }
}

export function terminalHostStyle(): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    padding: `${space[2]}px ${space[3]}px`,
    background: TERMINAL_BG,
    WebkitFontSmoothing: 'antialiased',
  };
}
