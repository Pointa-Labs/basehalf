import type { BadgeFile, BadgeRenameArgs, BadgeRenameResult } from '../common/badge.js';
import type { AdhdMainService } from './adhdMainService.js';
import type { BadgeMainService } from './badgeMainService.js';
import type { CanvasMainService } from './canvasMainService.js';
import type { FocusMainService } from './focusMainService.js';

export interface MirrorNodeOperationMainServiceOptions {
  readonly badges: BadgeMainService;
  readonly canvas: CanvasMainService;
  readonly focus: FocusMainService;
  readonly adhd: AdhdMainService;
}

/**
 * Derived-state participant for explicit file operations. VS Code keeps file
 * mutation separate from workbench participants that update view/editor state;
 * this service is BaseHalf's mirror participant for badge/canvas/focus/adhd.
 */
export class MirrorNodeOperationMainService {
  constructor(private readonly opts: MirrorNodeOperationMainServiceOptions) {}

  rename(workspaceRoot: string, args: BadgeRenameArgs): Promise<BadgeRenameResult> {
    return this.opts.badges.rename(workspaceRoot, args);
  }

  async purgeDeletedNode(
    workspaceRoot: string,
    args: { readonly path: string; readonly kind: 'file' | 'folder' },
  ): Promise<void> {
    await this.purgeBadges(workspaceRoot, args.path, args.kind);
    await this.bestEffort('canvas.purgeNode', () =>
      this.opts.canvas.purgeNode(workspaceRoot, { path: args.path, kind: args.kind }),
    );
    await this.bestEffort('adhd.purgeNode', () =>
      this.opts.adhd.purgeNode(workspaceRoot, { path: args.path }),
    );
    await this.bestEffort('focus.purgeNode', () =>
      this.opts.focus.purgeNode(workspaceRoot, { path: args.path }),
    );
    await this.opts.focus.pruneDangling(workspaceRoot);
  }

  private async purgeBadges(
    workspaceRoot: string,
    path: string,
    kind: 'file' | 'folder',
  ): Promise<void> {
    await this.opts.badges.delete(workspaceRoot, { file: path, kind });
    if (kind !== 'folder') return;
    const { badges } = await this.opts.badges.list(workspaceRoot, {});
    const prefix = `${path}/`;
    for (const badge of badges as readonly BadgeFile[]) {
      if (badge.path.startsWith(prefix)) {
        await this.opts.badges.delete(workspaceRoot, { file: badge.path, kind: badge.kind });
      }
    }
  }

  private async bestEffort(label: string, op: () => Promise<unknown>): Promise<void> {
    try {
      await op();
    } catch (err) {
      console.warn(`[bh] delete cascade ${label} failed:`, err);
    }
  }
}
