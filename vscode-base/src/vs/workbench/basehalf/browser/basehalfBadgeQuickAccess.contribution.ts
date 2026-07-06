/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Codicon } from '../../../base/common/codicons.js';
import { matchesFuzzy } from '../../../base/common/filters.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { joinPath } from '../../../base/common/resources.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { localize } from '../../../nls.js';
import { IPickerQuickAccessItem, PickerQuickAccessProvider } from '../../../platform/quickinput/browser/pickerQuickAccess.js';
import { Extensions, IQuickAccessRegistry } from '../../../platform/quickinput/common/quickAccess.js';
import { IQuickPickSeparator } from '../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IBaseHalfBadgeGraphService } from '../common/basehalfBadgeGraph.js';
import { IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';

/**
 * `badge ` quick access: find files and folders by the human-authored badge
 * note instead of the filename. The note IS the human's index of what matters —
 * this makes it navigable, mirroring the note-aware search of the original
 * BaseHalf command palette on VS Code's native quick-access machinery.
 */
export class BaseHalfBadgeQuickAccessProvider extends PickerQuickAccessProvider<IPickerQuickAccessItem> {

	static readonly PREFIX = 'badge ';

	constructor(
		@IBaseHalfBadgeGraphService private readonly badgeGraphService: IBaseHalfBadgeGraphService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService
	) {
		super(BaseHalfBadgeQuickAccessProvider.PREFIX, {
			canAcceptInBackground: false,
			noResultsPick: {
				label: localize('basehalf.badgeQuickAccess.noResults', "No annotated files match")
			}
		});
	}

	protected async _getPicks(filter: string, _disposables: DisposableStore, token: CancellationToken): Promise<Array<IPickerQuickAccessItem | IQuickPickSeparator>> {
		const picks: IPickerQuickAccessItem[] = [];
		for (const folder of this.contextService.getWorkspace().folders) {
			const { badges } = await this.badgeGraphService.listBadges(folder.uri);
			if (token.isCancellationRequested) {
				return [];
			}

			for (const badge of badges.values()) {
				if (!badge.description) {
					continue; // only human-noted entries — the note is what this search is FOR
				}

				const labelMatch = filter ? matchesFuzzy(filter, badge.description, true) : undefined;
				const pathMatch = filter ? matchesFuzzy(filter, badge.path, true) : undefined;
				if (filter && !labelMatch && !pathMatch) {
					continue;
				}

				const resource = badge.path ? joinPath(folder.uri, ...badge.path.split('/')) : folder.uri;
				picks.push({
					label: badge.description,
					description: badge.path,
					iconClass: ThemeIcon.asClassName(badge.kind === 'folder' ? Codicon.folder : Codicon.file),
					highlights: {
						label: labelMatch ?? undefined,
						description: pathMatch ?? undefined
					},
					accept: () => {
						void this.canvasNavigationService.openResource(resource, { source: 'quickAccess', pinned: true });
					}
				});
			}
		}

		return picks.sort((a, b) => (a.description ?? '').localeCompare(b.description ?? ''));
	}
}

Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess).registerQuickAccessProvider({
	ctor: BaseHalfBadgeQuickAccessProvider,
	prefix: BaseHalfBadgeQuickAccessProvider.PREFIX,
	placeholder: localize('basehalf.badgeQuickAccess.placeholder', "Search files and folders by their badge note."),
	helpEntries: [{ description: localize('basehalf.badgeQuickAccess.help', "Search Badge Notes") }]
});
