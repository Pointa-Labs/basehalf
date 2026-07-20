const WINDOWS_RESERVED_BASENAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export interface PortablePathOptions {
  readonly maximumLength: number;
  readonly requireExtension?: string;
  readonly reserveBaseHalfState?: boolean;
}

/** Validates paths that must resolve identically on every supported desktop platform. */
export function portableRelativePath(
  value: unknown,
  field: string,
  options: PortablePathOptions,
): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > options.maximumLength ||
    value !== value.trim() ||
    value !== value.normalize('NFC') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    containsForbiddenPathCharacter(value) ||
    /^[A-Za-z]:/.test(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
  ) {
    throw new Error(`${field} must be a canonical portable relative path.`);
  }

  const segments = value.split('/');
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.length > 255 ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        WINDOWS_RESERVED_BASENAMES.test(segment) ||
        (options.reserveBaseHalfState !== false && segment.toLowerCase() === '.bh'),
    )
  ) {
    throw new Error(`${field} contains a reserved or unsafe path segment.`);
  }
  if (
    options.requireExtension !== undefined &&
    !value.toLowerCase().endsWith(options.requireExtension.toLowerCase())
  ) {
    throw new Error(`${field} must end with ${options.requireExtension}.`);
  }
  return value;
}

export function portablePathKey(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function containsForbiddenPathCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || '<>:"|?*'.includes(character)
    );
  });
}
