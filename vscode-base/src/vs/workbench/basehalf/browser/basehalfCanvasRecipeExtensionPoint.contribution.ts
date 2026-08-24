/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../base/common/lifecycle.js';
import { IJSONSchema, IJSONSchemaMap } from '../../../base/common/jsonSchema.js';
import * as nls from '../../../nls.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { ExtensionsRegistry, IExtensionPointUser } from '../../services/extensions/common/extensionsRegistry.js';
import {
	IBaseHalfCanvasRecipeContribution,
	IBaseHalfCanvasRecipeRegistryService,
	IBaseHalfCanvasTemplateContribution
} from '../common/basehalfCanvasRecipes.js';
import { baseHalfPluginContributorIdentity, IBaseHalfPluginAdmissionService } from '../common/basehalfPluginAdmissionService.js';

const contributionIdSchema: IJSONSchema = {
	type: 'string',
	minLength: 5,
	maxLength: 128,
	pattern: '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){2,}$'
};

const localIdSchema: IJSONSchema = {
	type: 'string',
	minLength: 1,
	maxLength: 64,
	pattern: '^[a-z][a-z0-9-]*$'
};

const labelSchema: IJSONSchema = { type: 'string', minLength: 1, maxLength: 80 };
const contentKindSchema: IJSONSchema = { enum: ['text', 'code', 'file', 'folder', 'image', 'video', 'audio', 'pdf', 'presentation'] };

const stringParameterProperties: IJSONSchemaMap = {
	id: localIdSchema,
	label: labelSchema,
	required: { type: 'boolean' },
	type: { enum: ['string', 'multiline'] },
	default: { type: 'string', maxLength: 100_000 },
	minLength: { type: 'integer', minimum: 0, maximum: 100_000 },
	maxLength: { type: 'integer', minimum: 1, maximum: 100_000 }
};

const baseHalfCanvasRecipesExtensionPoint = ExtensionsRegistry.registerExtensionPoint<IBaseHalfCanvasRecipeContribution[]>({
	extensionPoint: 'basehalfCanvasRecipes',
	jsonSchema: {
		description: nls.localize('contributes.basehalfCanvasRecipes', 'Contributes declarative recipes executed on BaseHalf canvas nodes.'),
		type: 'array',
		maxItems: 64,
		items: {
			type: 'object',
			additionalProperties: false,
			allOf: [{
				if: { properties: { modelCapability: { const: 'video' } }, required: ['modelCapability'] },
				then: {
					required: ['videoModelCatalogId'],
					properties: {
						outputs: {
							items: { properties: { kind: { const: 'video' } }, required: ['kind'] }
						}
					}
				},
				else: { not: { required: ['videoModelCatalogId'] } }
			}, {
				if: {
					properties: {
						outputs: { items: { properties: { kind: { const: 'video' } }, required: ['kind'] } }
					},
					required: ['outputs']
				},
				then: { properties: { modelCapability: { const: 'video' } } }
			}],
			properties: {
				id: { ...contributionIdSchema, description: nls.localize('contributes.basehalfCanvasRecipes.id', 'Globally unique recipe identifier prefixed by the extension id.') },
				label: labelSchema,
				description: { type: 'string', minLength: 1, maxLength: 500 },
				icon: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9-]*$' },
				modelCapability: { enum: ['text', 'image', 'video', 'audio'] },
				videoModelCatalogId: { ...contributionIdSchema, description: nls.localize('contributes.basehalfCanvasRecipes.videoModelCatalogId', 'Exact reviewed video model catalog owned by this recipe extension. Required for video recipes and forbidden otherwise.') },
				inputs: {
					type: 'array',
					maxItems: 16,
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							id: localIdSchema,
							label: labelSchema,
							accepts: { type: 'array', minItems: 1, maxItems: 9, uniqueItems: true, items: contentKindSchema },
							minItems: { type: 'integer', minimum: 0, maximum: 64 },
							maxItems: { type: 'integer', minimum: 1, maximum: 64 }
						},
						required: ['id', 'label', 'accepts', 'minItems', 'maxItems']
					}
				},
				parameters: {
					type: 'array',
					maxItems: 32,
					items: {
						oneOf: [
							{
								type: 'object',
								additionalProperties: false,
								properties: stringParameterProperties,
								required: ['id', 'label', 'type']
							},
							{
								type: 'object',
								additionalProperties: false,
								properties: {
									id: localIdSchema,
									label: labelSchema,
									required: { type: 'boolean' },
									type: { const: 'number' },
									default: { type: 'number' },
									minimum: { type: 'number' },
									maximum: { type: 'number' },
									step: { type: 'number', exclusiveMinimum: 0 }
								},
								required: ['id', 'label', 'type']
							},
							{
								type: 'object',
								additionalProperties: false,
								properties: {
									id: localIdSchema,
									label: labelSchema,
									required: { type: 'boolean' },
									type: { const: 'boolean' },
									default: { type: 'boolean' }
								},
								required: ['id', 'label', 'type']
							},
							{
								type: 'object',
								additionalProperties: false,
								properties: {
									id: localIdSchema,
									label: labelSchema,
									required: { type: 'boolean' },
									type: { const: 'enum' },
									default: { type: 'string', minLength: 1, maxLength: 100 },
									options: {
										type: 'array',
										minItems: 1,
										maxItems: 50,
										items: {
											type: 'object',
											additionalProperties: false,
											properties: {
												value: { type: 'string', minLength: 1, maxLength: 100 },
												label: { type: 'string', minLength: 1, maxLength: 100 }
											},
											required: ['value', 'label']
										}
									}
								},
								required: ['id', 'label', 'type', 'options']
							}
						]
					}
				},
				outputs: {
					type: 'array',
					minItems: 1,
					maxItems: 1,
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							id: localIdSchema,
							kind: { enum: ['file', 'image', 'video', 'audio', 'pdf', 'presentation'] },
							extensions: { type: 'array', minItems: 1, maxItems: 16, uniqueItems: true, items: { type: 'string', pattern: '^\\.[A-Za-z0-9][A-Za-z0-9.-]{0,15}$' } },
							minItems: { type: 'integer', const: 1 },
							maxItems: { type: 'integer', const: 1 },
							primary: { type: 'boolean', const: true }
						},
						required: ['id', 'kind', 'extensions', 'minItems', 'maxItems', 'primary']
					}
				}
			},
			required: ['id', 'label', 'outputs']
		}
	},
	activationEventsGenerator: function* (contributions) {
		for (const contribution of contributions) {
			yield `onBaseHalfCanvasRecipe:${contribution.id}`;
		}
	}
});

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
				label: labelSchema,
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

