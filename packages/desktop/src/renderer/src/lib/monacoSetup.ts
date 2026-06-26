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
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

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
