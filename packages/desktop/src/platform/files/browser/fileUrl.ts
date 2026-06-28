/**
 * Build a `file://` URL from an absolute path, encoding the characters that
 * otherwise break the URL: a space, `#` (starts a fragment), `?` (starts a
 * query), or `%`. `encodeURI` handles spaces and `%` but deliberately leaves
 * `#`/`?` (they're valid URL syntax), so a file literally named `draft #2.png`
 * would silently fail to load. We encode those two explicitly while keeping `/`
 * readable, so media/PDF/image sources render regardless of the filename.
 */
export function fileUrl(absPath: string): string {
  const encoded = encodeURI(absPath).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return `file://${encoded}`;
}
