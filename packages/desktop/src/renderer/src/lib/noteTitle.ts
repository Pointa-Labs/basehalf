/**
 * Pure helpers mapping between a note's on-disk filename and the title the user
 * types. The title IS the filename (minus the `.md` extension) —
 * nothing is written into the note body. Framework-free so it's trivially
 * testable and shared by the title input (display) and the rename action
 * (filename derivation).
 */

/** The editable title for a file: its basename without the trailing `.md`. */
export function noteTitleOf(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return base.replace(/\.md$/i, '');
}

// Path separators and the characters a filename can't portably hold, plus the
// C0 control bytes. Stripped from a typed title; everything else — spaces,
// hyphens, CJK — is kept verbatim, per the Chinese-first workflow. The control
// range is built at runtime so no literal control byte ever lives in source.
const ILLEGAL = new RegExp(
  `[/\\\\:*?"<>|${String.fromCharCode(0)}-${String.fromCharCode(31)}]`,
  'g',
);

/**
 * Derive a filename STEM (no extension) from a typed title, or `null` when the
 * title is blank — the caller then keeps the current name rather than renaming
 * to nothing. Illegal characters are stripped, surrounding whitespace trimmed,
 * trailing dots/spaces removed (illegal on some filesystems), and the length
 * capped so a pathological paste can't blow past filesystem limits.
 */
export function noteStemFromTitle(title: string): string | null {
  const cleaned = title
    .replace(ILLEGAL, '')
    .trim()
    .replace(/[ .]+$/, '');
  if (cleaned === '') return null;
  return cleaned.slice(0, 120);
}
