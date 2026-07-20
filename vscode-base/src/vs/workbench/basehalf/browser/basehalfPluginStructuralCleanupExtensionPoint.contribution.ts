/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../base/common/lifecycle.js';
import * as nls from '../../../nls.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { ExtensionsRegistry, IExtensionPointUser } from '../../services/extensions/common/extensionsRegistry.js';
import { baseHalfPluginContributorIdentity, IBaseHalfPluginAdmissionService } from '../common/basehalfPluginAdmissionService.js';
import { IBaseHalfPluginStructuralCleanupService } from '../common/basehalfPluginStructuralCleanup.js';

interface IBaseHalfStructuralCleanupContribution {
	readonly id: string;
	readonly extensions: readonly string[];
}

const structuralCleanupExtensionPoint = ExtensionsRegistry.registerExtensionPoint<IBaseHalfStructuralCleanupContribution[]>({
	extensionPoint: 'basehalfStructuralCleanups',
	jsonSchema: {
		description: nls.localize('contributes.basehalfStructuralCleanups', 'Contributes reviewed cleanup for domain references when a canvas file is deleted.'),
		type: 'array',
		maxItems: 16,
		items: {
			type: 'object',
			additionalProperties: false,
			properties: {
				id: { type: 'string', pattern: '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){2,}$' },
				extensions: { type: 'array', uniqueItems: true, minItems: 1, maxItems: 16, items: { type: 'string', pattern: '^\\.[A-Za-z0-9][A-Za-z0-9.-]*$' } }
			},
			required: ['id', 'extensions']
		}
	},
	activationEventsGenerator: function* (contributions) {
		for (const contribution of contributions) {
			yield `onBaseHalfStructuralCleanup:${contribution.id}`;
		}
	}
});

export class BaseHalfPluginStructuralCleanupExtensionPointContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfPluginStructuralCleanupExtensionPoint';
	private readonly registrations = this._register(new DisposableMap<string>());
	private users: readonly IExtensionPointUser<IBaseHalfStructuralCleanupContribution[]>[] = [];

	constructor(
		@IBaseHalfPluginStructuralCleanupService private readonly cleanupService: IBaseHalfPluginStructuralCleanupService,
		@IBaseHalfPluginAdmissionService private readonly admissionService: IBaseHalfPluginAdmissionService
	) {
		super();
		this._register(structuralCleanupExtensionPoint.setHandler(users => {
			this.users = users;
			this.rebuild();
		}));
		this._register(this.admissionService.onDidChange(() => this.rebuild()));
	}

	private rebuild(): void {
		this.registrations.clearAndDisposeAll();
		for (const user of this.users) {
			if (!this.admissionService.isAllowedContributor(baseHalfPluginContributorIdentity(user.description))) {
				user.collector.error(`Extension '${user.description.identifier.value}' is not admitted to contribute BaseHalf structural cleanup.`);
				continue;
			}
			const extensionId = user.description.identifier.value.toLowerCase();
			const store = new DisposableStore();
			for (const contribution of user.value) {
				if (!contribution.id.toLowerCase().startsWith(`${extensionId}.`)) {
					user.collector.error(`BaseHalf structural cleanup '${contribution.id}' must start with '${extensionId}.'.`);
					continue;
				}
				const extensions = contribution.extensions ?? [];
				if (extensions.length === 0 || extensions.length > 16
					|| new Set(extensions.map(extension => extension.toLowerCase())).size !== extensions.length
					|| extensions.some(extension => !/^\.[a-z0-9][a-z0-9.-]*$/i.test(extension))) {
					user.collector.error(`BaseHalf structural cleanup '${contribution.id}' must declare valid, unique file extensions.`);
					continue;
				}
				try {
					store.add(this.cleanupService.registerDescriptor(extensionId, contribution.id, extensions));
				} catch (error) {
					user.collector.error(error instanceof Error ? error.message : String(error));
				}
			}
			this.registrations.set(extensionId, store);
		}
	}
}

registerWorkbenchContribution2(BaseHalfPluginStructuralCleanupExtensionPointContribution.ID, BaseHalfPluginStructuralCleanupExtensionPointContribution, WorkbenchPhase.BlockRestore);
