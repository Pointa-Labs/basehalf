/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../base/browser/dom.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../base/common/lifecycle.js';
import * as nls from '../../../nls.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { ExtensionsRegistry, IExtensionPointUser } from '../../services/extensions/common/extensionsRegistry.js';
import { IBaseHalfCardProjectionRegistryService } from '../common/basehalfCardDetail.js';
import { baseHalfPluginContributorIdentity, IBaseHalfPluginAdmissionService } from '../common/basehalfPluginAdmissionService.js';
import { IBaseHalfCardDetailSurfaceRegistryService } from './cardDetail/basehalfCardDetailSurface.js';
import { BaseHalfExtensionCardDetail } from './cardDetail/basehalfExtensionCardProjection.js';

interface IBaseHalfCardProjectionContribution {
	readonly id: string;
	readonly label: string;
	readonly icon?: string;
	readonly extensions?: readonly string[];
	readonly fileNames?: readonly string[];
	readonly order?: number;
	readonly defaultPriority?: number;
}

const DEFAULT_BASEHALF_CARD_PROJECTION_ICON = 'file-code';

const baseHalfCardProjectionsExtensionPoint = ExtensionsRegistry.registerExtensionPoint<IBaseHalfCardProjectionContribution[]>({
	extensionPoint: 'basehalfCardProjections',
	jsonSchema: {
		description: nls.localize('contributes.basehalfCardProjections', 'Contributes center-area card projections to BaseHalf.'),
		type: 'array',
		maxItems: 64,
		items: {
			type: 'object',
			additionalProperties: false,
			properties: {
				id: { type: 'string', pattern: '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){2,}$', description: nls.localize('contributes.basehalfCardProjections.id', 'Globally unique projection identifier prefixed by the extension id.') },
				label: { type: 'string', minLength: 1, maxLength: 80 },
				icon: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9-]*$', description: nls.localize('contributes.basehalfCardProjections.icon', 'Optional Codicon name without the codicon- prefix.') },
				extensions: { type: 'array', uniqueItems: true, minItems: 1, maxItems: 64, items: { type: 'string', pattern: '^\\.[A-Za-z0-9][A-Za-z0-9.-]*$' } },
				fileNames: { type: 'array', uniqueItems: true, minItems: 1, maxItems: 64, items: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' } },
				order: { type: 'number', default: 100 },
				defaultPriority: { type: 'number' }
			},
			anyOf: [
				{ required: ['extensions'] },
				{ required: ['fileNames'] }
			],
			required: ['id', 'label']
		}
	},
	activationEventsGenerator: function* (contributions) {
		for (const contribution of contributions) {
			yield `onBaseHalfCardProjection:${contribution.id}`;
		}
	}
});

export class BaseHalfCardProjectionExtensionPointContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfCardProjectionExtensionPoint';
	private readonly registrations = this._register(new DisposableMap<string>());
	private users: readonly IExtensionPointUser<IBaseHalfCardProjectionContribution[]>[] = [];

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IBaseHalfCardProjectionRegistryService private readonly projectionRegistryService: IBaseHalfCardProjectionRegistryService,
		@IBaseHalfCardDetailSurfaceRegistryService private readonly surfaceRegistryService: IBaseHalfCardDetailSurfaceRegistryService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService
	) {
		super();
		this._register(baseHalfCardProjectionsExtensionPoint.setHandler(users => {
			this.users = users;
			this.rebuild();
		}));
		this._register(this.pluginAdmissionService.onDidChange(() => this.rebuild()));
	}

	private rebuild(): void {
		this.registrations.clearAndDisposeAll();
		for (const user of this.users) {
			if (this.pluginAdmissionService.isAllowedContributor(baseHalfPluginContributorIdentity(user.description))) {
				this.registerExtension(user);
			} else {
				user.collector.error(`Extension '${user.description.identifier.value}' is not admitted to contribute BaseHalf card projections.`);
			}
		}
	}

	private registerExtension(user: IExtensionPointUser<IBaseHalfCardProjectionContribution[]>): void {
		const extensionId = user.description.identifier.value.toLowerCase();
		const store = new DisposableStore();
		for (const contribution of user.value) {
			if (!contribution.id.toLowerCase().startsWith(`${extensionId}.`)) {
				user.collector.error(`BaseHalf projection '${contribution.id}' must start with '${extensionId}.'.`);
				continue;
			}
			const extensions = contribution.extensions ?? [];
			const fileNames = contribution.fileNames ?? [];
			if ((extensions.length === 0 && fileNames.length === 0)
				|| extensions.length > 64
				|| fileNames.length > 64
				|| new Set(extensions.map(extension => extension.toLowerCase())).size !== extensions.length
				|| new Set(fileNames.map(fileName => fileName.toLowerCase())).size !== fileNames.length
				|| extensions.some(extension => !/^\.[a-z0-9][a-z0-9.-]*$/i.test(extension))
				|| fileNames.some(fileName => !/^[a-z0-9][a-z0-9._-]*$/i.test(fileName) || fileName === '.' || fileName === '..')) {
				user.collector.error(`BaseHalf projection '${contribution.id}' must declare valid, unique file extensions or exact file names.`);
				continue;
			}
			const contributionStore = new DisposableStore();
			try {
				contributionStore.add(this.projectionRegistryService.registerProjection({
					id: contribution.id,
					label: contribution.label,
					icon: `codicon-${contribution.icon ?? DEFAULT_BASEHALF_CARD_PROJECTION_ICON}`,
					selector: { extensions, fileNames },
					order: contribution.order ?? 100,
					defaultPriority: contribution.defaultPriority
				}));
				contributionStore.add(this.surfaceRegistryService.registerProvider(contribution.id, {
					create: (parent, state) => {
						const host = append(parent, $('.basehalf-card-detail-surface'));
						return {
							host,
							instance: this.instantiationService.createInstance(BaseHalfExtensionCardDetail, host, extensionId, contribution.id)
						};
					}
				}));
				store.add(contributionStore);
			} catch (error) {
				contributionStore.dispose();
				user.collector.error(error instanceof Error ? error.message : String(error));
			}
		}
		this.registrations.set(extensionId, store);
	}
}

registerWorkbenchContribution2(BaseHalfCardProjectionExtensionPointContribution.ID, BaseHalfCardProjectionExtensionPointContribution, WorkbenchPhase.BlockRestore);
