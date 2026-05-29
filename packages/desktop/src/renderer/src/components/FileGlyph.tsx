/**
 * FileGlyph — file-type identity by SHAPE, shared by the canvas badges and
 * the sidebar file tree so both speak one visual language.
 *
 * Monochrome line glyphs (not a rainbow of fills) keep the surfaces inside
 * the design system's "one accent" restraint; the parent picks the tone.
 * Distinct at small sizes: prose lines for text, a photo frame for images,
 * a waveform for audio, a play triangle for video, a folded page for
 * documents, chevrons for code, a folder for directories.
 */

import type { JSX } from 'react';

export type BadgeType =
  | 'folder'
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'code'
  | 'generic';

const EXT_TYPE: Record<string, BadgeType> = {
  md: 'text',
  markdown: 'text',
  mdx: 'text',
  txt: 'text',
  rst: 'text',
  org: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  heic: 'image',
  avif: 'image',
  ico: 'image',
  tiff: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  flac: 'audio',
  aac: 'audio',
  ogg: 'audio',
  opus: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  m4v: 'video',
  pdf: 'pdf',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  java: 'code',
  rb: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  cs: 'code',
  php: 'code',
  swift: 'code',
  kt: 'code',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  css: 'code',
  scss: 'code',
  html: 'code',
  xml: 'code',
  sh: 'code',
  sql: 'code',
  // Dotfiles whose "extension" (the part after the leading dot) names a known
  // text/config format — `.gitignore` → `gitignore`, etc.
  gitignore: 'text',
  dockerignore: 'text',
  gitattributes: 'text',
  editorconfig: 'text',
  npmrc: 'text',
  nvmrc: 'text',
  gitkeep: 'text',
  // Shells / config / structured formats — so common config & script files get
  // a real glyph AND open in the read-only text viewer instead of a dead-end
  // "no viewer". (Curated to definitely-text extensions; unknown ones stay
  // 'generic' to avoid rendering a binary as garbage.)
  bash: 'code',
  zsh: 'code',
  fish: 'code',
  ps1: 'code',
  bat: 'code',
  ini: 'code',
  conf: 'code',
  cfg: 'code',
  env: 'code',
  properties: 'code',
  lock: 'code',
  lua: 'code',
  pl: 'code',
  r: 'code',
  gradle: 'code',
  vue: 'code',
  svelte: 'code',
  astro: 'code',
  graphql: 'code',
  gql: 'code',
  proto: 'code',
  // Plain-text / tabular / logs.
  csv: 'text',
  tsv: 'text',
  log: 'text',
  text: 'text',
};

// Extension-less files whose NAME is itself the type signal. These are
// ubiquitous in a code repo (the AI-coding wedge) and are definitely text, so
// they get a glyph + open in the read-only viewer instead of "no viewer".
// (Arbitrary extension-less files still need content-sniffing — a v0.x item.)
const NAME_TYPE: Record<string, BadgeType> = {
  dockerfile: 'code',
  makefile: 'code',
  gemfile: 'code',
  rakefile: 'code',
  procfile: 'code',
  jenkinsfile: 'code',
  vagrantfile: 'code',
  license: 'text',
  readme: 'text',
  changelog: 'text',
  authors: 'text',
  notice: 'text',
  copying: 'text',
};

export const badgeType = (label: string, isFolder: boolean): BadgeType => {
  if (isFolder) return 'folder';
  const dot = label.lastIndexOf('.');
  if (dot === -1 || dot === label.length - 1) {
    // No usable extension — fall back to a known-name match (Dockerfile, …).
    return NAME_TYPE[label.toLowerCase()] ?? 'generic';
  }
  return EXT_TYPE[label.slice(dot + 1).toLowerCase()] ?? 'generic';
};

// Each glyph is a 16-unit-viewBox line drawing; strokes use currentColor so
// the parent controls tone via the `color` style.
const GLYPH_PATHS: Record<BadgeType, JSX.Element> = {
  text: <path d="M3.5 4h9M3.5 7h9M3.5 10h9M3.5 13h5.5" />,
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
      <circle cx="5.8" cy="6.3" r="1.1" />
      <path d="M3 12l3-3 2.3 2.3L11 8l2.2 2.2" />
    </>
  ),
  audio: <path d="M4 7v2M6.5 4.8v6.4M9 3.2v9.6M11.5 5.6v4.8" />,
  video: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.6" />
      <path d="M6.8 6.3l3 1.7-3 1.7z" fill="currentColor" stroke="none" />
    </>
  ),
  pdf: (
    <>
      <path d="M4 2.5h4.5l3 3V13H4z" />
      <path d="M8.5 2.5v3h3" />
      <path d="M5.8 9h4M5.8 11h4" />
    </>
  ),
  code: <path d="M6 5L3 8l3 3M10 5l3 3-3 3" />,
  generic: (
    <>
      <path d="M4 2.5h4.5l3 3V13H4z" />
      <path d="M8.5 2.5v3h3" />
    </>
  ),
  folder: (
    <path d="M2.5 4.7a1 1 0 0 1 1-1h2.7a1 1 0 0 1 .72.3l.86.9a1 1 0 0 0 .72.3h4a1 1 0 0 1 1 1v5.3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  ),
};

export const FileGlyph = ({
  type,
  tone,
  size = 15,
}: {
  type: BadgeType;
  tone: string;
  size?: number;
}): JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.25}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ color: tone, flexShrink: 0, display: 'block' }}
    aria-hidden
  >
    {GLYPH_PATHS[type]}
  </svg>
);
