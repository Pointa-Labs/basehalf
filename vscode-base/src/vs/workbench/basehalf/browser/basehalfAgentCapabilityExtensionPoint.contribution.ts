/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../base/common/lifecycle.js';
import { IJSONSchema } from '../../../base/common/jsonSchema.js';
import * as nls from '../../../nls.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { ExtensionsRegistry, IExtensionPointUser } from '../../services/extensions/common/extensionsRegistry.js';
import { IBaseHalfAgentCapabilityContribution, IBaseHalfAgentCapabilityRegistryService } from '../common/basehalfAgentCapabilities.js';
import { baseHalfPluginContributorIdentity, IBaseHalfPluginAdmissionService } from '../common/basehalfPluginAdmissionService.js';

const ownedIdSchema: IJSONSchema = {
	type: 'string',
	minLength: 5,
	maxLength: 180,
	pattern: '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){2,}$'
};

const parameterNameSchema: IJSONSchema = {
	type: 'string',
	minLength: 1,
	maxLength: 64,
	pattern: '^[a-z][A-Za-z0-9]{0,63}$'
};

const operationParameterSchema: IJSONSchema = {
	oneOf: [
		{
			type: 'object',
			additionalProperties: false,
			properties: {
				name: parameterNameSchema,
				type: { enum: ['uri', 'string', 'integer', 'number', 'boolean'] },
				required: { type: 'boolean' },
				description: { type: 'string', minLength: 1, maxLength: 300 }
			},
			required: ['name', 'type', 'required', 'description']
		},
		{
			type: 'object',
			additionalProperties: false,
			properties: {
				name: parameterNameSchema,
				type: { const: 'enum' },
				required: { type: 'boolean' },
				description: { type: 'string', minLength: 1, maxLength: 300 },
				values: {
					type: 'array',
					minItems: 1,
					maxItems: 32,
					uniqueItems: true,
					items: { type: 'string', minLength: 1, maxLength: 100 }
				}
			},
			required: ['name', 'type', 'required', 'description', 'values']
		}
	]
};

const baseHalfAgentCapabilitiesExtensionPoint = ExtensionsRegistry.registerExtensionPoint<IBaseHalfAgentCapabilityContribution[]>({
	extensionPoint: 'basehalfAgentCapabilities',
	jsonSchema: {
		description: nls.localize('contributes.basehalfAgentCapabilities', 'Publishes reviewed domain document and command contracts to BaseHalf Agent sessions.'),
		type: 'array',
		maxItems: 32,
		items: {
			type: 'object',
			additionalProperties: false,
			properties: {
				id: ownedIdSchema,
				label: { type: 'string', minLength: 1, maxLength: 80 },
				description: { type: 'string', minLength: 1, maxLength: 500 },
				documents: {
					type: 'array',
					maxItems: 16,
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							kind: ownedIdSchema,
							version: { type: 'integer', minimum: 1, maximum: 1_000_000 },
							fileExtensions: {
								type: 'array',
								minItems: 1,
								maxItems: 16,
								uniqueItems: true,
								items: { type: 'string', pattern: '^\\.[A-Za-z0-9][A-Za-z0-9.-]{0,15}$' }
							},
							schemaSummary: { type: 'string', minLength: 1, maxLength: 2_000 },
							pin: {
								type: 'object',
								additionalProperties: false,
								properties: {
									mode: { const: 'exact-result-version' },
									field: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z][A-Za-z0-9_-]*(?:\\[\\])?(?:\\.[A-Za-z][A-Za-z0-9_-]*(?:\\[\\])?)*$' },
									targetKinds: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: { enum: ['file', 'image', 'video', 'audio', 'pdf', 'presentation'] } },
									acceptedVersionStates: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: ['succeeded', 'imported'] } },
									updatePolicy: { const: 'explicit' }
								},
								required: ['mode', 'field', 'targetKinds', 'acceptedVersionStates', 'updatePolicy']
							}
						},
						required: ['kind', 'version', 'fileExtensions', 'schemaSummary']
					}
				},
				operations: {
					type: 'array',
					maxItems: 64,
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							id: ownedIdSchema,
							command: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
							description: { type: 'string', minLength: 1, maxLength: 500 },
							deterministic: { const: true },
							parameters: { type: 'array', maxItems: 32, items: operationParameterSchema },
							returns: {
								type: 'object',
								additionalProperties: false,
								properties: {
									type: { enum: ['object', 'array', 'string', 'number', 'boolean', 'void'] },
									description: { type: 'string', minLength: 1, maxLength: 500 }
								},
								required: ['type', 'description']
							}
						},
						required: ['id', 'command', 'description', 'deterministic', 'returns']
					}
				}
			},
			required: ['id', 'label'],
			anyOf: [{ required: ['documents'] }, { required: ['operations'] }]
		}
	}
});

export class BaseHalfAgentCapabilityExtensionPointContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfAgentCapabilityExtensionPoint';

	private readonly registrations = this._register(new DisposableMap<string>());
	private users: readonly IExtensionPointUser<IBaseHalfAgentCapabilityContribution[]>[] = [];

	constructor(
		@IBaseHalfAgentCapabilityRegistryService private readonly registryService: IBaseHalfAgentCapabilityRegistryService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService
	) {
		super();
		this._register(baseHalfAgentCapabilitiesExtensionPoint.setHandler(users => {
			this.users = users;
			this.rebuild();
		}));
		this._register(this.pluginAdmissionService.onDidChange(() => this.rebuild()));
	}

	private rebuild(): void {
		this.registrations.clearAndDisposeAll();
		for (const user of this.users) {
			if (!this.pluginAdmissionService.isAllowedContributor(baseHalfPluginContributorIdentity(user.description))) {
				user.collector.error(`Extension '${user.description.identifier.value}' is not admitted to publish BaseHalf Agent capabilities.`);
				continue;
			}
			const extensionId = user.description.identifier.value.toLowerCase();
			const store = new DisposableStore();
			for (const capability of user.value) {
				try {
					store.add(this.registryService.registerCapability(extensionId, capability));
				} catch (error) {
					user.collector.error(error instanceof Error ? error.message : String(error));
				}
			}
			this.registrations.set(extensionId, store);
		}
	}
}

registerWorkbenchContribution2(BaseHalfAgentCapabilityExtensionPointContribution.ID, BaseHalfAgentCapabilityExtensionPointContribution, WorkbenchPhase.BlockRestore);
