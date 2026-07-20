/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ExtensionIdentifier, IExtensionDescription, TargetPlatform } from '../../../../platform/extensions/common/extensions.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { BaseHalfCanvasRecipeExtensionPointContribution } from '../../browser/basehalfCanvasRecipeExtensionPoint.contribution.js';
import { BaseHalfAgentCapabilityExtensionPointContribution } from '../../browser/basehalfAgentCapabilityExtensionPoint.contribution.js';
import { BaseHalfCardProjectionExtensionPointContribution } from '../../browser/basehalfCardProjectionExtensionPoint.contribution.js';
import { BaseHalfCardDetailSurfaceRegistryService } from '../../browser/cardDetail/basehalfCardDetailSurface.js';
import { BaseHalfCanvasRecipeRegistryService, IBaseHalfCanvasRecipeContribution, IBaseHalfCanvasTemplateContribution } from '../../common/basehalfCanvasRecipes.js';
import { BaseHalfAgentCapabilityRegistryService, IBaseHalfAgentCapabilityContribution } from '../../common/basehalfAgentCapabilities.js';
import { BaseHalfCardProjectionRegistryService } from '../../common/basehalfCardDetail.js';
import { BaseHalfPluginAdmissionService, hashBaseHalfPluginInstall } from '../../common/basehalfPluginAdmissionService.js';
import { ExtensionMessageCollector, ExtensionPoint, ExtensionsRegistry, IExtensionPointUser } from '../../../services/extensions/common/extensionsRegistry.js';

interface ITestProjectionContribution {
	readonly id: string;
	readonly label: string;
	readonly icon?: string;
	readonly extensions: readonly string[];
}

