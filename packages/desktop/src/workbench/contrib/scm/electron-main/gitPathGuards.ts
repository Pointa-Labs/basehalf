export function assertWorkspaceRelative(rel: string): void {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new Error('Path must be a non-empty string');
  }
  const normalized = rel.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === '' || normalized === '.') {
    throw new Error('Path must name an entry inside the workspace.');
  }
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(rel)) {
    throw new Error(`Path must be relative, got: ${rel}`);
  }
  if (rel.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`Path traversal rejected: ${rel}`);
  }
}
