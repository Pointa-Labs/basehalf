/**
 * viewerMode — decide which inline viewer a file opens in, from its PATH alone.
 *
 * The routing is a DENY-LIST, not an allow-list. Files we KNOW aren't text
 * (Office/iWork docs, archives, fonts, media we don't render inline) hand off to
 * the OS "open in default app" path; EVERYTHING ELSE — known code/text, unknown
 * extensions, AND extension-less names like `VERSION` / `TODO` / `CODEOWNERS` —
 * optimistically opens in the read-only text viewer. The viewer's capped binary
 * content-sniff (`workspace.readFile` flags a NUL byte / invalid UTF-8) is the
 * safety net: a binary that slips through renders a "binary file — open in the
 * right app" message, never mojibake.
 *
 * Why deny-list and not the old allow-list: a list of "known text extensions"
 * can never be complete — a real repo has `Dockerfile`, `VERSION`, `*.tf`,
 * `*.hcl`, an unknown `*.foo` — so it always grows and always leaves dead-ends
 * ("No built-in viewer"). Sniff-on-read lets us be optimistic about text and
 * still correct about binary, which is the only way to avoid the allowlist trap.
 *
 * This is separate from the file GLYPH (FileGlyph's name/ext maps): the glyph is
 * visual identity, this is viewer routing. They intentionally don't share a map.
 */

export type ViewerMode = 'md' | 'pdf' | 'image' | 'audio' | 'video' | 'text' | 'other';

/**
 * Lowercased, leading-dot extension of a path's basename, or '' when there's no
 * usable extension. Scoped to the basename so a dot in a PARENT directory
 * (`my.app/README`) never gets mistaken for the file's extension. A leading-dot
 * dotfile (`.gitignore`) is treated as extension-less — its name is the signal,
 * and extension-less routes to text + sniff anyway.
 */
export function extOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

const MD_EXT = new Set(['.md', '.markdown', '.txt']);
// Inline media we actually render here (Electron/Chromium-decodable). Formats
// NOT in these sets fall to OPEN_IN_APP so they get a clean "open in default
// app" rather than a broken <img>/<audio>/<video> element.
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm']);

// Known NON-text formats with no inline viewer → hand off to the OS default app.
// This list does NOT need to be exhaustive: anything binary we miss still routes
// to the text viewer and the content-sniff downgrades it to the "binary file"
// message (which itself offers "open in default app"). The list exists so the
// COMMON binaries get the cleaner open-in-app affordance straight away.
const OPEN_IN_APP_EXT = new Set([
  // Images / audio / video we don't decode inline.
  '.bmp',
  '.heic',
  '.heif',
  '.avif',
  '.ico',
  '.tiff',
  '.tif',
  '.flac',
  '.aac',
  '.ogg',
  '.opus',
  '.aiff',
  '.mkv',
  '.avi',
  '.m4v',
  '.wmv',
  '.flv',
  // Office / iWork / OpenDocument.
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.pages',
  '.key',
  '.numbers',
  '.odt',
  '.odp',
  '.ods',
  '.rtf',
  // Archives.
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.jar',
  '.war',
  // Disk images / installers / executables / objects.
  '.dmg',
  '.pkg',
  '.iso',
  '.exe',
  '.msi',
  '.app',
  '.deb',
  '.rpm',
  '.bin',
  '.dat',
  '.so',
  '.dylib',
  '.dll',
  '.o',
  '.a',
  '.class',
  '.wasm',
  '.node',
  '.pyc',
  '.pyo',
  // Databases.
  '.sqlite',
  '.sqlite3',
  '.db',
  // Fonts.
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
]);

export function modeOf(path: string): ViewerMode {
  const e = extOf(path);
  if (MD_EXT.has(e)) return 'md';
  if (e === '.pdf') return 'pdf';
  if (IMAGE_EXT.has(e)) return 'image';
  if (AUDIO_EXT.has(e)) return 'audio';
  if (VIDEO_EXT.has(e)) return 'video';
  // Known non-text formats keep "open in system app".
  if (OPEN_IN_APP_EXT.has(e)) return 'other';
  // Everything else — known code/text, unknown extensions, and extension-less
  // names — is optimistically routed to the read-only text viewer; its binary
  // content-sniff downgrades a true binary to the "binary file" message.
  return 'text';
}