export class BaseHalfCanvasRecipeExtensionPointContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfCanvasRecipeExtensionPoint';
	private readonly recipeRegistrations = this._register(new DisposableMap<string>());
	private readonly templateRegistrations = this._register(new DisposableMap<string>());
	private recipeUsers: readonly IExtensionPointUser<IBaseHalfCanvasRecipeContribution[]>[] = [];
	private templateUsers: readonly IExtensionPointUser<IBaseHalfCanvasTemplateContribution[]>[] = [];

	constructor(
		@IBaseHalfCanvasRecipeRegistryService private readonly recipeRegistryService: IBaseHalfCanvasRecipeRegistryService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService
	) {
		super();
		this._register(baseHalfCanvasRecipesExtensionPoint.setHandler(users => {
			this.recipeUsers = users;
			this.rebuildRecipes();
		}));
		this._register(baseHalfCanvasTemplatesExtensionPoint.setHandler(users => {
			this.templateUsers = users;
			this.rebuildTemplates();
		}));
		this._register(this.pluginAdmissionService.onDidChange(() => {
			this.rebuildRecipes();
			this.rebuildTemplates();
		}));
	}

	private rebuildRecipes(): void {
		this.recipeRegistrations.clearAndDisposeAll();
		for (const user of this.recipeUsers) {
			if (this.isAllowed(user)) {
				this.registerRecipes(user);
			}
		}
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

	private registerRecipes(user: IExtensionPointUser<IBaseHalfCanvasRecipeContribution[]>): void {
		const extensionId = user.description.identifier.value.toLowerCase();
		const store = new DisposableStore();
		for (const contribution of user.value) {
			try {
				store.add(this.recipeRegistryService.registerRecipe(extensionId, contribution));
			} catch (error) {
				user.collector.error(error instanceof Error ? error.message : String(error));
			}
		}
		this.recipeRegistrations.set(extensionId, store);
	}

	private registerTemplates(user: IExtensionPointUser<IBaseHalfCanvasTemplateContribution[]>): void {
		const extensionId = user.description.identifier.value.toLowerCase();
		const store = new DisposableStore();
		for (const contribution of user.value) {
			try {
				store.add(this.recipeRegistryService.registerTemplate(extensionId, user.description.extensionLocation, contribution));
			} catch (error) {
				user.collector.error(error instanceof Error ? error.message : String(error));
			}
		}
		this.templateRegistrations.set(extensionId, store);
	}
}

registerWorkbenchContribution2(BaseHalfCanvasRecipeExtensionPointContribution.ID, BaseHalfCanvasRecipeExtensionPointContribution, WorkbenchPhase.BlockRestore);
