import { registerBuiltinScmViewContributions } from './scmBuiltinViewContributions.js';

/**
 * SCM workbench contribution bootstrap, mirroring VS Code's
 * `workbench/contrib/scm/browser/scm.contribution.ts` boundary.
 */
export function registerScmWorkbenchContributions(): void {
  registerBuiltinScmViewContributions();
}
