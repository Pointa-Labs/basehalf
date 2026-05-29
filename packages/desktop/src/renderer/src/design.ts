/**
 * BaseHalf design tokens — single source of truth for the renderer.
 *
 * Centralizing these here so the UI feels like one product instead of
 * eleven components each picking their own greys. Inspired by the
 * restraint of Linear / Things / Arc: one accent, generous whitespace,
 * subtle motion. Numbers, not arbitrary px sprinkled inline.
 */

export const color = {
  // Surfaces — top to bottom: app shell, panels, raised elements.
  bg: '#f8f8f7',
  surface: '#ffffff',
  surfaceMuted: '#fbfbfa',

  // Text — high-contrast headings down to ghost captions.
  textPrimary: '#1a1a1a',
  textSecondary: '#5a5a5a',
  textTertiary: '#8a8a8a',
  textGhost: '#b0b0b0',

  // Borders / dividers — almost invisible by default.
  border: '#ececea',
  borderStrong: '#dcdcd8',
  divider: '#f0f0ee',

  // The one accent. Used sparingly: selected file, active connection,
  // primary CTA in modals. Picked a slightly desaturated blue that
  // reads "considered" rather than "default React blue".
  accent: '#2864c8',
  accentSoft: '#e8effa',
  accentSofter: '#f3f7fd',
  accentHover: '#1f54ad',

  // Semantic — used for state, not chrome.
  warning: '#a86b00',
  warningSoft: '#fff8e3',
  danger: '#a83232',
  dangerSoft: '#fdf0ee',
  success: '#3a7050',
  successSoft: '#eef5ef',

  // Folder badge — warm tone distinguishes the kind on the canvas.
  folder: '#faf3d8',
  folderBorder: '#e8d77a',
  // Folder glyph — the deepest amber in the family, for the icon on the tint.
  folderGlyph: '#9a7d12',

  // Modal backdrop. Slightly darker than v0 to give the dialog real
  // separation from the chrome behind it (it was washing out at 0.32).
  backdrop: 'rgba(15, 17, 20, 0.45)',
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
  // Subtle elevation — borders do most of the work; shadows are punctuation.
  card: '0 1px 2px rgba(0, 0, 0, 0.04)',
  raised: '0 4px 12px rgba(0, 0, 0, 0.08)',
  floating: '0 8px 24px rgba(0, 0, 0, 0.12)',
  // Focus ring used for the one accent.
  focus: '0 0 0 3px rgba(40, 100, 200, 0.18)',
  // Selected node on canvas.
  selectedNode: '0 0 0 2px rgba(40, 100, 200, 0.35), 0 2px 6px rgba(0, 0, 0, 0.05)',
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
