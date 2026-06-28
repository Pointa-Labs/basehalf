import { color } from '../../../browser/style/design.js';

// The terminal's palette uses the app's own neutral dark surface (not a blue-gray
// editor scheme), so the dock blends with the rest of the theme.
export const TERMINAL_BG = color.bg;

// The app's deepest chrome tone (side-bar / title-bar) for the tab strip, so the
// active terminal (at TERMINAL_BG) reads as raised above it.
export const TERMINAL_CHROME_BG = color.surfaceMuted;

export const TERMINAL_THEME = {
  background: TERMINAL_BG,
  foreground: '#ffffff',
  cursor: '#ffffff',
  cursorAccent: TERMINAL_BG,
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
