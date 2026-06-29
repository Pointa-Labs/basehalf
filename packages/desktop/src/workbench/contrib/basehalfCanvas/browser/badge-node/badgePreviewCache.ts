import {
  type WorkbenchFileChangeEvent,
  workbenchFileChangeService,
} from '../../../../services/files/browser/fileChangeService.js';

export type PreviewContent = { text: string };

const previewCache = new Map<string, PreviewContent>();
const mdHtmlCache = new Map<string, string>();

/** Drop all cached previews — call on workspace switch. The cache is keyed by
 *  workspace-relative path for within-workspace reuse, so a path that exists in
 *  two workspaces would otherwise serve the wrong one's content after a switch. */
export function clearPreviewCache(): void {
  previewCache.clear();
  mdHtmlCache.clear();
}

export const getPreviewContent = (label: string): PreviewContent | undefined =>
  previewCache.get(label);

export const setPreviewContent = (label: string, content: PreviewContent): void => {
  previewCache.set(label, content);
};

export const getMarkdownPreviewHtml = (label: string): string | undefined => mdHtmlCache.get(label);

export const setMarkdownPreviewHtml = (label: string, html: string): void => {
  mdHtmlCache.set(label, html);
};

export function invalidatePreviewCache(label: string): void {
  previewCache.delete(label);
  mdHtmlCache.delete(label);
}

function invalidatePreviewCacheForEvent(event: WorkbenchFileChangeEvent): void {
  if (event.type === 'change' || event.type === 'unlink') {
    invalidatePreviewCache(event.relPath);
    return;
  }
  if (event.type === 'rename') {
    invalidatePreviewCache(event.fromRelPath);
    invalidatePreviewCache(event.toRelPath);
  }
}

// One shared file-event subscription fans out to all mounted tiles, instead of
// each tile registering its own ipcRenderer listener (which trips Node's
// MaxListeners warning past ~10 text badges and fans out O(N) per event).
const tileListeners = new Set<(e: WorkbenchFileChangeEvent) => void>();
let tileHubUnsub: (() => void) | null = null;

export function subscribeTile(listener: (e: WorkbenchFileChangeEvent) => void): () => void {
  if (!tileHubUnsub) {
    tileHubUnsub = workbenchFileChangeService.onDidChangeFiles((event) => {
      invalidatePreviewCacheForEvent(event);
      for (const l of tileListeners) l(event);
    });
  }
  tileListeners.add(listener);
  return () => {
    tileListeners.delete(listener);
  };
}
