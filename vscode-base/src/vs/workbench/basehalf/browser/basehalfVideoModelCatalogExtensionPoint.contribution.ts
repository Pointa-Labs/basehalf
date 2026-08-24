/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { extUri } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import * as nls from '../../../nls.js';
import { IJSONSchema } from '../../../base/common/jsonSchema.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { ExtensionsRegistry, IExtensionPointUser } from '../../services/extensions/common/extensionsRegistry.js';
import { baseHalfPluginContributorIdentity, IBaseHalfPluginAdmissionService } from '../common/basehalfPluginAdmissionService.js';
import { IBaseHalfVideoModelCatalogContribution, IBaseHalfVideoModelCatalogService } from '../common/basehalfVideoModelCatalogs.js';

const MAX_VIDEO_MODEL_CATALOG_BYTES = 512 * 1024;

const contributionIdSchema: IJSONSchema = {
	type: 'string',
	minLength: 5,
	maxLength: 128,
	pattern: '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){2,}$'
};

const baseHalfVideoModelCatalogsExtensionPoint = ExtensionsRegistry.registerExtensionPoint<IBaseHalfVideoModelCatalogContribution[]>({
	extensionPoint: 'basehalfVideoModelCatalogs',
	jsonSchema: {
		description: nls.localize('contributes.basehalfVideoModelCatalogs', 'Contributes reviewed, versioned video model capability catalogs.'),
		type: 'array',
		maxItems: 8,
		items: {
			type: 'object',
			additionalProperties: false,
			properties: {
				id: { ...contributionIdSchema, description: nls.localize('contributes.basehalfVideoModelCatalogs.id', 'Globally unique catalog identifier prefixed by the extension id.') },
				resource: {
					type: 'string',
					minLength: 6,
					maxLength: 500,
					pattern: '^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))(?![A-Za-z][A-Za-z0-9+.-]*:)[^?#]+\\.json$'
				}
			},
			required: ['id', 'resource']
		}
	}
});

export class BaseHalfVideoModelCatalogExtensionPointContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfVideoModelCatalogExtensionPoint';

	private readonly registrations = this._register(new DisposableMap<string>());
	private users: readonly IExtensionPointUser<IBaseHalfVideoModelCatalogContribution[]>[] = [];
	private rebuildGeneration = 0;

	constructor(
		@IBaseHalfVideoModelCatalogService private readonly catalogService: IBaseHalfVideoModelCatalogService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
		this._register(baseHalfVideoModelCatalogsExtensionPoint.setHandler(users => {
			this.users = users;
			void this.rebuild();
		}));
		this._register(this.pluginAdmissionService.onDidChange(() => void this.rebuild()));
	}

	override dispose(): void {
		this.rebuildGeneration++;
		super.dispose();
	}

	private async rebuild(): Promise<void> {
		const generation = ++this.rebuildGeneration;
		this.registrations.clearAndDisposeAll();
		for (const user of this.users) {
			if (!this.pluginAdmissionService.isAllowedContributor(baseHalfPluginContributorIdentity(user.description))) {
				user.collector.error(`Extension '${user.description.identifier.value}' is not admitted to contribute BaseHalf video model catalogs.`);
				continue;
			}
			for (const contribution of user.value) {
				try {
					const resource = resolveCatalogResource(user.description.extensionLocation, contribution.resource);
					const content = await this.fileService.readFile(resource, { limits: { size: MAX_VIDEO_MODEL_CATALOG_BYTES } });
					if (generation !== this.rebuildGeneration) {
						return;
					}
					const value = JSON.parse(content.value.toString()) as unknown;
					const extensionId = user.description.identifier.value.toLowerCase();
					this.registrations.set(
						`${extensionId}:${contribution.id.toLowerCase()}`,
						this.catalogService.registerCatalog(extensionId, contribution.id, value)
					);
				} catch (error) {
					if (generation === this.rebuildGeneration) {
						const message = error instanceof Error ? error.message : String(error);
						user.collector.error(message);
					}
				}
			}
		}
	}
}

function resolveCatalogResource(extensionLocation: URI, value: string): URI {
	const relative = value.trim();
	if (!relative || relative.startsWith('/') || relative.startsWith('\\') || relative.includes('\\')
		|| relative.includes('?') || relative.includes('#') || /^[a-z][a-z0-9+.-]*:/i.test(relative)
		|| relative.split('/').some(segment => segment === '..')) {
		throw new Error('A video model catalog resource must be an extension-relative JSON path.');
	}
	const resource = URI.joinPath(extensionLocation, ...relative.split('/'));
	if (!extUri.isEqualOrParent(resource, extensionLocation) || extUri.isEqual(resource, extensionLocation)) {
		throw new Error('A video model catalog resource resolves outside its extension.');
	}
	return resource;
}

registerWorkbenchContribution2(
	BaseHalfVideoModelCatalogExtensionPointContribution.ID,
	BaseHalfVideoModelCatalogExtensionPointContribution,
	WorkbenchPhase.BlockRestore
);
