/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IJSONSchema } from '../../../../base/common/jsonSchema.js';
import * as nls from '../../../../nls.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ExtensionsRegistry, IExtensionPointUser } from '../../../services/extensions/common/extensionsRegistry.js';
import { IBaseHalfCanvasTemplateContribution, IBaseHalfCanvasTemplateRegistryService } from '../../canvas/common/basehalfCanvasTemplateRegistry.js';
import { baseHalfPluginContributorIdentity, IBaseHalfPluginAdmissionService } from '../common/basehalfPluginAdmissionService.js';

const contributionIdSchema: IJSONSchema = {
	type: 'string',
	minLength: 5,
	maxLength: 128,
	pattern: '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){2,}$'
};

const baseHalfCanvasTemplatesExtensionPoint = ExtensionsRegistry.registerExtensionPoint<IBaseHalfCanvasTemplateContribution[]>({
	extensionPoint: 'basehalfCanvasTemplates',
	jsonSchema: {
		description: nls.localize('contributes.basehalfCanvasTemplates', 'Contributes static BaseHalf canvas templates.'),
		type: 'array',
		maxItems: 64,
		items: {
			type: 'object',
			additionalProperties: false,
			properties: {
				id: { ...contributionIdSchema, description: nls.localize('contributes.basehalfCanvasTemplates.id', 'Globally unique template identifier prefixed by the extension id.') },
				label: { type: 'string', minLength: 1, maxLength: 80 },
				description: { type: 'string', minLength: 1, maxLength: 500 },
				resource: {
					type: 'string',
					minLength: 6,
					maxLength: 500,
					pattern: '^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))(?![A-Za-z][A-Za-z0-9+.-]*:)[^?#]+\\.json$'
				}
			},
			required: ['id', 'label', 'resource']
		}
	}
});

/** Registers the canvas templates of admitted extensions. */
export class BaseHalfCanvasTemplateExtensionPointContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfCanvasTemplateExtensionPoint';
	private readonly templateRegistrations = this._register(new DisposableMap<string>());
	private templateUsers: readonly IExtensionPointUser<IBaseHalfCanvasTemplateContribution[]>[] = [];

	constructor(
		@IBaseHalfCanvasTemplateRegistryService private readonly templateRegistryService: IBaseHalfCanvasTemplateRegistryService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService
	) {
		super();
		this._register(baseHalfCanvasTemplatesExtensionPoint.setHandler(users => {
			this.templateUsers = users;
			this.rebuildTemplates();
		}));
		this._register(this.pluginAdmissionService.onDidChange(() => this.rebuildTemplates()));
	}

	private rebuildTemplates(): void {
		this.templateRegistrations.clearAndDisposeAll();
		for (const user of this.templateUsers) {
			if (this.isAllowed(user)) {
				this.registerTemplates(user);
			}
		}
	}

	private isAllowed(user: IExtensionPointUser<unknown>): boolean {
		if (this.pluginAdmissionService.isAllowedContributor(baseHalfPluginContributorIdentity(user.description))) {
			return true;
		}
		user.collector.error(`Extension '${user.description.identifier.value}' is not admitted to contribute BaseHalf canvas capabilities.`);
		return false;
	}

	private registerTemplates(user: IExtensionPointUser<IBaseHalfCanvasTemplateContribution[]>): void {
		const extensionId = user.description.identifier.value.toLowerCase();
		const store = new DisposableStore();
		for (const contribution of user.value) {
			try {
				store.add(this.templateRegistryService.registerTemplate(extensionId, user.description.extensionLocation, contribution));
			} catch (error) {
				user.collector.error(error instanceof Error ? error.message : String(error));
			}
		}
		this.templateRegistrations.set(extensionId, store);
	}
}

registerWorkbenchContribution2(BaseHalfCanvasTemplateExtensionPointContribution.ID, BaseHalfCanvasTemplateExtensionPointContribution, WorkbenchPhase.BlockRestore);
