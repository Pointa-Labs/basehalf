// Wire Monaco's web workers for the Vite / electron-vite renderer.
//
// Monaco offloads tokenization and the TS / JSON / CSS / HTML language services
// to web workers; without a `MonacoEnvironment.getWorker` it throws
// "You must define a function MonacoEnvironment.getWorker" the moment an editor
// is created. Vite's `?worker` import compiles each worker entry to its own
// chunk and hands back a ready Worker constructor — and crucially emits them
// with relative URLs, so they load under Electron's `file://` in the packaged
// build (electron-vite sets the renderer base to `./`).
//
// Imported once, for its side effect, by CodeEditor BEFORE the first editor /
// model is created. Kept out of CodeEditor's body so the assignment runs at
// module-eval time, not on render.
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { color } from '../design.js';

type WorkerEnv = { getWorker(workerId: string, label: string): Worker };

(globalThis as typeof globalThis & { MonacoEnvironment?: WorkerEnv }).MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

let themeDefined = false;
/** Define (once) the 'bh-dark' Monaco theme — vs-dark with the app surface as
 *  the background — so an embedded editor / diff blends into the chrome instead
 *  of sitting on its own shade. Shared by the code editor and the git diff view. */
export function ensureBhTheme(): void {
  if (themeDefined) return;
  monaco.editor.defineTheme('bh-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': color.surface,
      'editorGutter.background': color.surface,
      'editorLineNumber.foreground': color.textGhost,
      'editor.lineHighlightBorder': '#00000000',
    },
  });
  themeDefined = true;
}

let gutterStylesInjected = false;
/** Inject (once) the CSS for the editor's git change-bars — a colored vertical
 *  bar in Monaco's lines-decorations lane: added green, modified accent-blue,
 *  deleted red. Driven by the `bh-git-gutter-*` decoration classes. */
export function ensureGitGutterStyles(): void {
  if (gutterStylesInjected) return;
  const style = document.createElement('style');
  style.textContent = `
.bh-git-gutter-add { border-left: 3px solid ${color.success}; box-sizing: border-box; }
.bh-git-gutter-modify { border-left: 3px solid ${color.accent}; box-sizing: border-box; }
.bh-git-gutter-delete { border-left: 3px solid ${color.danger}; box-sizing: border-box; }
`;
  document.head.appendChild(style);
  gutterStylesInjected = true;
}

/** Monaco language id for a path, from Monaco's own extension / filename registry
 *  (so `Dockerfile`, `.ts`, `.tf`… resolve the way VS Code resolves them).
 *  Unknown → 'plaintext'. */
export function languageOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = (slash === -1 ? path : path.slice(slash + 1)).toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.filenames?.some((f) => f.toLowerCase() === name)) return lang.id;
    if (ext && lang.extensions?.some((e) => e.toLowerCase() === ext)) return lang.id;
  }
  return 'plaintext';
}
