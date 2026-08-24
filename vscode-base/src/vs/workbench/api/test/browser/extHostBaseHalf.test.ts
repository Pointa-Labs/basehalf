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
import { IBaseHalfCanvasNodeStateDto, IBaseHalfCanvasRecipeExecutionRequestDto, IBaseHalfExtensionIdentityDto, IBaseHalfModelServiceAttemptSnapshotDto, MainThreadBaseHalfShape, WebviewExtensionDescription } from '../../common/extHost.protocol.js';
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

		const execution = extHost.$executeCanvasRecipe('attempt-1', 'reviewed.workflow.render', executionRequest(), cancellation.token);
		let settled = false;
		void execution.then(() => { settled = true; }, () => { settled = true; });
		cancellation.cancel();
		await Promise.resolve();
		assert.strictEqual(settled, false);
		assert.ok(resolveExecutor);
		resolveExecutor({
			artifact: { id: 'late', outputId: 'primary', kind: 'image', resource: URI.file('/workspace/late.png') }
		});
		const result = await execution;
		assert.strictEqual(settled, true);
		assert.strictEqual(result.artifact.id, 'late');
	});

	test('sends host-derived extension identity for model service access', async () => {
		let received: IBaseHalfExtensionIdentityDto | undefined;
		let receivedSnapshot: IBaseHalfModelServiceAttemptSnapshotDto | undefined;
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $getModelServices(extensionIdentity: IBaseHalfExtensionIdentityDto): Promise<readonly never[]> {
				received = extensionIdentity;
				return Promise.resolve([]);
			}
			override $getModelServiceAccess(extensionIdentity: IBaseHalfExtensionIdentityDto, snapshot: IBaseHalfModelServiceAttemptSnapshotDto): Promise<undefined> {
				received = extensionIdentity;
				receivedSnapshot = snapshot;
				return Promise.resolve(undefined);
			}
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));

		await extHost.getModelServices(extension());
		const snapshot: vscode.basehalf.ModelServiceAttemptSnapshot = {
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

	test('registers and invokes an exact manifest-owned model provider validator', async () => {
		let registered: string | undefined;
		let requestSeen: vscode.basehalf.ModelProviderConnectionValidationRequest | undefined;
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $registerModelProviderConnectionValidator(_extension: WebviewExtensionDescription, specId: string): void { registered = specId; }
			override $unregisterModelProviderConnectionValidator(): void { }
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));
		disposables.add(extHost.registerModelProviderConnectionValidator(extension(), 'reviewed.workflow.provider', {
			validate: request => { requestSeen = request; }
		}));
		const request = {
			specId: 'reviewed.workflow.provider',
			endpoint: 'https://api.example.com',
			providerId: 'example',
			deploymentId: 'global',
			region: 'global',
			publicValues: {},
			credentialValues: { apiKey: 'secret' }
		};
		await extHost.$validateModelProviderConnection(request.specId, request, CancellationToken.None);
		assert.strictEqual(registered, request.specId);
		assert.deepStrictEqual(requestSeen, request);
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
					artifact: { id: 'image', outputId: 'primary', kind: 'image', resource: URI.file('/workspace/outputs/attempt-1/image.png') },
					providerRequestId: 'provider/request-1',
					usage: { inputTokens: 10, images: 1 },
					cost: { currency: 'USD', amount: '0.02', kind: 'actual' }
				});
			}
		}));

		const result = await extHost.$executeCanvasRecipe('attempt-1', 'reviewed.workflow.render', executionRequest(), CancellationToken.None);

		assert.strictEqual(requestSeen?.prompt, 'Render the reviewed image.');
		assert.deepStrictEqual(requestSeen?.modelService, executionRequest().modelService);
		assert.strictEqual(result.providerRequestId, 'provider/request-1');
		assert.deepStrictEqual(result.usage, { inputTokens: 10, images: 1 });
		assert.deepStrictEqual(result.cost, { currency: 'USD', amount: '0.02', kind: 'actual' });
	});

	test('rejects legacy result arrays and undeclared executor fields before RPC', async () => {
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $registerCanvasRecipeExecutor(): void { }
			override $unregisterCanvasRecipeExecutor(): void { }
			override $reportCanvasRecipeProgress(): void { }
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));
		const artifact = { id: 'image', outputId: 'primary', kind: 'image' as const, resource: URI.file('/workspace/outputs/attempt-1/image.png') };
		const legacy = extHost.registerCanvasRecipeExecutor(extension(), 'reviewed.workflow.render', {
			execute: () => Promise.resolve({ artifacts: [artifact], primaryArtifactId: artifact.id } as unknown as vscode.basehalf.CanvasRecipeExecutionResult)
		});
		await assert.rejects(
			() => extHost.$executeCanvasRecipe('attempt-1', 'reviewed.workflow.render', executionRequest(), CancellationToken.None),
			/returned no result/
		);
		legacy.dispose();

		disposables.add(extHost.registerCanvasRecipeExecutor(extension(), 'reviewed.workflow.render', {
			execute: () => Promise.resolve({ artifact, artifacts: [artifact], primaryArtifactId: artifact.id } as unknown as vscode.basehalf.CanvasRecipeExecutionResult)
		}));
		await assert.rejects(
			() => extHost.$executeCanvasRecipe('attempt-1', 'reviewed.workflow.render', executionRequest(), CancellationToken.None),
			/unsupported property 'artifacts'/
		);
	});

	test('rejects executor artifact ids that cannot be persisted in a node Result', async () => {
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $registerCanvasRecipeExecutor(): void { }
			override $unregisterCanvasRecipeExecutor(): void { }
			override $reportCanvasRecipeProgress(): void { }
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));
		let artifactId: unknown = 'image';
		const registration = extHost.registerCanvasRecipeExecutor(extension(), 'reviewed.workflow.render', {
			execute: () => Promise.resolve({
				artifact: { id: artifactId as string, outputId: 'primary', kind: 'image', resource: URI.file('/workspace/outputs/attempt-1/image.png') }
			})
		});
		try {
			for (const invalidId of ['image/frame', 'image frame', '-image', `image${'x'.repeat(124)}`, 1, ' \t ']) {
				artifactId = invalidId;
				await assert.rejects(
					() => extHost.$executeCanvasRecipe('attempt-1', 'reviewed.workflow.render', executionRequest(), CancellationToken.None),
					/reviewed\.workflow\.render\.artifact\.id (contains unsupported characters|is too long|must be a string|cannot be empty)/
				);
			}
		} finally {
			registration.dispose();
		}
	});

	test('revives an inspected canvas Result and immutable Attempts', async () => {
		let receivedIdentity: IBaseHalfExtensionIdentityDto | undefined;
		let receivedResource: URI | undefined;
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $inspectCanvasNode(extensionIdentity: IBaseHalfExtensionIdentityDto, resource: UriComponents): Promise<IBaseHalfCanvasNodeStateDto> {
				receivedIdentity = extensionIdentity;
				receivedResource = URI.revive(resource);
				return Promise.resolve({
					id: 'clip-node',
					kind: 'video',
					lifecycle: 'result',
					result: {
						source: 'attempt',
						attemptId: 'run-2',
						artifact: {
							id: 'clip',
							outputId: 'video',
							kind: 'video',
							resource: URI.file('/workspace/outputs/clip.mp4'),
							integrity: 'available'
						}
					},
					attempts: [{
						id: 'run-2',
						status: 'succeeded',
						createdAt: '2026-07-18T12:00:00Z',
						startedAt: '2026-07-18T12:00:01Z',
						completedAt: '2026-07-18T12:00:06Z',
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
						cost: { currency: 'USD', amount: '0.2', kind: 'actual' }
					}]
				});
			}
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));

		const state = await extHost.inspectCanvasNode(extension(), URI.file('/workspace/clip.bhnode'));

		assert.strictEqual(receivedIdentity?.id.value, 'reviewed.workflow');
		assert.strictEqual(receivedIdentity?.version, '1.2.3');
		assert.strictEqual(receivedResource?.path, '/workspace/clip.bhnode');
		assert.strictEqual(state?.id, 'clip-node');
		assert.strictEqual(state?.lifecycle, 'result');
		assert.strictEqual(state?.result?.artifact.resource.path, '/workspace/outputs/clip.mp4');
		assert.strictEqual(state?.result?.artifact.integrity, 'available');
		assert.strictEqual(state?.attempts[0].model?.source, 'service');
		assert.strictEqual(state?.attempts[0].providerRequestId, 'provider/request-2');
		assert.deepStrictEqual(state?.attempts[0].usage, { videoSeconds: 5 });
		assert.deepStrictEqual(state?.attempts[0].cost, { currency: 'USD', amount: '0.2', kind: 'actual' });
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
			basehalfCanvasRecipes: [{ id: 'reviewed.workflow.render' }],
			basehalfModelProviderCatalogs: [{ id: 'reviewed.workflow.providers', resource: 'models/providers.json' }]
		} as IExtensionDescription['contributes']
	};
}

function executionRequest(): IBaseHalfCanvasRecipeExecutionRequestDto {
	return {
		attemptId: 'attempt-1',
		workspaceFolder: URI.file('/workspace'),
		node: { id: 'node-1', path: 'image.bhnode', kind: 'image' },
		recipeId: 'reviewed.workflow.render',
		prompt: 'Render the reviewed image.',
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
		outputDirectory: URI.file('/workspace/outputs/attempt-1')
	};
}