suite('BaseHalfPluginContributionAdmission', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('rebuilds recipes, templates, and projections from full admitted extension state', async () => {
		const storage = new InMemoryStorageService();
		const files = pluginFileService();
		const admission = new BaseHalfPluginAdmissionService(storage, { isExtensionDevelopment: false } as unknown as IEnvironmentService, files);
		const recipes = new BaseHalfCanvasRecipeRegistryService();
		const agentCapabilities = new BaseHalfAgentCapabilityRegistryService();
		const projections = new BaseHalfCardProjectionRegistryService();
		const surfaces = new BaseHalfCardDetailSurfaceRegistryService();
		const recipeContribution = new BaseHalfCanvasRecipeExtensionPointContribution(recipes, admission);
		const agentCapabilityContribution = new BaseHalfAgentCapabilityExtensionPointContribution(agentCapabilities, admission);
		const projectionContribution = new BaseHalfCardProjectionExtensionPointContribution({} as IInstantiationService, projections, surfaces, admission);
		const recipePoint = extensionPoint<IBaseHalfCanvasRecipeContribution[]>('basehalfCanvasRecipes');
		const templatePoint = extensionPoint<IBaseHalfCanvasTemplateContribution[]>('basehalfCanvasTemplates');
		const projectionPoint = extensionPoint<ITestProjectionContribution[]>('basehalfCardProjections');
		const agentCapabilityPoint = extensionPoint<IBaseHalfAgentCapabilityContribution[]>('basehalfAgentCapabilities');

		try {
			const location = URI.file('/extensions/reviewed-workflow');
			const firstInstalledContentSha256 = await hashBaseHalfPluginInstall(files, location);
			recipePoint.acceptUsers([recipeUser('reviewed.workflow', '1.0.0', location, 'reviewed.workflow.render')]);
			templatePoint.acceptUsers([templateUser('reviewed.workflow', '1.0.0', location, 'reviewed.workflow.starter')]);
			projectionPoint.acceptUsers([projectionUser('reviewed.workflow', '1.0.0', location, 'reviewed.workflow.detail')]);
			agentCapabilityPoint.acceptUsers([agentCapabilityUser('reviewed.workflow', '1.0.0', location, 'reviewed.workflow.sequence-capability')]);
			assert.strictEqual(recipes.getRecipe('reviewed.workflow.render'), undefined);
			assert.strictEqual(recipes.getTemplate('reviewed.workflow.starter'), undefined);
			assert.strictEqual(projections.getProjection('reviewed.workflow.detail'), undefined);
			assert.strictEqual(agentCapabilities.getCapability('reviewed.workflow.sequence-capability'), undefined);

			const firstSha256 = 'a'.repeat(64);
			admission.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '1.0.0', sha256: firstSha256, installedContentSha256: firstInstalledContentSha256 }] }]);
			assert.strictEqual(recipes.getRecipe('reviewed.workflow.render'), undefined);
			assert.ok(await admission.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '1.0.0', sha256: firstSha256, extensionLocation: location, expectedInstalledContentSha256: firstInstalledContentSha256 }));
			assert.ok(recipes.getRecipe('reviewed.workflow.render'));
			assert.ok(recipes.getTemplate('reviewed.workflow.starter'));
			assert.ok(projections.getProjection('reviewed.workflow.detail'));
			assert.strictEqual(projections.getProjection('reviewed.workflow.detail')?.icon, 'codicon-file-code');
			assert.deepStrictEqual(projections.getProjection('reviewed.workflow.detail')?.selector?.extensions, ['.story-board']);
			assert.ok(agentCapabilities.getCapability('reviewed.workflow.sequence-capability'));

			recipePoint.acceptUsers([recipeUser('reviewed.workflow', '1.0.0', location, 'reviewed.workflow.render-v2')]);
			templatePoint.acceptUsers([templateUser('reviewed.workflow', '1.0.0', location, 'reviewed.workflow.starter-v2')]);
			projectionPoint.acceptUsers([projectionUser('reviewed.workflow', '1.0.0', location, 'reviewed.workflow.detail-v2')]);
			agentCapabilityPoint.acceptUsers([agentCapabilityUser('reviewed.workflow', '1.0.0', location, 'reviewed.workflow.sequence-capability-v2')]);
			assert.strictEqual(recipes.getRecipe('reviewed.workflow.render'), undefined);
			assert.ok(recipes.getRecipe('reviewed.workflow.render-v2'));
			assert.strictEqual(recipes.getTemplate('reviewed.workflow.starter'), undefined);
			assert.ok(recipes.getTemplate('reviewed.workflow.starter-v2'));
			assert.strictEqual(projections.getProjection('reviewed.workflow.detail'), undefined);
			assert.ok(projections.getProjection('reviewed.workflow.detail-v2'));
			assert.strictEqual(agentCapabilities.getCapability('reviewed.workflow.sequence-capability'), undefined);
			assert.ok(agentCapabilities.getCapability('reviewed.workflow.sequence-capability-v2'));

			const updatedLocation = URI.file('/extensions/reviewed-workflow-updated');
			const secondInstalledContentSha256 = await hashBaseHalfPluginInstall(files, updatedLocation);
			recipePoint.acceptUsers([recipeUser('reviewed.workflow', '2.0.0', updatedLocation, 'reviewed.workflow.render-v3')]);
			templatePoint.acceptUsers([templateUser('reviewed.workflow', '2.0.0', updatedLocation, 'reviewed.workflow.starter-v3')]);
			projectionPoint.acceptUsers([projectionUser('reviewed.workflow', '2.0.0', updatedLocation, 'reviewed.workflow.detail-v3')]);
			agentCapabilityPoint.acceptUsers([agentCapabilityUser('reviewed.workflow', '2.0.0', updatedLocation, 'reviewed.workflow.sequence-capability-v3')]);
			assert.strictEqual(recipes.getRecipe('reviewed.workflow.render-v2'), undefined);
			assert.strictEqual(recipes.getTemplate('reviewed.workflow.starter-v2'), undefined);
			assert.strictEqual(projections.getProjection('reviewed.workflow.detail-v2'), undefined);
			assert.strictEqual(agentCapabilities.getCapability('reviewed.workflow.sequence-capability-v2'), undefined);

			const secondSha256 = 'b'.repeat(64);
			admission.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '2.0.0', sha256: secondSha256, installedContentSha256: secondInstalledContentSha256 }] }]);
			assert.strictEqual(recipes.getRecipe('reviewed.workflow.render-v3'), undefined);
			assert.ok(await admission.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '2.0.0', sha256: secondSha256, extensionLocation: updatedLocation, expectedInstalledContentSha256: secondInstalledContentSha256 }));
			assert.ok(recipes.getRecipe('reviewed.workflow.render-v3'));
			assert.ok(recipes.getTemplate('reviewed.workflow.starter-v3'));
			assert.ok(projections.getProjection('reviewed.workflow.detail-v3'));
			assert.ok(agentCapabilities.getCapability('reviewed.workflow.sequence-capability-v3'));

			admission.replaceVerifiedPlugins([]);
			assert.strictEqual(recipes.getRecipe('reviewed.workflow.render-v3'), undefined);
			assert.strictEqual(recipes.getTemplate('reviewed.workflow.starter-v3'), undefined);
			assert.strictEqual(projections.getProjection('reviewed.workflow.detail-v3'), undefined);
			assert.strictEqual(agentCapabilities.getCapability('reviewed.workflow.sequence-capability-v3'), undefined);

			admission.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '2.0.0', sha256: secondSha256, installedContentSha256: secondInstalledContentSha256 }] }]);
			assert.ok(recipes.getRecipe('reviewed.workflow.render-v3'));
			assert.ok(agentCapabilities.getCapability('reviewed.workflow.sequence-capability-v3'));
			recipePoint.acceptUsers([]);
			templatePoint.acceptUsers([]);
			projectionPoint.acceptUsers([]);
			agentCapabilityPoint.acceptUsers([]);
			assert.strictEqual(recipes.getRecipe('reviewed.workflow.render-v3'), undefined);
			assert.strictEqual(recipes.getTemplate('reviewed.workflow.starter-v3'), undefined);
			assert.strictEqual(projections.getProjection('reviewed.workflow.detail-v3'), undefined);
			assert.strictEqual(agentCapabilities.getCapability('reviewed.workflow.sequence-capability-v3'), undefined);
		} finally {
			recipePoint.acceptUsers([]);
			templatePoint.acceptUsers([]);
			projectionPoint.acceptUsers([]);
			agentCapabilityPoint.acceptUsers([]);
			agentCapabilityContribution.dispose();
			projectionContribution.dispose();
			recipeContribution.dispose();
			surfaces.dispose();
			projections.dispose();
			recipes.dispose();
			agentCapabilities.dispose();
			admission.dispose();
			storage.dispose();
		}
	});
});

