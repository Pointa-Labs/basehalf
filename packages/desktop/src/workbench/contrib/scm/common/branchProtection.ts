export interface BranchProtection {
  readonly remote: string;
  readonly rules: readonly BranchProtectionRule[];
}

export interface BranchProtectionRule {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export type BranchProtectionChangeListener = (repositoryRoot: string) => void;

export type BranchProtectionChangeEvent = (listener: BranchProtectionChangeListener) => () => void;

export interface BranchProtectionProvider {
  readonly onDidChangeBranchProtection: BranchProtectionChangeEvent;
  provideBranchProtection(): readonly BranchProtection[];
}

export const noopBranchProtectionChangeEvent: BranchProtectionChangeEvent = () => () => {};
