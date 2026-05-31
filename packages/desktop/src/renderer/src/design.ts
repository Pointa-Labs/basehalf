/**
 * BaseHalf design tokens — single source of truth for the renderer.
 *
 * Centralizing these here so the UI feels like one product instead of
 * eleven components each picking their own greys. Aiming for the restraint
 * of well-made desktop tools: one accent, generous whitespace, subtle
 * motion. Numbers, not arbitrary px sprinkled inline.
 */

export const color = {
  // Dark palette modelled on the editor's "Dark Modern" theme. Chrome (side
  // bar / title bar) is the deepest tone; the canvas/editor base is one step
  // up; raised panels (dialogs, badges, the editor card) one more.
  bg: '#1e1e1e', // canvas / app base (≈ editor.background)
  surface: '#252526', // raised: dialogs, badges, editor card
  surfaceMuted: '#181818', // deepest chrome: side bar + title bar

  // Text — bright primary down to ghost captions (≈ foreground / description).
  textPrimary: '#cccccc',
  textSecondary: '#9d9d9d',
  textTertiary: '#808080',
  textGhost: '#6e6e6e',

  // Borders / dividers — quiet seams on a dark ground.
  border: '#2b2b2b',
  borderStrong: '#454545',
  // Doubles as the list-row HOVER tone (a hair above the chrome).
  divider: '#2a2d2e',

  // The one accent. Used sparingly: selected file, active connection, primary
  // CTA. The editor's signature blue; selection tints are its list colors.
  accent: '#0078d4',
  accentSoft: '#04395e', // active-selection background
  accentSofter: '#37373d', // inactive-selection background
  accentHover: '#1177bb',

  // Semantic — used for state, not chrome (dark-theme variants).
  warning: '#cca700',
  warningSoft: '#3a2f00',
  danger: '#f14c4c',
  dangerSoft: '#5a1d1d',
  success: '#4ec9b0',
  successSoft: '#16352c',

  // Folder badge — warm amber tint distinguishes the kind on the dark canvas.
  folder: '#332b00',
  folderBorder: '#5c4f1f',
  folderGlyph: '#d6b656',

  // Modal backdrop — deep dim so the dialog separates from the dark chrome.
  backdrop: 'rgba(0, 0, 0, 0.6)',
} as const;

export const space = {
  px: 1,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  pill: 999,
} as const;

export const font = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
  mono: '"SF Mono", "JetBrains Mono", Menlo, Consolas, ui-monospace, monospace',
  // Display = larger headings (welcome card, modal titles).
  // Body = paragraphs.
  // UI = compact labels / buttons.
  // Caption = subtitles / hint text.
  // Micro = uppercase chips and tags.
  size: {
    display: 18,
    body: 14,
    ui: 13,
    caption: 12,
    micro: 11,
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  // Tracked letterspacing for ALL-CAPS labels — system-ui at 11px needs
  // ~0.06em to not look mashed-together.
  trackedCaps: 0.5,
} as const;

export const shadow = {
  // Elevation on a dark ground — deeper than a light theme so cards still read.
  card: '0 1px 2px rgba(0, 0, 0, 0.4)',
  raised: '0 4px 12px rgba(0, 0, 0, 0.5)',
  floating: '0 10px 28px rgba(0, 0, 0, 0.6)',
  // Focus ring — a 1px accent border, the editor's focus style.
  focus: '0 0 0 1px #0078d4',
  // Selected node on canvas.
  selectedNode: '0 0 0 2px rgba(0, 120, 212, 0.6), 0 2px 8px rgba(0, 0, 0, 0.5)',
} as const;

export const motion = {
  // 150ms = micro-interactions (button hover); 220ms = panel transitions.
  fast: '150ms cubic-bezier(0.16, 1, 0.3, 1)',
  normal: '220ms cubic-bezier(0.16, 1, 0.3, 1)',
  slow: '320ms cubic-bezier(0.16, 1, 0.3, 1)',
  // The easing above is the iOS-feeling out-quart; instant feedback,
  // gentle settle.
} as const;

// Convenience: build a transition string for the listed properties.
export const transition = (
  properties: readonly string[],
  speed: keyof typeof motion = 'fast',
): string => properties.map((p) => `${p} ${motion[speed]}`).join(', ');
