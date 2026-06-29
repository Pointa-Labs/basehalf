import { assertWorkspaceRelativePath } from '../../../../platform/workspace/node/workspacePath.js';

export function assertWorkspaceRelative(rel: string): void {
  const normalized = typeof rel === 'string' ? rel.replace(/\\/g, '/').replace(/\/+$/, '') : rel;
  if (normalized === '' || normalized === '.') {
    throw new Error('Path must name an entry inside the workspace.');
  }
  assertWorkspaceRelativePath(rel);
}