function pluginFileService(): IFileService {
	return {
		onDidFilesChange: Event.None,
		stat: async (resource: URI) => ({ resource, name: resource.path.split('/').at(-1) ?? '', isDirectory: true, isFile: false, isSymbolicLink: false }),
		resolve: async (resource: URI) => ({
			resource,
			name: resource.path.split('/').at(-1) ?? '',
			isDirectory: true,
			isFile: false,
			isSymbolicLink: false,
			children: [{ resource: URI.joinPath(resource, 'package.json'), name: 'package.json', isDirectory: false, isFile: true, isSymbolicLink: false }]
		}),
		readFile: async (resource: URI) => ({ resource, value: VSBuffer.fromString('{"name":"test"}\n') })
	} as unknown as IFileService;
}

function extensionPoint<T>(name: string): ExtensionPoint<T> {
	const point = ExtensionsRegistry.getExtensionPoints().find(candidate => candidate.name === name);
	assert.ok(point, `Missing extension point '${name}'.`);
	return point as ExtensionPoint<T>;
}

function recipeUser(extensionId: string, version: string, location: URI, contributionId: string): IExtensionPointUser<IBaseHalfCanvasRecipeContribution[]> {
	const value: IBaseHalfCanvasRecipeContribution[] = [{
		id: contributionId,
		label: 'Render',
		outputs: [{ id: 'primary', kind: 'image', extensions: ['.png'], minItems: 1, maxItems: 1, primary: true }]
	}];
	return extensionPointUser(extensionId, version, location, value, { basehalfCanvasRecipes: value });
}

function templateUser(extensionId: string, version: string, location: URI, contributionId: string): IExtensionPointUser<IBaseHalfCanvasTemplateContribution[]> {
	const value: IBaseHalfCanvasTemplateContribution[] = [{ id: contributionId, label: 'Starter', resource: 'templates/starter.json' }];
	return extensionPointUser(extensionId, version, location, value, { basehalfCanvasTemplates: value });
}

function projectionUser(extensionId: string, version: string, location: URI, contributionId: string): IExtensionPointUser<ITestProjectionContribution[]> {
	const value: ITestProjectionContribution[] = [{ id: contributionId, label: 'Detail', extensions: ['.story-board'] }];
	return extensionPointUser(extensionId, version, location, value, { basehalfCardProjections: value });
}

function agentCapabilityUser(extensionId: string, version: string, location: URI, contributionId: string): IExtensionPointUser<IBaseHalfAgentCapabilityContribution[]> {
	const value: IBaseHalfAgentCapabilityContribution[] = [{
		id: contributionId,
		label: 'Sequence',
		documents: [{
			kind: `${extensionId}.sequence`,
			version: 1,
			fileExtensions: ['.json'],
			schemaSummary: 'A versioned root object with ordered items.'
		}]
	}];
	return extensionPointUser(extensionId, version, location, value, { basehalfAgentCapabilities: value });
}

function extensionPointUser<T>(extensionId: string, version: string, location: URI, value: T, contributes: Record<string, unknown>): IExtensionPointUser<T> {
	const description = {
		name: extensionId.split('.')[1],
		publisher: extensionId.split('.')[0],
		version,
		engines: { vscode: '*' },
		identifier: new ExtensionIdentifier(extensionId),
		targetPlatform: TargetPlatform.UNDEFINED,
		extensionLocation: location,
		isBuiltin: false,
		isUserBuiltin: false,
		isUnderDevelopment: false,
		preRelease: false,
		contributes: contributes as IExtensionDescription['contributes']
	};
	return {
		description,
		value,
		collector: new ExtensionMessageCollector(() => undefined, description, 'test')
	};
}
