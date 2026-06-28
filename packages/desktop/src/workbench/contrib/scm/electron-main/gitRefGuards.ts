// A ref interpolated into a git arg (treeish, `<ref>:./path`, `<ref>^`) must be a
// safe git revision: a constrained charset and never a leading '-' (git would read
// it as a flag). `^`/`~`/`@`/`/` are valid in real refs (HEAD^, main~1, @{u}).
const SAFE_REF = /^[\w./~^@][\w./~^@-]*$/;

export function assertSafeRef(ref: string, label: string): void {
  if (!SAFE_REF.test(ref)) throw new Error(`${label}: unsafe ref ${JSON.stringify(ref)}`);
}

export function assertSafeRemote(remote: string): void {
  if (!/^[\w][\w.-]*$/.test(remote)) {
    throw new Error(`git remote: invalid remote ${JSON.stringify(remote)}`);
  }
}

/**
 * Validate a NEW branch name before interpolating it into a git arg. Blocks the
 * dangerous shapes (leading '-' -> flag injection; whitespace/control chars; the
 * `~^:?*[\` git refname metacharacters; `..`). git's own `check-ref-format` is the
 * final authority - this is the injection guard, not a full refname validator.
 */
export function assertBranchName(name: string, label: string): void {
  if (
    name === '' ||
    name.startsWith('-') ||
    name.includes('..') ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: blocking control chars is the point.
    /[\s~^:?*[\\\x00-\x1f]/.test(name)
  ) {
    throw new Error(`${label}: invalid branch name ${JSON.stringify(name)}`);
  }
}

/** A non-negative integer arg destined for a `--flag=<n>` (template-injection guard). */
export function assertCount(n: number | undefined, label: string): void {
  if (n !== undefined && (!Number.isInteger(n) || n < 0)) {
    throw new Error(`${label}: expected a non-negative integer, got ${JSON.stringify(n)}`);
  }
}
