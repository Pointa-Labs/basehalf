/**
 * Shared OS drag-drop routing — one behavior wherever a drop lands (canvas,
 * sidebar, editor area).
 *
 * The product rule (see workspace.importFile): a drop is always a
 * COPY into the open workspace's folder — the source file is never moved or
 * touched, and the copy is a real file the file manager / git / agents all
 * see. Folders keep their existing meaning: add/open as a workspace.
 *
 * Routing:
 *   - folder        → addDroppedPaths (register + open as workspace)
 *   - file, workspace open  → workspace.importFile (copy in; never clobbers)
 *   - file, no workspace    → explain (there is nowhere to copy it to)
 */

import { nativeHostService } from '../../../platform/native/browser/nativeHostService.js';
import { workspaceService } from '../../../platform/workspaces/browser/workspaceService.js';
import {
  DEFAULT_FILE_CARD_HEIGHT,
  DEFAULT_FILE_CARD_WIDTH,
} from '../../contrib/basehalfCanvas/browser/badge-node/badgeNodeModel.js';
import { emitBadgeChange } from '../../services/mirror/browser/badgeBus.js';
import { canvasMirrorService } from '../../services/mirror/browser/canvasMirrorService.js';
import { useWorkspaceStore } from '../../services/workspace/browser/workspaceStore.js';

export interface DroppedPathEntry {
  readonly path: string;
  readonly kind: 'file' | 'dir' | null;
}

interface ImportFileResult {
  path: string;
  name: string;
  imported: boolean;
  supported: boolean;
}

/** Absolute paths from an OS drag payload. Modern runtimes removed the old
 *  non-standard `File.path`, so the preload bridges the sanctioned
 *  path-for-file API; the legacy property remains as a fallback (it also
 *  lets tests synthesize drops). Path-less Files (e.g. browser-constructed)
 *  are skipped. Kind classification stays inside this real drag payload
 *  boundary; the renderer service does not expose an arbitrary path stat API. */
export async function droppedPaths(dataTransfer: DataTransfer): Promise<DroppedPathEntry[]> {
  const entries: DroppedPathEntry[] = [];
  for (const file of Array.from(dataTransfer.files)) {
    let p = '';
    let kind: DroppedPathEntry['kind'] = null;
    try {
      p = nativeHostService.pathForFile(file);
      kind = await nativeHostService.pathKindForFile(file);
    } catch {
      // fall through to the legacy property
    }
    if (!p) {
      const legacy = (file as File & { path?: string }).path;
      if (typeof legacy === 'string') p = legacy;
    }
    if (p) entries.push({ path: p, kind });
  }
  return entries;
}

/**
 * Route a drop's paths. `canvasPoint` (flow coordinates) is set when the drop
 * landed on the canvas — imported files with a canvas card get placed there,
 * staggered so a multi-file drop doesn't stack into one pile.
 */
export async function handleExternalDrop(
  entries: readonly DroppedPathEntry[],
  opts: { canvasPoint?: { x: number; y: number }; folderScope?: string | null } = {},
): Promise<void> {
  if (entries.length === 0) return;
  const store = useWorkspaceStore.getState();
  const dirs = entries.filter((entry) => entry.kind === 'dir').map((entry) => entry.path);
  const files = entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path);

  if (files.length > 0) {
    if (store.current === null) {
      if (dirs.length === 0) {
        useWorkspaceStore.setState({
          error: 'Open a folder first — dropped files are copied into the open workspace.',
        });
      }
      // With folders in the same drop, they open below and the user can re-drop
      // the files into the now-open workspace.
    } else {
      await importFiles(files, opts);
    }
  }
  // Folders last: opening a workspace switches context, so the file copies
  // above land in the workspace the user dropped them ON, not the new one.
  if (dirs.length > 0) await store.addDroppedPaths(dirs);
}

async function importFiles(
  files: readonly string[],
  opts: { canvasPoint?: { x: number; y: number }; folderScope?: string | null },
): Promise<void> {
  const store = useWorkspaceStore.getState();
  const copied: ImportFileResult[] = [];
  const existing: ImportFileResult[] = [];
  const failures: string[] = [];
  for (const from of files) {
    try {
      const r = await workspaceService.importFile(from, opts.folderScope ?? null);
      (r.imported ? copied : existing).push(r);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  // Place each NEW card where the user let go. Existing files keep their spot —
  // re-dropping a file you already have must not yank its card across the map.
  if (opts.canvasPoint) {
    let placed = 0;
    for (const r of copied) {
      if (!r.supported) continue;
      try {
        // Position goes to the folder's canvas.yaml (canvas.setCard) now, not the
        // badge. CanvasCard requires a width+height — seed the default file-card
        // size; the user can resize later.
        await canvasMirrorService.setCard(opts.folderScope ?? null, {
          path: r.path,
          kind: 'file',
          x: opts.canvasPoint.x + placed * 32,
          y: opts.canvasPoint.y + placed * 32,
          width: DEFAULT_FILE_CARD_WIDTH,
          height: DEFAULT_FILE_CARD_HEIGHT,
        });
        placed++;
      } catch {
        // Placement is cosmetic — the file is already safely copied; the card
        // just falls back to the default grid spot.
      }
    }
  }
  // One canvas refresh for the whole batch (faster + steadier than waiting for
  // the watcher to notice the new files).
  if (copied.length > 0) emitBadgeChange('import');

  const wsLabel = opts.folderScope ? `${opts.folderScope}/` : `“${store.current ?? ''}”`;
  const parts: string[] = [];
  if (copied.length === 1 && copied[0]) {
    parts.push(`Copied ${copied[0].name} into ${wsLabel} — the original stays where it was.`);
  } else if (copied.length > 1) {
    parts.push(
      `Copied ${copied.length} files into ${wsLabel} — the originals stay where they were.`,
    );
  }
  if (existing.length > 0) {
    parts.push(
      existing.length === 1 && existing[0]
        ? `${existing[0].name} is already in this workspace.`
        : `${existing.length} files were already in this workspace.`,
    );
  }
  if (parts.length > 0) useWorkspaceStore.getState().setNotice(parts.join(' '));
  if (failures.length > 0) {
    useWorkspaceStore.setState({ error: `Some files could not be copied: ${failures.join('; ')}` });
  }
}
