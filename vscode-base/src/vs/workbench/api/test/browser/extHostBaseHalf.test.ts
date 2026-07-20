/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ExtensionIdentifier, IExtensionDescription, TargetPlatform } from '../../../../platform/extensions/common/extensions.js';
import { ExtHostBaseHalf } from '../../common/extHostBaseHalf.js';
import { IBaseHalfCanvasNodeStateDto, IBaseHalfCanvasRecipeExecutionRequestDto, IBaseHalfExtensionIdentityDto, IBaseHalfModelServiceRunSnapshotDto, MainThreadBaseHalfShape } from '../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';
import type * as vscode from 'vscode';

suite('ExtHostBaseHalf', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('waits for a non-cooperative executor to settle after cancellation', async () => {
		let resolveExecutor: ((result: vscode.basehalf.CanvasRecipeExecutionResult) => void) | undefined;
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $registerCanvasRecipeExecutor(): void { }
			override $unregisterCanvasRecipeExecutor(): void { }
			override $reportCanvasRecipeProgress(): void { }
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));
		disposables.add(extHost.registerCanvasRecipeExecutor(extension(), 'reviewed.workflow.render', {
			execute: () => new Promise(resolve => { resolveExecutor = resolve; })
		}));
		const cancellation = disposables.add(new CancellationTokenSource());

		const execution = extHost.$executeCanvasRecipe('run-1', 'reviewed.workflow.render', executionRequest(), cancellation.token);
		let settled = false;
		void execution.then(() => { settled = true; }, () => { settled = true; });
		cancellation.cancel();
		await Promise.resolve();
		assert.strictEqual(settled, false);
		assert.ok(resolveExecutor);
		resolveExecutor({
			artifacts: [{ id: 'late', outputId: 'primary', kind: 'image', resource: URI.file('/workspace/late.png') }],
			primaryArtifactId: 'late'
		});
		const result = await execution;
		assert.strictEqual(settled, true);
		assert.strictEqual(result.primaryArtifactId, 'late');
	});

	test('sends host-derived extension identity for model service access', async () => {
		let received: IBaseHalfExtensionIdentityDto | undefined;
		let receivedSnapshot: IBaseHalfModelServiceRunSnapshotDto | undefined;
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $getModelServices(extensionIdentity: IBaseHalfExtensionIdentityDto): Promise<readonly never[]> {
				received = extensionIdentity;
				return Promise.resolve([]);
			}
			override $getModelServiceAccess(extensionIdentity: IBaseHalfExtensionIdentityDto, snapshot: IBaseHalfModelServiceRunSnapshotDto): Promise<undefined> {
				received = extensionIdentity;
				receivedSnapshot = snapshot;
				return Promise.resolve(undefined);
			}
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));

		await extHost.getModelServices(extension());
		const snapshot: vscode.basehalf.ModelServiceRunSnapshot = {
			serviceId: 'studio.image',
			serviceLabel: 'Studio image',
			connectionIdentity: `sha256:${'A'.repeat(43)}`,
			capability: 'image',
			modelId: 'image-v2'
		};
		await extHost.getModelServiceAccess(extension(), snapshot);

		assert.strictEqual(received?.id.value, 'reviewed.workflow');
		assert.strictEqual(received?.version, '1.2.3');
		assert.strictEqual(URI.revive(received?.location).path, '/extensions/reviewed-workflow');
		assert.strictEqual(received?.isBuiltin, false);
		assert.strictEqual(received?.isUnderDevelopment, false);
		assert.deepStrictEqual(receivedSnapshot, snapshot);
	});

	test('revives a frozen model snapshot and returns structured execution disclosures', async () => {
		let requestSeen: vscode.basehalf.CanvasRecipeExecutionRequest | undefined;
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $registerCanvasRecipeExecutor(): void { }
			override $unregisterCanvasRecipeExecutor(): void { }
			override $reportCanvasRecipeProgress(): void { }
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));
		disposables.add(extHost.registerCanvasRecipeExecutor(extension(), 'reviewed.workflow.render', {
			execute: request => {
				requestSeen = request;
				return Promise.resolve({
					artifacts: [{ id: 'image', outputId: 'primary', kind: 'image', resource: URI.file('/workspace/outputs/run-1/image.png') }],
					primaryArtifactId: 'image',
					providerRequestId: 'provider/request-1',
					usage: { inputTokens: 10, images: 1 },
					cost: { currency: 'USD', amount: '0.02', kind: 'actual' }
				});
			}
		}));

		const result = await extHost.$executeCanvasRecipe('run-1', 'reviewed.workflow.render', executionRequest(), CancellationToken.None);

		assert.deepStrictEqual(requestSeen?.modelService, executionRequest().modelService);
		assert.strictEqual(result.providerRequestId, 'provider/request-1');
		assert.deepStrictEqual(result.usage, { inputTokens: 10, images: 1 });
		assert.deepStrictEqual(result.cost, { currency: 'USD', amount: '0.02', kind: 'actual' });
	});

	test('revives inspected canvas node versions and artifact resources', async () => {
		let receivedIdentity: IBaseHalfExtensionIdentityDto | undefined;
		let receivedResource: URI | undefined;
		let receivedOptions: vscode.basehalf.CanvasNodeInspectOptions | undefined;
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $inspectCanvasNode(extensionIdentity: IBaseHalfExtensionIdentityDto, resource: UriComponents, options?: vscode.basehalf.CanvasNodeInspectOptions): Promise<IBaseHalfCanvasNodeStateDto> {
				receivedIdentity = extensionIdentity;
				receivedResource = URI.revive(resource);
				receivedOptions = options;
				return Promise.resolve({
					id: 'clip-node',
					kind: 'video',
					currentVersionId: 'run-2',
					versions: [{
						id: 'run-2',
						status: 'succeeded',
						createdAt: '2026-07-18T12:00:00Z',
						model: {
							source: 'service',
							connection: 'resolved',
							serviceId: 'studio.video',
							serviceLabel: 'Studio video',
							connectionIdentity: `sha256:${'A'.repeat(43)}`,
							capability: 'video',
							modelId: 'video-v2'
						},
						providerRequestId: 'provider/request-2',
						usage: { videoSeconds: 5 },
						cost: { currency: 'USD', amount: '0.2', kind: 'actual' },
						primaryArtifact: {
							id: 'clip',
							kind: 'video',
							resource: URI.file('/workspace/outputs/clip.mp4'),
							integrity: 'available'
						}
					}]
				});
			}
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));

		const state = await extHost.inspectCanvasNode(extension(), URI.file('/workspace/clip.bhnode'), {
			versionIds: ['run-1'], includeCurrent: true
		});

		assert.strictEqual(receivedIdentity?.id.value, 'reviewed.workflow');
		assert.strictEqual(receivedIdentity?.version, '1.2.3');
		assert.strictEqual(receivedResource?.path, '/workspace/clip.bhnode');
		assert.deepStrictEqual(receivedOptions, { versionIds: ['run-1'], includeCurrent: true });
		assert.strictEqual(state?.id, 'clip-node');
		assert.strictEqual(state?.currentVersionId, 'run-2');
		assert.strictEqual(state?.versions[0].primaryArtifact?.resource.path, '/workspace/outputs/clip.mp4');
		assert.strictEqual(state?.versions[0].primaryArtifact?.integrity, 'available');
		assert.strictEqual(state?.versions[0].model?.source, 'service');
		assert.strictEqual(state?.versions[0].providerRequestId, 'provider/request-2');
		assert.deepStrictEqual(state?.versions[0].usage, { videoSeconds: 5 });
		assert.deepStrictEqual(state?.versions[0].cost, { currency: 'USD', amount: '0.2', kind: 'actual' });
	});

	test('registers one structural cleanup provider and serializes exact transitions', async () => {
		let registered: IBaseHalfExtensionIdentityDto | undefined;
		let unregistered: string | undefined;
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $registerCanvasStructuralCleanupProvider(identity: IBaseHalfExtensionIdentityDto): void { registered = identity; }
			override $unregisterCanvasStructuralCleanupProvider(extensionId: string): void { unregistered = extensionId; }
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));
		const registration = extHost.registerCanvasStructuralCleanupProvider(extension(), {
			prepareDelete: resource => [{
				resource: URI.file('/workspace/sequence.json'),
				expected: new TextEncoder().encode(resource.path),
				next: new TextEncoder().encode('next'),
				label: 'Remove membership'
			}]
		});
		assert.strictEqual(registered?.id.value, 'reviewed.workflow');
		const transitions = await extHost.$prepareCanvasStructuralCleanup(
			'reviewed.workflow',
			URI.file('/workspace/clip.bhnode'),
			CancellationToken.None
		);
		assert.strictEqual(transitions.length, 1);
		assert.strictEqual(transitions[0].expected.toString(), '/workspace/clip.bhnode');
		assert.strictEqual(transitions[0].next.toString(), 'next');
		registration.dispose();
		assert.strictEqual(unregistered, 'reviewed.workflow');
	});
});

