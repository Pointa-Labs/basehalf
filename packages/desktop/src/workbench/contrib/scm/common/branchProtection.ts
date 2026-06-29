export interface BranchProtection {
  readonly remote: string;
  readonly rules: readonly BranchProtectionRule[];
}

export interface BranchProtectionRule {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export interface BranchProtectionBranch {
  readonly name?: string;
  readonly upstream?: {
    readonly remote?: string;
  };
}

export type BranchProtectionPatternMatcher = (branchName: string) => boolean;

export interface BranchProtectionMatcher {
  readonly include?: BranchProtectionPatternMatcher;
  readonly exclude?: BranchProtectionPatternMatcher;
}

export type BranchProtectionModel = ReadonlyMap<string, readonly BranchProtectionMatcher[]>;

export type BranchProtectionChangeListener = (repositoryRoot: string) => void;

export type BranchProtectionChangeEvent = (listener: BranchProtectionChangeListener) => () => void;

export interface BranchProtectionProvider {
  readonly onDidChangeBranchProtection: BranchProtectionChangeEvent;
  provideBranchProtection(): readonly BranchProtection[];
}

export const noopBranchProtectionChangeEvent: BranchProtectionChangeEvent = () => () => {};

export function compileBranchProtectionModel(
  branchProtection: readonly BranchProtection[],
): BranchProtectionModel {
  const model = new Map<string, readonly BranchProtectionMatcher[]>();

  for (const { remote, rules } of branchProtection) {
    const matchers: BranchProtectionMatcher[] = [];

    for (const rule of rules) {
      const include =
        rule.include && rule.include.length !== 0
          ? createBranchPatternMatcher(rule.include)
          : undefined;
      const exclude =
        rule.exclude && rule.exclude.length !== 0
          ? createBranchPatternMatcher(rule.exclude)
          : undefined;

      if (include || exclude) {
        matchers.push({
          ...(include !== undefined && { include }),
          ...(exclude !== undefined && { exclude }),
        });
      }
    }

    if (matchers.length !== 0) {
      model.set(remote, matchers);
    }
  }

  return model;
}

export function isBranchProtected(
  model: BranchProtectionModel,
  branch?: BranchProtectionBranch,
): boolean {
  if (!branch?.name) {
    return false;
  }

  const branchName = branch.name;
  const defaultBranchProtectionMatcher = model.get('');
  if (defaultBranchProtectionMatcher?.length === 1) {
    const defaultMatcher = defaultBranchProtectionMatcher[0];
    if (defaultMatcher?.include?.(branchName) === true) {
      return true;
    }
  }

  if (!branch.upstream?.remote) {
    return false;
  }

  const remoteBranchProtectionMatcher = model.get(branch.upstream.remote);
  if (!remoteBranchProtectionMatcher || remoteBranchProtectionMatcher.length === 0) {
    return false;
  }

  return remoteBranchProtectionMatcher.some((matcher) => {
    const include = matcher.include ? matcher.include(branchName) : true;
    const exclude = matcher.exclude ? matcher.exclude(branchName) : false;

    return include && !exclude;
  });
}

function createBranchPatternMatcher(patterns: readonly string[]): BranchProtectionPatternMatcher {
  const matchers = patterns.map((pattern) => globPatternToRegExp(pattern));

  return (branchName) => matchers.some((matcher) => matcher.test(branchName));
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === undefined) continue;

    if (char === '*') {
      const next = pattern[index + 1];
      if (next === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += escapeRegExpChar(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExpChar(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}
