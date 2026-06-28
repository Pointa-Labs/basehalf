import { type ViewerMode, modeOf } from './viewerMode.js';

export interface FilePreviewInput {
  readonly file: string;
  readonly mode: ViewerMode;
  readonly absPath: string;
  readonly basename: string;
  readonly viewKey: string;
}

export function splitPath(rel: string): { readonly dirname: string; readonly basename: string } {
  const index = rel.lastIndexOf('/');
  return index === -1
    ? { dirname: '', basename: rel }
    : { dirname: rel.slice(0, index), basename: rel.slice(index + 1) };
}

export function filePreviewInput(workspacePath: string, file: string): FilePreviewInput {
  return {
    file,
    mode: modeOf(file),
    absPath: `${workspacePath}/${file}`,
    basename: splitPath(file).basename,
    viewKey: editorViewKeyFor(workspacePath, file),
  };
}

export function editorViewKeyFor(workspaceRoot: string | null, file: string): string {
  return `${workspaceRoot ?? ''}${String.fromCharCode(0)}${file}`;
}