function extension(): IExtensionDescription {
	return {
		name: 'workflow',
		publisher: 'reviewed',
		version: '1.2.3',
		engines: { vscode: '*' },
		identifier: new ExtensionIdentifier('reviewed.workflow'),
		targetPlatform: TargetPlatform.UNDEFINED,
		extensionLocation: URI.file('/extensions/reviewed-workflow'),
		isBuiltin: false,
		isUserBuiltin: false,
		isUnderDevelopment: false,
		preRelease: false,
		contributes: {
			basehalfCanvasRecipes: [{ id: 'reviewed.workflow.render' }]
		} as IExtensionDescription['contributes']
	};
}

function executionRequest(): IBaseHalfCanvasRecipeExecutionRequestDto {
	return {
		runId: 'run-1',
		workspaceFolder: URI.file('/workspace'),
		node: { id: 'node-1', path: 'image.bhnode', kind: 'image' },
		recipeId: 'reviewed.workflow.render',
		parameters: {},
		modelServiceId: 'studio.image',
		modelService: {
			serviceId: 'studio.image',
			serviceLabel: 'Studio image',
			connectionIdentity: `sha256:${'A'.repeat(43)}`,
			capability: 'image',
			modelId: 'image-v2'
		},
		inputs: [],
		outputDirectory: URI.file('/workspace/outputs/run-1')
	};
}
