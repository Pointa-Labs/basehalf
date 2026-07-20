/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IChecksumService } from '../../../../platform/checksum/common/checksumService.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { FileOperation, FileSystemProviderCapabilities, FileType, IFileService, IStat } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { TestExtensionService } from '../../../test/common/workbenchTestServices.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import {
	BASEHALF_NODE_IDENTITY_SCAN_MAX_DEPTH,
	BASEHALF_NODE_IDENTITY_SCAN_MAX_ENTRIES,
	BaseHalfNodeExecutionService,
	baseHalfAssertUniqueNodeIdentity,
	baseHalfNodeImportedAssetDirectory,
	baseHalfSafeExecutionErrorMessage
} from '../../browser/basehalfNodeExecutionService.js';
import { baseHalfNodeRunLeaseResource } from '../../browser/basehalfNodeRunLease.js';
import { IBaseHalfBadgeGraphService } from '../../common/basehalfBadgeGraph.js';
import { IBaseHalfBadgeFile } from '../../common/basehalfBadgeMirror.js';
import {
	BaseHalfCanvasRecipeRegistryService,
	BaseHalfCanvasRecipeRuntimeService,
	IBaseHalfCanvasRecipeContribution,
	IBaseHalfCanvasRecipeExecutionRequest,
	IBaseHalfCanvasRecipeRuntimeProvider
} from '../../common/basehalfCanvasRecipes.js';
import { IBaseHalfWorkspaceResource } from '../../common/basehalfCanvasNavigation.js';
import { BaseHalfModelCapability, IBaseHalfModelServiceDescriptor, IBaseHalfModelServiceService } from '../../common/basehalfModelServices.js';
import {
	createBaseHalfNodeDocument,
	beginBaseHalfNodeRun,
	completeBaseHalfNodeRun,
	failBaseHalfNodeRun,
	getBaseHalfNodeCurrentPrimaryArtifact,
	IBaseHalfNodeDocument,
	importBaseHalfNodeCurrent,
	serializeBaseHalfNodeDocument
} from '../../common/basehalfNodeDocument.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';

suite('BaseHalfNodeExecutionService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const frameNodeId = baseHalfNodeTestId(1);
	const sourceNodeId = baseHalfNodeTestId(2);

	test('persists only a bounded actionable summary of execution errors', () => {
		const secret = 'sensitive-value-that-must-never-be-persisted';
		const jwt = `${'a'.repeat(16)}.${'b'.repeat(16)}.${'c'.repeat(16)}`;
		const safe = baseHalfSafeExecutionErrorMessage(new Error(
			`Request rejected\u0000\nhttps://api.example.invalid/v1/render?api_key=${secret} Authorization: Bearer ${secret} password=${secret} ${jwt} sk-live-${'z'.repeat(32)}`
		));

		assert.match(safe, /^Request rejected/);
		assert.ok(safe.length <= 1024);
		assert.strictEqual(/[\u0000-\u001F\u007F-\u009F]/.test(safe), false);
		assert.strictEqual(safe.includes('api.example.invalid'), false);
		assert.strictEqual(safe.includes(secret), false);
		assert.strictEqual(safe.includes(jwt), false);
		assert.strictEqual(safe.includes('sk-live-'), false);
		assert.match(safe, /\[redacted/);
		assert.strictEqual(baseHalfSafeExecutionErrorMessage(new Error('Quota exhausted. Try again later.')), 'Quota exhausted. Try again later.');
	});

	test('rejects duplicate node identities before execution regardless of scan order', async () => {
		for (const [targetPath, duplicatePath] of [
			['a/frame.bhnode', 'z/copy.bhnode'],
			['z/frame.bhnode', 'a/copy.bhnode']
		] as const) {
			const harness = await createHarness(imageRecipe());
			try {
				const target = nodeDocument('frame', 'image', imageRecipe().id);
				await harness.writeNode(targetPath, target);
				await harness.writeNode(duplicatePath, createBaseHalfNodeDocument({
					...target,
					title: 'Accidental copy'
				}));
				let executorCalls = 0;
				harness.registerExecutor(async () => {
					executorCalls++;
					throw new Error('The executor must not start for a duplicated identity.');
				});

				await assert.rejects(
					() => harness.service.run(harness.node(targetPath)),
					/Node identity conflict:.*Remove the accidental copy or recreate it with Duplicate/
				);
				assert.strictEqual(executorCalls, 0);
				assert.strictEqual(await harness.fileService.exists(harness.resource(`outputs/${target.id}`)), false);
				assert.deepStrictEqual((JSON.parse(await harness.read(targetPath)) as IBaseHalfNodeDocument).runs, []);
				assert.strictEqual(await harness.fileService.exists(baseHalfNodeRunLeaseResource(harness.workspaceFolder, target.id)), false);
			} finally {
				await harness.dispose();
			}
		}
	});

	test('treats valid node files in assets and ordinary output paths as identity conflicts', async () => {
		for (const duplicatePath of [
			`assets/${frameNodeId}/copy.bhnode`,
			`outputs/${frameNodeId}/${baseHalfNodeTestId(8)}/artifacts/copy.bhnode`,
			`outputs/${frameNodeId}/${baseHalfNodeTestId(9)}/inputs/node.bhnode`
		]) {
			const harness = await createHarness(imageRecipe());
			try {
				const target = nodeDocument('frame', 'image', imageRecipe().id);
				await harness.writeNode('frame.bhnode', target);
				await harness.writeNode(duplicatePath, createBaseHalfNodeDocument({
					...target,
					title: 'Conflicting node'
				}));

				await assert.rejects(
					() => harness.service.run(harness.node('frame.bhnode')),
					/Node identity conflict/
				);
				assert.strictEqual(await harness.fileService.exists(baseHalfNodeRunLeaseResource(harness.workspaceFolder, target.id)), false);
			} finally {
				await harness.dispose();
			}
		}
	});

	test('rejects duplicate node identities before recovery, History changes, or import writes', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.write('assets/existing/frame.png', 'history-image');
			await harness.writeExternal('replacement.png', 'replacement-image');
			const revision = {
				id: 'revision-1',
				source: 'imported' as const,
				createdAt: '2026-07-19T00:00:00Z',
				artifacts: [{
					id: 'artifact-1',
					outputId: 'imported',
					kind: 'image' as const,
					path: 'assets/existing/frame.png',
					sha256: await sha256('history-image'),
					size: 13
				}],
				primaryArtifactId: 'artifact-1'
			};
			let target = createBaseHalfNodeDocument({
				id: frameNodeId,
				kind: 'image',
				title: 'Frame',
				role: 'result',
				recipe: { recipeId: imageRecipe().id, parameters: {}, inputBindings: [] },
				revisions: [revision]
			});
			target = beginBaseHalfNodeRun(target, {
				id: 'interrupted-run',
				createdAt: '2026-07-19T00:01:00Z',
				startedAt: '2026-07-19T00:01:00Z',
				model: { source: 'local' },
				inputs: []
			});
			await harness.writeNode('frame.bhnode', target);
			await harness.writeNode('copies/frame.bhnode', createBaseHalfNodeDocument({
				...target,
				title: 'Copy'
			}));
			const expected = VSBuffer.fromString(serializeBaseHalfNodeDocument(target));
			const next = VSBuffer.fromString(serializeBaseHalfNodeDocument({
				...target,
				current: { source: 'imported', revisionId: revision.id, outputPaths: [revision.artifacts[0].path] }
			}));
			const importTarget = URI.joinPath(baseHalfNodeImportedAssetDirectory(harness.workspaceFolder, frameNodeId), 'replacement.png');

			await assert.rejects(() => harness.service.recoverInterrupted(harness.node('frame.bhnode')), /Node identity conflict/);
			await assert.rejects(() => harness.service.selectCurrent(harness.node('frame.bhnode'), revision.id), /Node identity conflict/);
			await assert.rejects(() => harness.service.transitionCurrent(harness.node('frame.bhnode'), expected, next), /Node identity conflict/);
			await assert.rejects(() => harness.service.copyImportedRevision(
				harness.workspaceFolder,
				harness.external('replacement.png'),
				importTarget,
				'image'
			), /Node identity conflict/);

			assert.strictEqual(await harness.fileService.exists(importTarget), false);
			assert.strictEqual(await harness.fileService.exists(baseHalfNodeRunLeaseResource(harness.workspaceFolder, frameNodeId)), false);
			assert.strictEqual(await harness.read('frame.bhnode'), expected.toString());
		} finally {
			await harness.dispose();
		}
	});

	test('bounds fresh identity scans by workspace entries and folder depth', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			const target = nodeDocument('frame', 'image', imageRecipe().id);
			await harness.writeNode('frame.bhnode', target);
			await harness.writeNode('.bh/derived-copy.bhnode', createBaseHalfNodeDocument({ ...target, title: 'Derived cache copy' }));
			await harness.writeNode('linked-copy.bhnode', createBaseHalfNodeDocument({ ...target, title: 'Linked copy' }));
			harness.fileSystemProvider.markSymbolicLink(harness.resource('linked-copy.bhnode'), harness.external('outside.bhnode'));
			await baseHalfAssertUniqueNodeIdentity(harness.fileService, harness.node('frame.bhnode'), frameNodeId);
			await harness.write('note.md', 'ordinary content');
			assert.strictEqual(BASEHALF_NODE_IDENTITY_SCAN_MAX_ENTRIES, 100_000);
			assert.strictEqual(BASEHALF_NODE_IDENTITY_SCAN_MAX_DEPTH, 512);
			await assert.rejects(
				() => baseHalfAssertUniqueNodeIdentity(harness.fileService, harness.node('frame.bhnode'), frameNodeId, { maxEntries: 1 }),
				/more than 1 entries/
			);

			await harness.fileService.createFolder(harness.resource('one/two'));
			await assert.rejects(
				() => baseHalfAssertUniqueNodeIdentity(harness.fileService, harness.node('frame.bhnode'), frameNodeId, { maxDepth: 1 }),
				/nested more than 1 folders deep/
			);
		} finally {
			await harness.dispose();
		}
	});

	test('redacts provider secrets before the failed run is written to the node', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			const secret = 'private-provider-credential-1234567890';
			harness.registerExecutor(async () => {
				throw new Error(`Provider rejected the request at https://api.example.invalid/run?token=${secret}; Authorization: Bearer ${secret}`);
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /^Provider rejected the request/);
			const persisted = await harness.read('frame.bhnode');
			assert.strictEqual(persisted.includes(secret), false);
			assert.strictEqual(persisted.includes('api.example.invalid'), false);
		} finally {
			await harness.dispose();
		}
	});

	test('freezes direct inputs before execution and records verified artifact identity', async () => {
		const harness = await createHarness(imageRecipe(), [{ source: 'brief.md', target: 'frame.bhnode' }]);
		try {
			await harness.write('brief.md', 'before');
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id, [
					{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }
				]));

			let requestSeen: IBaseHalfCanvasRecipeExecutionRequest | undefined;
			let frozenText: string | undefined;
			let frozenDeclaration: IBaseHalfNodeDocument | undefined;
			harness.registerExecutor(async request => {
				requestSeen = request;
				frozenDeclaration = JSON.parse((await harness.fileService.readFile(request.node.resource!)).value.toString()) as IBaseHalfNodeDocument;
				await harness.write('brief.md', 'after');
				frozenText = (await harness.fileService.readFile(request.inputs[0].source.current!.resource)).value.toString();
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('verified-image'), { overwrite: false });
				return {
					artifacts: [{ id: 'frame', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'frame',
					providerRequestId: 'request-1'
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			const run = result.runs[0];
			const primary = getBaseHalfNodeCurrentPrimaryArtifact(result);

			assert.ok(requestSeen);
			const frozenNodeResource = requestSeen.node.resource;
			assert.ok(frozenNodeResource);
			assert.notStrictEqual(requestSeen.inputs[0].source.resource?.toString(), harness.resource('brief.md').toString());
			assert.strictEqual(requestSeen.inputs[0].source.resource?.toString(), requestSeen.inputs[0].source.current?.resource.toString());
			assert.notStrictEqual(requestSeen.inputs[0].source.current?.resource.toString(), harness.resource('brief.md').toString());
			assert.match(requestSeen.inputs[0].source.current!.resource.path, new RegExp(`/outputs/${frameNodeId}/.+/inputs/000-brief\\.md$`));
			assert.notStrictEqual(frozenNodeResource.toString(), harness.resource('frame.bhnode').toString());
			assert.match(frozenNodeResource.path, new RegExp(`/outputs/${frameNodeId}/.+/inputs/node\\.bhnode$`));
			assert.strictEqual(requestSeen.node.current, undefined);
			assert.deepStrictEqual(frozenDeclaration?.current, { source: 'empty', outputPaths: [] });
			assert.deepStrictEqual(frozenDeclaration?.runs, []);
			assert.strictEqual(JSON.stringify(frozenDeclaration).includes('previous.png'), false);
			assert.strictEqual(frozenText, 'before');
			assert.strictEqual(await harness.read('brief.md'), 'after');
			assert.strictEqual(run.status, 'succeeded');
			assert.match(run.inputs[0].revision, /^v1;source=[A-Za-z0-9_-]{43};sha256=[A-Za-z0-9_-]{43}$/);
			assert.strictEqual(run.primaryArtifactId, 'frame');
			assert.strictEqual(run.providerRequestId, 'request-1');
			const expectedArtifactHash = await sha256('verified-image');
			assert.deepStrictEqual(primary, {
				id: 'frame',
				outputId: 'result',
				kind: 'image',
				path: `outputs/${frameNodeId}/${run.id}/artifacts/frame.png`,
				sha256: expectedArtifactHash,
				size: 14
			});
			assert.strictEqual(await harness.read(`outputs/${frameNodeId}/${run.id}/inputs/000-brief.md`), 'before');
		} finally {
			await harness.dispose();
		}
	});

	test('freezes a resolved service and explicit model before execution without rewriting older runs', async () => {
		const recipe = externalImageRecipe();
		const service = modelService('studio.image', 'Studio image', 'A');
		const harness = await createHarness(recipe, [], [service]);
		try {
			await harness.writeNode('frame.bhnode', createBaseHalfNodeDocument({
				id: frameNodeId,
				kind: 'image',
				title: 'frame',
				role: 'result',
				recipe: { recipeId: recipe.id, modelServiceId: service.id, modelId: 'image-v2', parameters: {}, inputBindings: [] }
			}));
			let failNext = false;
			harness.registerExecutor(async request => {
				assert.deepStrictEqual(request.modelService, {
					serviceId: service.id,
					serviceLabel: service.label,
					connectionIdentity: service.connectionIdentity,
					capability: 'image',
					modelId: failNext ? 'image-v3' : 'image-v2'
				});
				if (failNext) {
					throw new Error('Provider request failed.');
				}
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('generated-image'), { overwrite: false });
				return {
					artifacts: [{ id: 'frame', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'frame',
					providerRequestId: 'provider/request-1',
					usage: { inputTokens: 24, outputTokens: 3, images: 1 },
					cost: { currency: 'USD', amount: '0.04', kind: 'actual' }
				};
			});

			const first = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual(first.runs[0].model, {
				source: 'service',
				connection: 'resolved',
				serviceId: service.id,
				serviceLabel: service.label,
				connectionIdentity: service.connectionIdentity,
				capability: 'image',
				modelId: 'image-v2'
			});
			assert.strictEqual(first.runs[0].providerRequestId, 'provider/request-1');
			assert.deepStrictEqual(first.runs[0].usage, { inputTokens: 24, outputTokens: 3, images: 1 });
			assert.deepStrictEqual(first.runs[0].cost, { currency: 'USD', amount: '0.04', kind: 'actual' });

			await harness.writeNode('frame.bhnode', createBaseHalfNodeDocument({
				...first,
				recipe: { ...first.recipe!, modelId: 'image-v3' }
			}));
			failNext = true;
			const second = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(second.runs[1].status, 'failed');
			assert.deepStrictEqual(second.runs[1].model, {
				source: 'service',
				connection: 'resolved',
				serviceId: service.id,
				serviceLabel: service.label,
				connectionIdentity: service.connectionIdentity,
				capability: 'image',
				modelId: 'image-v3'
			});
			assert.deepStrictEqual(second.current, first.current);
			assert.deepStrictEqual(second.runs[0], first.runs[0]);

			harness.setModelServices([modelService('studio.image', 'Renamed image', 'B')]);
			const persisted = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.deepStrictEqual(persisted.runs[0].model, first.runs[0].model);
			assert.deepStrictEqual(persisted.runs[1].model, second.runs[1].model);
		} finally {
			await harness.dispose();
		}
	});

	test('records an unavailable selected model service as a failed immutable attempt', async () => {
		const recipe = externalImageRecipe();
		const harness = await createHarness(recipe);
		try {
			await harness.fileService.createFolder(harness.resource('assets/frame'));
			await harness.write('assets/frame/previous.png', 'previous');
			const initial = importBaseHalfNodeCurrent(createBaseHalfNodeDocument({
				id: frameNodeId,
				kind: 'image',
				title: 'frame',
				role: 'result',
				recipe: { recipeId: recipe.id, modelServiceId: 'studio.image', modelId: 'image-v2', parameters: {}, inputBindings: [] }
			}), {
				id: 'previous-revision',
				source: 'imported',
				createdAt: '2026-07-18T10:00:00Z',
				artifacts: [{
					id: 'previous-artifact', outputId: 'imported', kind: 'image',
					path: 'assets/frame/previous.png', sha256: await sha256('previous'), size: 8
				}],
				primaryArtifactId: 'previous-artifact'
			});
			await harness.writeNode('frame.bhnode', initial);
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(executed, false);
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /is unavailable/);
			assert.deepStrictEqual(result.runs[0].model, {
				source: 'service',
				connection: 'unavailable',
				serviceId: 'studio.image',
				capability: 'image',
				modelId: 'image-v2'
			});
			assert.deepStrictEqual(result.current, initial.current);
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('records a selected model service without a key as a failed immutable attempt', async () => {
		const recipe = externalImageRecipe();
		const service = { ...modelService('studio.image', 'Studio image', 'A'), configured: false };
		const harness = await createHarness(recipe, [], [service]);
		try {
			await harness.writeNode('frame.bhnode', createBaseHalfNodeDocument({
				id: frameNodeId,
				kind: 'image',
				title: 'frame',
				role: 'result',
				recipe: { recipeId: recipe.id, modelServiceId: service.id, modelId: 'image-v2', parameters: {}, inputBindings: [] }
			}));
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(executed, false);
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /needs an API key/);
			assert.deepStrictEqual(result.runs[0].model, {
				source: 'service',
				connection: 'resolved',
				serviceId: service.id,
				serviceLabel: service.label,
				connectionIdentity: service.connectionIdentity,
				capability: 'image',
				modelId: 'image-v2'
			});
			assert.deepStrictEqual(result.current, { source: 'empty', outputPaths: [] });
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('persists the attempt before model lookup and cancels without waiting for lookup', async () => {
		const recipe = externalImageRecipe();
		const service = modelService('studio.image', 'Studio image', 'A');
		const harness = await createHarness(recipe, [], [service]);
		let releaseModelLookup: (() => void) | undefined;
		try {
			await harness.writeNode('frame.bhnode', createBaseHalfNodeDocument({
				id: frameNodeId,
				kind: 'image',
				title: 'frame',
				role: 'result',
				recipe: { recipeId: recipe.id, modelServiceId: service.id, modelId: 'image-v2', parameters: {}, inputBindings: [] }
			}));
			let didStartLookup!: () => void;
			const lookupStarted = new Promise<void>(resolve => { didStartLookup = resolve; });
			const lookupReleased = new Promise<void>(resolve => { releaseModelLookup = resolve; });
			harness.setModelServicesHandler(async capability => {
				assert.strictEqual(capability, 'image');
				didStartLookup();
				await lookupReleased;
				return [service];
			});
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});

			const execution = harness.service.run(harness.node('frame.bhnode'));
			await lookupStarted;
			const persistedRunning = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.strictEqual(persistedRunning.runs[0].status, 'running');
			assert.deepStrictEqual(persistedRunning.runs[0].model, {
				source: 'service', connection: 'unavailable', serviceId: service.id,
				capability: 'image', modelId: 'image-v2'
			});
			const activeRun = harness.service.getActiveRun(harness.resource('frame.bhnode'));
			assert.ok(activeRun);
			assert.strictEqual(harness.service.cancel(harness.resource('frame.bhnode'), activeRun.runId), true);

			const result = await execution;
			assert.strictEqual(executed, false);
			assert.strictEqual(result.runs[0].status, 'cancelled');
			assert.deepStrictEqual(result.runs[0].model, persistedRunning.runs[0].model);
			assert.deepStrictEqual(result.current, { source: 'empty', outputPaths: [] });
			releaseModelLookup!();
			releaseModelLookup = undefined;
		} finally {
			releaseModelLookup?.();
			await harness.dispose();
		}
	});

	test('records extension activation failure before executor lookup as a failed attempt', async () => {
		const recipe = imageRecipe();
		const harness = await createHarness(recipe);
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', recipe.id));
			harness.setActivationHandler(async activationEvent => {
				assert.strictEqual(activationEvent, `onBaseHalfCanvasRecipe:${recipe.id}`);
				throw new Error('Extension activation failed.');
			});
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(executed, false);
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /Extension activation failed/);
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.deepStrictEqual(result.current, { source: 'empty', outputPaths: [] });
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('records an unavailable executor after activation as a failed attempt', async () => {
		const recipe = imageRecipe();
		const harness = await createHarness(recipe);
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', recipe.id));

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /executor is unavailable/);
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.deepStrictEqual(result.current, { source: 'empty', outputPaths: [] });
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('records cancellation while extension activation is pending and preserves Current', async () => {
		const recipe = imageRecipe();
		const harness = await createHarness(recipe);
		let releaseActivation: (() => void) | undefined;
		try {
			await harness.fileService.createFolder(harness.resource('assets/frame'));
			await harness.write('assets/frame/previous.png', 'previous');
			const initial = importBaseHalfNodeCurrent(nodeDocument('frame', 'image', recipe.id), {
				id: 'previous-revision',
				source: 'imported',
				createdAt: '2026-07-18T10:00:00Z',
				artifacts: [{
					id: 'previous-artifact', outputId: 'imported', kind: 'image',
					path: 'assets/frame/previous.png', sha256: await sha256('previous'), size: 8
				}],
				primaryArtifactId: 'previous-artifact'
			});
			await harness.writeNode('frame.bhnode', initial);
			let didActivate!: () => void;
			const activationStarted = new Promise<void>(resolve => { didActivate = resolve; });
			const activationReleased = new Promise<void>(resolve => { releaseActivation = resolve; });
			harness.setActivationHandler(async activationEvent => {
				assert.strictEqual(activationEvent, `onBaseHalfCanvasRecipe:${recipe.id}`);
				didActivate();
				await activationReleased;
			});
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});

			const execution = harness.service.run(harness.node('frame.bhnode'));
			await activationStarted;
			const persistedRunning = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.strictEqual(persistedRunning.runs[0].status, 'running');
			const activeRun = harness.service.getActiveRun(harness.resource('frame.bhnode'));
			assert.ok(activeRun);
			assert.strictEqual(harness.service.cancel(harness.resource('frame.bhnode'), activeRun.runId), true);

			const result = await execution;
			releaseActivation!();
			releaseActivation = undefined;
			assert.strictEqual(executed, false);
			assert.strictEqual(result.runs[0].status, 'cancelled');
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.deepStrictEqual(result.current, initial.current);
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			releaseActivation?.();
			await harness.dispose();
		}
	});

	test('rejects a recipe whose primary output kind does not match the node kind', async () => {
		const recipe = fileRecipe();
		const harness = await createHarness(recipe);
		try {
			await harness.writeNode('plan.bhnode', nodeDocument('plan', 'video', recipe.id));
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});

			await assert.rejects(() => harness.service.run(harness.node('plan.bhnode')), /cannot run on a video node/);
			assert.strictEqual(executed, false);
			const persisted = JSON.parse(await harness.read('plan.bhnode')) as IBaseHalfNodeDocument;
			assert.deepStrictEqual(persisted.runs, []);
		} finally {
			await harness.dispose();
		}
	});

	test('records an unassigned direct context connection as a failed immutable attempt', async () => {
		const harness = await createHarness(imageRecipe(), [{ source: 'brief.md', target: 'frame.bhnode' }]);
		try {
			await harness.write('brief.md', 'context');
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(executed, false);
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /Assign every direct context connection/);
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('blocks a dirty node before creating run state', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			harness.setDirty('frame.bhnode', true);
			await assert.rejects(() => harness.service.run(harness.node('frame.bhnode')), /Save this node/);
			const persisted = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.deepStrictEqual(persisted.runs, []);
		} finally {
			await harness.dispose();
		}
	});

	test('vetoes moving or deleting a directory while a descendant node is running', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.fileService.createFolder(harness.resource('shots/one'));
			await harness.writeNode('shots/one/frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			let didStart!: () => void;
			const started = new Promise<void>(resolve => { didStart = resolve; });
			harness.registerExecutor(async (_request, _progress, token) => {
				didStart();
				return new Promise((_resolve, reject) => {
					const listener = token.onCancellationRequested(() => {
						listener.dispose();
						reject(new CancellationError());
					});
				});
			});

			const execution = harness.service.run(harness.node('shots/one/frame.bhnode'));
			await started;
			await assert.rejects(() => harness.service.acquireStructuralOperation(
				FileOperation.DELETE,
				[{ target: harness.resource('shots') }]
			), /active node run/);
			await assert.rejects(() => harness.service.acquireStructuralOperation(
				FileOperation.MOVE,
				[{ source: harness.resource('elsewhere'), target: harness.resource('shots') }]
			), /active node run/);

			assert.strictEqual(harness.service.cancel(harness.resource('shots/one/frame.bhnode'), harness.service.getActiveRun(harness.resource('shots/one/frame.bhnode'))!.runId), true);
			assert.strictEqual((await execution).runs[0].status, 'cancelled');
		} finally {
			await harness.dispose();
		}
	});

	test('moves an unrun node and releases structural leases for History, Run, and another rename', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.fileService.createFolder(harness.resource('shots/one'));
			await harness.fileService.createFolder(harness.resource('archive'));
			await harness.writeNode('shots/one/frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			const guard = await harness.service.acquireStructuralOperation(
				FileOperation.MOVE,
				[{ source: harness.resource('shots'), target: harness.resource('archive/shots') }]
			);
			await assert.rejects(
				() => harness.service.run(harness.node('shots/one/frame.bhnode')),
				/current file operation/
			);
			assert.deepStrictEqual((JSON.parse(await harness.read('shots/one/frame.bhnode')) as IBaseHalfNodeDocument).runs, []);
			await harness.fileService.move(harness.resource('shots'), harness.resource('archive/shots'));
			guard.dispose();

			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('result'), { overwrite: false });
				return {
					artifacts: [{ id: 'frame', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'frame'
				};
			});
			const first = await harness.service.run(harness.node('archive/shots/one/frame.bhnode'));
			assert.strictEqual(first.runs[0].status, 'succeeded');

			const renameGuard = await harness.service.acquireStructuralOperation(
				FileOperation.MOVE,
				[{
					source: harness.resource('archive/shots/one/frame.bhnode'),
					target: harness.resource('archive/shots/one/renamed.bhnode')
				}]
			);
			await harness.fileService.move(
				harness.resource('archive/shots/one/frame.bhnode'),
				harness.resource('archive/shots/one/renamed.bhnode')
			);
			renameGuard.dispose();
			const selected = await harness.service.selectCurrent(harness.node('archive/shots/one/renamed.bhnode'), first.runs[0].id);
			assert.strictEqual(selected.current.runId, first.runs[0].id);

			const secondRenameGuard = await harness.service.acquireStructuralOperation(
				FileOperation.MOVE,
				[{
					source: harness.resource('archive/shots/one/renamed.bhnode'),
					target: harness.resource('archive/shots/one/final.bhnode')
				}]
			);
			await harness.fileService.move(
				harness.resource('archive/shots/one/renamed.bhnode'),
				harness.resource('archive/shots/one/final.bhnode')
			);
			secondRenameGuard.dispose();
			const second = await harness.service.run(harness.node('archive/shots/one/final.bhnode'));
			assert.deepStrictEqual(second.runs.map(run => run.status), ['succeeded', 'succeeded']);
		} finally {
			await harness.dispose();
		}
	});

	test('structural scans exclude only the project-owned immutable output tree', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			await harness.write('outputs/frozen/run/inputs/node.bhnode', '{not a live node');
			const rootGuard = await harness.service.acquireStructuralOperation(
				FileOperation.MOVE,
				[{ source: harness.workspaceFolder, target: harness.workspaceFolder.with({ path: '/archive/project' }) }]
			);
			rootGuard.dispose();

			await harness.write('draft/outputs/node.bhnode', '{malformed ordinary node');
			await assert.rejects(() => harness.service.acquireStructuralOperation(
				FileOperation.MOVE,
				[{ source: harness.resource('draft'), target: harness.resource('archive/draft') }]
			));
		} finally {
			await harness.dispose();
		}
	});

	test('cancels structural scans without leaving a file-operation block', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			const cancellation = new CancellationTokenSource();
			cancellation.cancel();
			await assert.rejects(() => harness.service.acquireStructuralOperation(
				FileOperation.DELETE,
				[{ target: harness.resource('frame.bhnode') }],
				cancellation.token
			), /Canceled/);
			cancellation.dispose();

			const guard = await harness.service.acquireStructuralOperation(
				FileOperation.DELETE,
				[{ target: harness.resource('frame.bhnode') }]
			);
			guard.dispose();
		} finally {
			await harness.dispose();
		}
	});

	test('bounds structural scans by folder depth without recursive traversal', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			let path = 'deep';
			await harness.fileService.createFolder(harness.resource(path));
			for (let index = 0; index < 513; index++) {
				path += `/level-${index}`;
				await harness.fileService.createFolder(harness.resource(path));
			}
			await assert.rejects(() => harness.service.acquireStructuralOperation(
				FileOperation.DELETE,
				[{ target: harness.resource('deep') }]
			), /nested more than 512 folders deep/);
		} finally {
			await harness.dispose();
		}
	});

	test('shares fresh execution ownership across service instances', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			let didStart!: () => void;
			const started = new Promise<void>(resolve => { didStart = resolve; });
			harness.registerExecutor(async (request, _progress, token) => {
				didStart();
				return new Promise((_resolve, reject) => {
					const listener = token.onCancellationRequested(() => {
						listener.dispose();
						reject(new CancellationError());
					});
				});
			});
			const peer = harness.createPeerService();
			const execution = harness.service.run(harness.node('frame.bhnode'));
			await started;

			const persisted = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.strictEqual(persisted.runs[0].status, 'running');
			const beforeStatusCheck = await harness.read('frame.bhnode');
			await assert.rejects(() => peer.recoverInterrupted(harness.node('frame.bhnode')), /still active in another/);
			assert.strictEqual(await harness.read('frame.bhnode'), beforeStatusCheck);
			await assert.rejects(() => peer.run(harness.node('frame.bhnode')), /active run in another window/);
			await assert.rejects(() => peer.selectCurrent(harness.node('frame.bhnode'), 'missing'), /other window/);
			await assert.rejects(() => peer.acquireStructuralOperation(
				FileOperation.DELETE,
				[{ target: harness.resource('frame.bhnode') }]
			), /other window/);

			assert.strictEqual(harness.service.cancel(
				harness.resource('frame.bhnode'),
				harness.service.getActiveRun(harness.resource('frame.bhnode'))!.runId
			), true);
			assert.strictEqual((await execution).runs[0].status, 'cancelled');
		} finally {
			await harness.dispose();
		}
	});

	test('recovers a stale persisted run only after an explicit status check and preserves Current', async () => {
		const harness = await createHarness(imageRecipe());
		let releaseExecution: (() => void) | undefined;
		try {
			await harness.fileService.createFolder(harness.resource('assets/frame'));
			await harness.write('assets/frame/current.png', 'previous');
			const initial = importBaseHalfNodeCurrent(nodeDocument('frame', 'image', imageRecipe().id), {
				id: 'revision-1',
				source: 'imported',
				createdAt: '2026-07-18T10:00:00Z',
				artifacts: [{
					id: 'artifact-1',
					outputId: 'imported',
					kind: 'image',
					path: 'assets/frame/current.png',
					sha256: await sha256('previous'),
					size: 8
				}],
				primaryArtifactId: 'artifact-1'
			});
			await harness.writeNode('frame.bhnode', initial);
			let didStart!: () => void;
			const started = new Promise<void>(resolve => { didStart = resolve; });
			harness.registerExecutor(async request => {
				didStart();
				await new Promise<void>(resolve => { releaseExecution = resolve; });
				const artifact = URI.joinPath(request.outputDirectory, 'later.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('later'), { overwrite: false });
				return {
					artifacts: [{ id: 'later', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'later'
				};
			});

			const execution = harness.service.run(harness.node('frame.bhnode'));
			await started;
			const running = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			const previousCurrent = running.current;
			const leaseResource = baseHalfNodeRunLeaseResource(harness.workspaceFolder, running.id);
			const staleLease = JSON.parse((await harness.fileService.readFile(leaseResource)).value.toString()) as Record<string, unknown>;
			staleLease.heartbeatAt = '2000-01-01T00:00:00.000Z';
			await harness.fileService.writeFile(leaseResource, VSBuffer.fromString(`${JSON.stringify(staleLease, null, '\t')}\n`));

			const peer = harness.createPeerService();
			const recovered = await peer.recoverInterrupted(harness.node('frame.bhnode'));
			assert.strictEqual(recovered.runs.at(-1)?.status, 'interrupted');
			assert.deepStrictEqual(recovered.current, previousCurrent);
			assert.deepStrictEqual((JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument).current, previousCurrent);

			releaseExecution!();
			releaseExecution = undefined;
			await assert.rejects(() => execution, /lost its execution ownership/);
			const final = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.strictEqual(final.runs.at(-1)?.status, 'interrupted');
			assert.deepStrictEqual(final.current, previousCurrent);
		} finally {
			releaseExecution?.();
			await harness.dispose();
		}
	});

	test('persists stale-owner recovery before a new service starts another run', async () => {
		const harness = await createHarness(imageRecipe());
		let releaseFirst: (() => void) | undefined;
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			let firstStarted!: () => void;
			const started = new Promise<void>(resolve => { firstStarted = resolve; });
			let calls = 0;
			harness.registerExecutor(async request => {
				calls++;
				if (calls === 1) {
					firstStarted();
					await new Promise<void>(resolve => { releaseFirst = resolve; });
				}
				const artifact = URI.joinPath(request.outputDirectory, `frame-${calls}.png`);
				await harness.fileService.createFile(artifact, VSBuffer.fromString(`result-${calls}`), { overwrite: false });
				return {
					artifacts: [{ id: 'frame', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'frame'
				};
			});

			const firstExecution = harness.service.run(harness.node('frame.bhnode'));
			await started;
			const firstOnDisk = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.strictEqual(firstOnDisk.runs[0].status, 'running');
			const leaseResource = baseHalfNodeRunLeaseResource(harness.workspaceFolder, firstOnDisk.id);
			const staleLease = JSON.parse((await harness.fileService.readFile(leaseResource)).value.toString()) as Record<string, unknown>;
			staleLease.heartbeatAt = '2000-01-01T00:00:00.000Z';
			await harness.fileService.writeFile(leaseResource, VSBuffer.fromString(`${JSON.stringify(staleLease, null, '\t')}\n`));

			const peer = harness.createPeerService();
			const second = await peer.run(harness.node('frame.bhnode'));
			assert.strictEqual(calls, 2);
			assert.strictEqual(second.runs[0].status, 'interrupted');
			assert.match(second.runs[0].error ?? '', /previous execution host stopped/);
			assert.strictEqual(second.runs[1].status, 'succeeded');
			const recoveredOnDisk = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.deepStrictEqual(recoveredOnDisk.runs.map(run => run.status), ['interrupted', 'succeeded']);

			releaseFirst!();
			releaseFirst = undefined;
			await assert.rejects(() => firstExecution, /lost its execution ownership/);
			const finalOnDisk = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.deepStrictEqual(finalOnDisk.runs.map(run => run.status), ['interrupted', 'succeeded']);
			const releasedLease = JSON.parse((await harness.fileService.readFile(leaseResource)).value.toString()) as { state: string };
			assert.strictEqual(releasedLease.state, 'released');
		} finally {
			releaseFirst?.();
			await harness.dispose();
		}
	});

	test('records a dirty direct input as a failed attempt before freezing inputs', async () => {
		const harness = await createHarness(imageRecipe(), [{ source: 'brief.md', target: 'frame.bhnode' }]);
		try {
			await harness.write('brief.md', 'saved prompt');
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id, [
				{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }
			]));
			harness.setDirty('brief.md', true);
			await assert.rejects(
				() => harness.service.getInputRevision(harness.workspaceFolder, 'brief.md'),
				/Save direct input 'brief\.md'/
			);
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(executed, false);
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /Save direct input 'brief\.md'/);
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('records a dirty descendant of a direct folder input as a failed attempt', async () => {
		const harness = await createHarness(imageRecipe(), [{ source: 'references', target: 'frame.bhnode' }]);
		try {
			await harness.fileService.createFolder(harness.resource('references'));
			await harness.write('references/brief.md', 'saved prompt');
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id, [
				{ sourcePath: 'references', slot: 'prompt', order: 0 }
			]));
			harness.setDirty('references/brief.md', true);

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /Save direct input 'references'/);
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('records an unsaved Current artifact of a direct result-node input as a failed attempt', async () => {
		const harness = await createHarness(imageRecipe(), [{ source: 'source.bhnode', target: 'frame.bhnode' }]);
		try {
			await harness.fileService.createFolder(harness.resource('assets/source'));
			await harness.write('assets/source/reference.png', 'saved image');
			const source = importBaseHalfNodeCurrent(createBaseHalfNodeDocument({
				id: sourceNodeId,
				kind: 'image',
				title: 'Source',
				role: 'reference'
			}), {
				id: 'revision-1',
				source: 'imported',
				createdAt: '2026-07-18T10:00:00Z',
				artifacts: [{
					id: 'artifact-1', outputId: 'imported', kind: 'image',
					path: 'assets/source/reference.png', sha256: await sha256('saved image'), size: 11
				}],
				primaryArtifactId: 'artifact-1'
			});
			await harness.writeNode('source.bhnode', source);
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id, [
				{ sourcePath: 'source.bhnode', slot: 'prompt', order: 0 }
			]));
			harness.setDirty('assets/source/reference.png', true);

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /Current.*assets\/source\/reference\.png/);
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('records an empty direct result source as a failed attempt', async () => {
		const recipe = imageReferenceRecipe();
		const harness = await createHarness(recipe, [{ source: 'source.bhnode', target: 'frame.bhnode' }]);
		try {
			await harness.writeNode('source.bhnode', createBaseHalfNodeDocument({
				id: sourceNodeId, kind: 'image', title: 'Source', role: 'reference'
			}));
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', recipe.id, [
				{ sourcePath: 'source.bhnode', slot: 'reference', order: 0 }
			]));
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(executed, false);
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /source\.bhnode.*has no Current/);
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('records a malformed direct result Current as a failed attempt', async () => {
		const recipe = imageReferenceRecipe();
		const harness = await createHarness(recipe, [{ source: 'source.bhnode', target: 'frame.bhnode' }]);
		try {
			const source = await writeImportedImageSource(harness, 'recorded-image', 'recorded-image');
			const malformed = JSON.parse(serializeBaseHalfNodeDocument(source)) as Record<string, unknown>;
			const revisions = malformed.revisions as Array<Record<string, unknown>>;
			revisions[0].primaryArtifactId = 'missing-primary';
			await harness.write('source.bhnode', `${JSON.stringify(malformed, null, '\t')}\n`);
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', recipe.id, [
				{ sourcePath: 'source.bhnode', slot: 'reference', order: 0 }
			]));
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(executed, false);
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /primaryArtifactId/);
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('records a missing or changed direct Current artifact as a failed attempt', async () => {
		for (const state of ['missing', 'changed'] as const) {
			const recipe = imageReferenceRecipe();
			const harness = await createHarness(recipe, [{ source: 'source.bhnode', target: 'frame.bhnode' }]);
			try {
				await writeImportedImageSource(harness, state === 'missing' ? undefined : 'changed-by-user', 'recorded-image');
				await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', recipe.id, [
					{ sourcePath: 'source.bhnode', slot: 'reference', order: 0 }
				]));
				let executed = false;
				harness.registerExecutor(async () => {
					executed = true;
					throw new Error('executor must not start');
				});

				const result = await harness.service.run(harness.node('frame.bhnode'));
				assert.strictEqual(executed, false);
				assert.strictEqual(result.runs[0].status, 'failed');
				assert.match(result.runs[0].error ?? '', state === 'missing' ? /Current output.*is missing/ : /Current output.*changed on disk/);
				assert.deepStrictEqual(result.runs[0].inputs, []);
				assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
			} finally {
				await harness.dispose();
			}
		}
	});

	test('uses a verified old Current when the source latest run failed', async () => {
		const recipe = imageReferenceRecipe();
		const harness = await createHarness(recipe, [{ source: 'source.bhnode', target: 'frame.bhnode' }]);
		try {
			let source = await writeImportedImageSource(harness, 'recorded-image', 'recorded-image');
			source = createBaseHalfNodeDocument({
				...source,
				recipe: { recipeId: recipe.id, parameters: {}, inputBindings: [] }
			});
			source = beginBaseHalfNodeRun(source, {
				id: 'source-run-2',
				createdAt: '2026-07-18T10:01:00Z',
				startedAt: '2026-07-18T10:01:00Z',
				model: { source: 'local' },
				inputs: []
			});
			source = failBaseHalfNodeRun(source, 'source-run-2', {
				completedAt: '2026-07-18T10:01:01Z',
				error: 'The later attempt failed.'
			});
			await harness.writeNode('source.bhnode', source);
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', recipe.id, [
				{ sourcePath: 'source.bhnode', slot: 'reference', order: 0 }
			]));
			let executed = false;
			harness.registerExecutor(async request => {
				executed = true;
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('result'), { overwrite: false });
				return {
					artifacts: [{ id: 'frame', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'frame'
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(executed, true);
			assert.strictEqual(result.runs[0].status, 'succeeded');
			assert.match(result.runs[0].inputs[0].revision, /^v1;revision=/);
		} finally {
			await harness.dispose();
		}
	});

	test('rechecks a direct Current after preflight and rejects bytes changed before freezing', async () => {
		const recipe = imageReferenceRecipe();
		const harness = await createHarness(recipe, [{ source: 'source.bhnode', target: 'frame.bhnode' }]);
		try {
			await writeImportedImageSource(harness, 'original', 'original');
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', recipe.id, [
				{ sourcePath: 'source.bhnode', slot: 'reference', order: 0 }
			]));
			let executed = false;
			harness.registerExecutor(async () => {
				executed = true;
				throw new Error('executor must not start');
			});
			const checksum = harness.checksumService.checksum.bind(harness.checksumService);
			let sourceChecks = 0;
			harness.checksumService.checksum = async resource => {
				const digest = await checksum(resource);
				if (resource.toString() === harness.resource('assets/source/reference.png').toString() && ++sourceChecks === 2) {
					await harness.write('assets/source/reference.png', 'mutated!');
				}
				return digest;
			};

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(executed, false);
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /Output changed/);
			assert.deepStrictEqual(result.current, { source: 'empty', outputPaths: [] });
		} finally {
			await harness.dispose();
		}
	});

	test('fingerprints ordinary inputs by source identity and content', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.write('brief.md', 'first');
			await harness.write('copy.md', 'first');
			harness.checksumService.resetCallCount();
			const first = await harness.service.getInputRevision(harness.workspaceFolder, 'brief.md');
			assert.strictEqual(harness.checksumService.callCount, 1);
			assert.strictEqual(await harness.service.getInputRevision(harness.workspaceFolder, 'brief.md'), first);
			assert.strictEqual(harness.checksumService.callCount, 1);
			assert.strictEqual(await harness.service.getInputRevision(harness.workspaceFolder, 'brief.md', { fresh: true }), first);
			assert.strictEqual(harness.checksumService.callCount, 2);
			const sameBytesDifferentSource = await harness.service.getInputRevision(harness.workspaceFolder, 'copy.md');
			await harness.write('brief.md', 'second');
			const changed = await harness.service.getInputRevision(harness.workspaceFolder, 'brief.md');

			assert.match(first, /^v1;source=[A-Za-z0-9_-]{43};sha256=[A-Za-z0-9_-]{43}$/);
			assert.notStrictEqual(first, sameBytesDifferentSource);
			assert.notStrictEqual(first, changed);
		} finally {
			await harness.dispose();
		}
	});

	test('invalidates a cached folder fingerprint when a descendant changes', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.fileService.createFolder(harness.resource('references'));
			await harness.write('references/brief.md', 'first');
			harness.checksumService.resetCallCount();
			const first = await harness.service.getInputRevision(harness.workspaceFolder, 'references');
			assert.strictEqual(harness.checksumService.callCount, 1);
			assert.strictEqual(await harness.service.getInputRevision(harness.workspaceFolder, 'references'), first);
			assert.strictEqual(harness.checksumService.callCount, 1);

			await harness.write('references/brief.md', 'later');
			const changed = await harness.service.getInputRevision(harness.workspaceFolder, 'references');
			assert.notStrictEqual(changed, first);
			assert.strictEqual(harness.checksumService.callCount, 2);
		} finally {
			await harness.dispose();
		}
	});

	test('fingerprints an upstream node Current with run and primary artifact identity', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			const artifactHash = await sha256('same-image');
			await harness.fileService.createFolder(harness.resource(`outputs/${sourceNodeId}/run-1/artifacts`));
			await harness.write(`outputs/${sourceNodeId}/run-1/artifacts/frame.png`, 'same-image');
			let source = createBaseHalfNodeDocument({
				id: sourceNodeId,
				kind: 'image',
				title: 'Source',
				role: 'source',
				recipe: { recipeId: imageRecipe().id, parameters: {}, inputBindings: [] }
			});
				source = beginBaseHalfNodeRun(source, { id: 'run-1', createdAt: '2026-07-18T10:00:00Z', startedAt: '2026-07-18T10:00:00Z', model: { source: 'local' }, inputs: [] });
			source = completeBaseHalfNodeRun(source, 'run-1', {
				completedAt: '2026-07-18T10:00:01Z',
				artifacts: [{
					id: 'primary-1', outputId: 'result', kind: 'image',
					path: `outputs/${sourceNodeId}/run-1/artifacts/frame.png`, sha256: artifactHash, size: 10
				}],
				primaryArtifactId: 'primary-1'
			});
			await harness.writeNode('source.bhnode', source);
			const first = await harness.service.getInputRevision(harness.workspaceFolder, 'source.bhnode');

			await harness.fileService.createFolder(harness.resource(`outputs/${sourceNodeId}/run-2/artifacts`));
			await harness.write(`outputs/${sourceNodeId}/run-2/artifacts/frame.png`, 'same-image');
				source = beginBaseHalfNodeRun(source, { id: 'run-2', createdAt: '2026-07-18T10:01:00Z', startedAt: '2026-07-18T10:01:00Z', model: { source: 'local' }, inputs: [] });
			source = completeBaseHalfNodeRun(source, 'run-2', {
				completedAt: '2026-07-18T10:01:01Z',
				artifacts: [{
					id: 'primary-2', outputId: 'result', kind: 'image',
					path: `outputs/${sourceNodeId}/run-2/artifacts/frame.png`, sha256: artifactHash, size: 10
				}],
				primaryArtifactId: 'primary-2'
			});
			await harness.writeNode('source.bhnode', source);
			const second = await harness.service.getInputRevision(harness.workspaceFolder, 'source.bhnode');

			assert.match(first, /^v1;run=[A-Za-z0-9_-]{43};artifact=[A-Za-z0-9_-]{43};sha256=[A-Za-z0-9_-]{43}$/);
			assert.notStrictEqual(first, second);
		} finally {
			await harness.dispose();
		}
	});

	test('imports an explicitly selected external file as a verified immutable revision', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			await harness.writeExternal('reference.png', 'external-image');
			const target = URI.joinPath(baseHalfNodeImportedAssetDirectory(harness.workspaceFolder, frameNodeId), 'reference.png');
			const revision = await harness.service.copyImportedRevision(harness.workspaceFolder, harness.external('reference.png'), target, 'image');

			assert.strictEqual(revision.source, 'imported');
			assert.strictEqual(revision.artifacts[0].path, `assets/${frameNodeId}/reference.png`);
			assert.notStrictEqual(revision.artifacts[0].path.split('/').length, 1);
			assert.strictEqual(revision.artifacts[0].size, 14);
			assert.strictEqual(revision.artifacts[0].sha256, await sha256('external-image'));
			assert.strictEqual(await harness.service.getArtifactIntegrity(harness.workspaceFolder, revision.artifacts[0]), 'available');

			const imported = importBaseHalfNodeCurrent(nodeDocument('frame', 'image', imageRecipe().id), revision);
			await harness.writeNode('frame.bhnode', imported);
			const inputRevision = await harness.service.getInputRevision(harness.workspaceFolder, 'frame.bhnode');
			assert.match(inputRevision, /^v1;revision=[A-Za-z0-9_-]{43};artifact=[A-Za-z0-9_-]{43};sha256=[A-Za-z0-9_-]{43}$/);
			assert.strictEqual((await harness.service.selectCurrent(harness.node('frame.bhnode'), revision.id)).current.revisionId, revision.id);
		} finally {
			await harness.dispose();
		}
	});

	test('returns an exact Current transition that can be safely undone and redone', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			await harness.writeExternal('first.png', 'first-image');
			await harness.writeExternal('second.png', 'second-image');
			const first = await harness.service.copyImportedRevision(
				harness.workspaceFolder,
				harness.external('first.png'),
				URI.joinPath(baseHalfNodeImportedAssetDirectory(harness.workspaceFolder, frameNodeId), 'first.png'),
				'image'
			);
			const second = await harness.service.copyImportedRevision(
				harness.workspaceFolder,
				harness.external('second.png'),
				URI.joinPath(baseHalfNodeImportedAssetDirectory(harness.workspaceFolder, frameNodeId), 'second.png'),
				'image'
			);
			let document = importBaseHalfNodeCurrent(nodeDocument('frame', 'image', imageRecipe().id), first);
			document = importBaseHalfNodeCurrent(document, second);
			await harness.writeNode('frame.bhnode', document);

			const transition = await harness.service.selectCurrentWithTransition(harness.node('frame.bhnode'), first.id);
			assert.strictEqual(transition.document.current.revisionId, first.id);
			assert.strictEqual(
				(await harness.service.transitionCurrent(harness.node('frame.bhnode'), transition.after, transition.before)).current.revisionId,
				second.id
			);

			const unrelatedChange = VSBuffer.fromString(serializeBaseHalfNodeDocument({
				...transition.document,
				title: 'Changed outside History'
			}));
			await assert.rejects(
				() => harness.service.transitionCurrent(harness.node('frame.bhnode'), transition.before, unrelatedChange),
				/may change only the Current selection/
			);
			assert.strictEqual(
				(await harness.service.transitionCurrent(harness.node('frame.bhnode'), transition.before, transition.after)).current.revisionId,
				first.id
			);
			await assert.rejects(
				() => harness.service.transitionCurrent(harness.node('frame.bhnode'), transition.before, transition.after),
				/Current changed before/
			);
		} finally {
			await harness.dispose();
		}
	});

	test('derives a stable portable import folder from the node identity', () => {
		assert.strictEqual(
			baseHalfNodeImportedAssetDirectory(URI.file('/workspace'), 'frame-1').path,
			'/workspace/assets/frame-1'
		);
		assert.match(
			baseHalfNodeImportedAssetDirectory(URI.file('/workspace'), 'CON').path,
			/^\/workspace\/assets\/node-[A-Za-z0-9_-]+$/
		);
	});

	test('rejects imported targets outside the project or through a symbolic-link component', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			await harness.writeExternal('reference.png', 'external-image');
			await assert.rejects(() => harness.service.copyImportedRevision(
				harness.workspaceFolder,
				harness.external('reference.png'),
				harness.external('escaped.png'),
				'image'
			), /must remain inside this project/);

			const assetDirectory = baseHalfNodeImportedAssetDirectory(harness.workspaceFolder, frameNodeId);
			await harness.fileService.createFolder(assetDirectory);
			harness.fileSystemProvider.markSymbolicLink(assetDirectory, harness.external('redirected'));
			const target = URI.joinPath(assetDirectory, 'reference.png');
			await assert.rejects(() => harness.service.copyImportedRevision(
				harness.workspaceFolder,
				harness.external('reference.png'),
				target,
				'image'
			), /symbolic-link component/);
			assert.strictEqual(await harness.fileService.exists(target), false);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects an import when the selected source changes before acceptance', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			await harness.writeExternal('reference.png', 'external-image');
			let sourceChecks = 0;
			const mutateAfterCopy = async (resource: URI): Promise<void> => {
				if (resource.toString() === harness.external('reference.png').toString() && ++sourceChecks === 3) {
					await harness.fileService.writeFile(resource, VSBuffer.fromString('changed-source'));
					return;
				}
				harness.checksumService.afterNextChecksum = mutateAfterCopy;
			};
			harness.checksumService.afterNextChecksum = mutateAfterCopy;
			const target = URI.joinPath(baseHalfNodeImportedAssetDirectory(harness.workspaceFolder, frameNodeId), 'reference.png');
			await assert.rejects(() => harness.service.copyImportedRevision(
				harness.workspaceFolder,
				harness.external('reference.png'),
				target,
				'image'
			), /^(?=.*changed while it was being (?:verified|imported))(?=.*kept as ordinary project data).+$/);
			assert.strictEqual(await harness.fileService.exists(target), true);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects an artifact that changes while its hash is being accepted', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('initial'), { overwrite: false });
				harness.checksumService.afterNextChecksum = async resource => {
					assert.strictEqual(resource.toString(), artifact.toString());
					await harness.fileService.writeFile(artifact, VSBuffer.fromString('changed-after-hash'));
				};
				return {
					artifacts: [{ id: 'frame', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'frame',
					providerRequestId: 'provider/failed-integrity-1',
					usage: { images: 1 },
					cost: { currency: 'USD', amount: '0.04', kind: 'actual' }
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			const run = result.runs[0];

			assert.strictEqual(run.status, 'failed');
			assert.match(run.error ?? '', /changed while it was being accepted/);
			assert.strictEqual(run.providerRequestId, 'provider/failed-integrity-1');
			assert.deepStrictEqual(run.usage, { images: 1 });
			assert.deepStrictEqual(run.cost, { currency: 'USD', amount: '0.04', kind: 'actual' });
			assert.strictEqual(await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${run.id}/artifacts/frame.png`)), true);
			assert.strictEqual(await harness.read(`outputs/${frameNodeId}/${run.id}/artifacts/frame.png`), 'changed-after-hash');
		} finally {
			await harness.dispose();
		}
	});

	test('fails invalid primary results while preserving partial local output and frozen inputs', async () => {
		const harness = await createHarness(imageRecipe(), [{ source: 'brief.md', target: 'frame.bhnode' }]);
		try {
			await harness.write('brief.md', 'context');
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id, [
				{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }
			]));
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'partial.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('partial'), { overwrite: false });
				return {
					artifacts: [{ id: 'partial', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'missing'
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			const run = result.runs[0];
			const runDirectory = `outputs/${frameNodeId}/${run.id}`;

			assert.strictEqual(run.status, 'failed');
			assert.match(run.error ?? '', /invalid primary artifact/);
			assert.strictEqual(run.artifacts.length, 0);
			assert.strictEqual(await harness.fileService.exists(harness.resource(`${runDirectory}/artifacts/partial.png`)), true);
			assert.strictEqual(await harness.read(`${runDirectory}/artifacts/partial.png`), 'partial');
			assert.strictEqual(await harness.fileService.exists(harness.resource(`${runDirectory}/inputs/000-brief.md`)), true);
			assert.strictEqual(await harness.read(`${runDirectory}/inputs/000-brief.md`), 'context');
		} finally {
			await harness.dispose();
		}
	});

	test('marks cooperative cancellation while preserving partial local output', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			let didStart!: () => void;
			const started = new Promise<void>(resolve => { didStart = resolve; });
			harness.registerExecutor(async (request, _progress, token) => {
				const artifact = URI.joinPath(request.outputDirectory, 'partial.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('partial'), { overwrite: false });
				didStart();
				return new Promise((_resolve, reject) => {
					const listener = token.onCancellationRequested(() => {
						listener.dispose();
						reject(new CancellationError());
					});
				});
			});

			const execution = harness.service.run(harness.node('frame.bhnode'));
			await started;
			assert.strictEqual(harness.service.cancel(harness.resource('frame.bhnode'), harness.service.getActiveRun(harness.resource('frame.bhnode'))!.runId), true);
			const result = await execution;
			const run = result.runs[0];

			assert.strictEqual(run.status, 'cancelled');
			assert.strictEqual(await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${run.id}/artifacts/partial.png`)), true);
			assert.strictEqual(await harness.read(`outputs/${frameNodeId}/${run.id}/artifacts/partial.png`), 'partial');
			assert.strictEqual(await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${run.id}/inputs`)), true);
			assert.strictEqual(harness.service.getActiveRun(harness.resource('frame.bhnode')), undefined);
		} finally {
			await harness.dispose();
		}
	});

	test('persists cancellation requested while direct inputs are still preparing', async () => {
		const harness = await createHarness(imageRecipe(), [{ source: 'brief.md', target: 'frame.bhnode' }]);
		try {
			await harness.write('brief.md', 'context');
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id, [
				{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }
			]));
			let executorStarted = false;
			harness.registerExecutor(async () => {
				executorStarted = true;
				throw new Error('executor must not start');
			});
			let observedPersistedRun = false;
			harness.checksumService.afterNextChecksum = async resource => {
				if (resource.toString() !== harness.resource('brief.md').toString()) {
					return;
				}
				const persisted = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
				observedPersistedRun = persisted.runs[0]?.status === 'running';
				assert.strictEqual(harness.service.cancel(harness.resource('frame.bhnode'), harness.service.getActiveRun(harness.resource('frame.bhnode'))!.runId), true);
			};

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(observedPersistedRun, true);
			assert.strictEqual(executorStarted, false);
			assert.strictEqual(result.runs[0].status, 'cancelled');
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.strictEqual(result.current.source, 'empty');
		} finally {
			await harness.dispose();
		}
	});

	test('finishes cancellation without waiting for a non-cooperative provider', async () => {
		const harness = await createHarness(imageRecipe());
		let releaseExecutor: (() => void) | undefined;
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			let didStart!: () => void;
			const started = new Promise<void>(resolve => { didStart = resolve; });
			let didFinish!: () => void;
			const finished = new Promise<void>(resolve => { didFinish = resolve; });
			const release = new Promise<void>(resolve => { releaseExecutor = resolve; });
			let phaseAfterLateProgress: string | undefined;
			harness.registerExecutor(async (request, progress) => {
				didStart();
				await release;
				progress.report({ message: 'Provider still finishing', increment: 10 });
				phaseAfterLateProgress = harness.service.getActiveRun(harness.resource('frame.bhnode'))?.phase;
				await harness.fileService.createFolder(request.outputDirectory);
				const artifact = URI.joinPath(request.outputDirectory, 'late.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('late'), { overwrite: false });
				didFinish();
				return {
					artifacts: [{ id: 'frame', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'frame',
					providerRequestId: 'provider/cancelled-1',
					usage: { images: 1 },
					cost: { currency: 'USD', amount: '0.04', kind: 'actual' }
				};
			});

			const execution = harness.service.run(harness.node('frame.bhnode'));
			await started;
			const displayedRunId = harness.service.getActiveRun(harness.resource('frame.bhnode'))!.runId;
			assert.strictEqual(harness.service.cancel(harness.resource('frame.bhnode'), 'stale-run-id'), false);
			assert.strictEqual(harness.service.getActiveRun(harness.resource('frame.bhnode'))!.phase, 'running');
			assert.strictEqual(harness.service.cancel(harness.resource('frame.bhnode'), displayedRunId), true);
			assert.strictEqual(harness.service.getActiveRun(harness.resource('frame.bhnode'))!.phase, 'cancelling');
			const result = await execution;
			const run = result.runs[0];
			assert.strictEqual(run.status, 'cancelled');
			assert.strictEqual(harness.service.getActiveRun(harness.resource('frame.bhnode')), undefined);
			assert.strictEqual(run.providerRequestId, undefined);
			assert.deepStrictEqual(run.artifacts, []);
			assert.deepStrictEqual(result.current, { source: 'empty', outputPaths: [] });
			releaseExecutor!();
			releaseExecutor = undefined;
			await finished;
			assert.strictEqual(phaseAfterLateProgress, undefined);
			assert.strictEqual(await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${run.id}/artifacts/late.png`)), true);
			assert.strictEqual(await harness.read(`outputs/${frameNodeId}/${run.id}/artifacts/late.png`), 'late');
			const persisted = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.strictEqual(persisted.runs[0].status, 'cancelled');
			assert.strictEqual(persisted.runs[0].providerRequestId, undefined);
			assert.deepStrictEqual(persisted.runs[0].artifacts, []);
			assert.deepStrictEqual(persisted.current, { source: 'empty', outputPaths: [] });
		} finally {
			releaseExecutor?.();
			await harness.dispose();
		}
	});

	test('permits retry after cancellation while the old provider is still settling', async () => {
		const harness = await createHarness(imageRecipe());
		let releaseFirst: (() => void) | undefined;
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			let firstStarted!: () => void;
			const started = new Promise<void>(resolve => { firstStarted = resolve; });
			let firstFinished!: () => void;
			const finished = new Promise<void>(resolve => { firstFinished = resolve; });
			const firstRelease = new Promise<void>(resolve => { releaseFirst = resolve; });
			let calls = 0;
			harness.registerExecutor(async request => {
				calls++;
				if (calls === 1) {
					firstStarted();
					await firstRelease;
					const artifact = URI.joinPath(request.outputDirectory, 'first.png');
					await harness.fileService.createFile(artifact, VSBuffer.fromString('first'), { overwrite: false });
					firstFinished();
					return {
						artifacts: [{ id: 'first', outputId: 'result', kind: 'image', resource: artifact }],
						primaryArtifactId: 'first'
					};
				}
				const artifact = URI.joinPath(request.outputDirectory, 'second.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('second'), { overwrite: false });
				return {
					artifacts: [{ id: 'second', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'second'
				};
			});

			const firstExecution = harness.service.run(harness.node('frame.bhnode'));
			await started;
			const firstRunId = harness.service.getActiveRun(harness.resource('frame.bhnode'))!.runId;
			assert.strictEqual(harness.service.cancel(harness.resource('frame.bhnode'), firstRunId), true);
			const cancelled = await firstExecution;
			assert.strictEqual(cancelled.runs[0].status, 'cancelled');
			assert.strictEqual(harness.service.getActiveRun(harness.resource('frame.bhnode')), undefined);
			assert.deepStrictEqual(cancelled.current, { source: 'empty', outputPaths: [] });

			const second = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(second.runs[1].status, 'succeeded');
			assert.notStrictEqual(second.runs[1].id, firstRunId);
			assert.strictEqual(second.current.runId, second.runs[1].id);
			assert.strictEqual(second.runs[0].status, 'cancelled');

			releaseFirst!();
			releaseFirst = undefined;
			await finished;
			const persisted = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.strictEqual(persisted.runs[0].status, 'cancelled');
			assert.strictEqual(persisted.runs[1].status, 'succeeded');
			assert.strictEqual(persisted.current.runId, persisted.runs[1].id);
		} finally {
			releaseFirst?.();
			await harness.dispose();
		}
	});

	test('does not select a historical result whose accepted artifact is changed or missing', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('accepted'), { overwrite: false });
				return {
					artifacts: [{ id: 'frame', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'frame'
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			const run = result.runs[0];
			const artifact = run.artifacts[0];
			const before = await harness.read('frame.bhnode');
			harness.checksumService.resetCallCount();
			assert.strictEqual(await harness.service.getArtifactIntegrity(harness.workspaceFolder, artifact), 'available');
			assert.strictEqual(harness.checksumService.callCount, 1);
			assert.strictEqual(await harness.service.getArtifactIntegrity(harness.workspaceFolder, artifact), 'available');
			assert.strictEqual(harness.checksumService.callCount, 1);
			await harness.service.selectCurrent(harness.node('frame.bhnode'), run.id);
			assert.strictEqual(harness.checksumService.callCount, 2);

			await harness.write(artifact.path, 'changed');
			assert.strictEqual(await harness.service.getArtifactIntegrity(harness.workspaceFolder, artifact), 'changed');
			await assert.rejects(() => harness.service.selectCurrent(harness.node('frame.bhnode'), run.id), /Output changed/);
			assert.strictEqual(await harness.read('frame.bhnode'), before);

			await harness.fileService.del(harness.resource(artifact.path));
			assert.strictEqual(await harness.service.getArtifactIntegrity(harness.workspaceFolder, artifact), 'missing');
			await assert.rejects(() => harness.service.selectCurrent(harness.node('frame.bhnode'), run.id), /Output missing/);
			assert.strictEqual(await harness.read('frame.bhnode'), before);
		} finally {
			await harness.dispose();
		}
	});

	test('records a failed run for an unsafe input without starting the executor', async () => {
		const harness = await createHarness(imageRecipe(), [{ source: 'brief.md', target: 'frame.bhnode' }]);
		try {
			await harness.write('source.md', 'context');
			await harness.write('brief.md', 'context');
			harness.fileSystemProvider.markSymbolicLink(harness.resource('brief.md'), harness.resource('source.md'));
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id, [
				{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }
			]));
			harness.registerExecutor(async () => {
				throw new Error('executor must not start');
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(result.runs[0].status, 'failed');
			assert.match(result.runs[0].error ?? '', /symbolic-link component/);
			assert.deepStrictEqual(result.runs[0].inputs, []);
			assert.strictEqual(await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${result.runs[0].id}/artifacts`)), true);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects a direct result-node input before reading a symbolic-link leaf or ancestor', async () => {
		for (const variant of ['leaf', 'ancestor'] as const) {
			const sourcePath = variant === 'leaf' ? 'source.bhnode' : 'linked/source.bhnode';
			const recipe = imageReferenceRecipe();
			const harness = await createHarness(recipe, [{ source: sourcePath, target: 'frame.bhnode' }]);
			try {
				if (variant === 'ancestor') {
					await harness.fileService.createFolder(harness.resource('linked'));
				}
				await harness.write(sourcePath, 'this must not be parsed');
				harness.fileSystemProvider.markSymbolicLink(
					variant === 'leaf' ? harness.resource(sourcePath) : harness.resource('linked'),
					harness.external('redirected')
				);
				await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', recipe.id, [
					{ sourcePath, slot: 'reference', order: 0 }
				]));
				let executed = false;
				harness.registerExecutor(async () => {
					executed = true;
					throw new Error('executor must not start');
				});

				const result = await harness.service.run(harness.node('frame.bhnode'));
				assert.strictEqual(executed, false);
				assert.strictEqual(result.runs[0].status, 'failed');
				assert.match(result.runs[0].error ?? '', /cannot follow symbolic links/);
				assert.deepStrictEqual(result.runs[0].inputs, []);
			} finally {
				await harness.dispose();
			}
		}
	});

	test('rejects node mutations through a symbolic-link workspace ancestor', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.fileService.createFolder(harness.resource('linked'));
			await harness.writeNode('linked/frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			const node = harness.node('linked/frame.bhnode');
			const source = VSBuffer.fromString(await harness.read('linked/frame.bhnode'));
			harness.fileSystemProvider.markSymbolicLink(harness.resource('linked'), harness.external('redirected'));

			await assert.rejects(() => harness.service.run(node), /cannot follow symbolic links/);
			await assert.rejects(() => harness.service.recoverInterrupted(node), /cannot follow symbolic links/);
			await assert.rejects(() => harness.service.selectCurrent(node, 'missing'), /cannot follow symbolic links/);
			await assert.rejects(() => harness.service.transitionCurrent(node, source, source), /cannot follow symbolic links/);
			assert.strictEqual(harness.service.getActiveRun(node.resource), undefined);
			assert.strictEqual(await harness.fileService.exists(harness.resource('.bh/cache/node-run-leases')), false);
			assert.strictEqual(await harness.fileService.exists(harness.external('redirected')), false);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects a symbolic-link output root before creating run data', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			await harness.fileService.createFolder(harness.resource('outputs'));
			harness.fileSystemProvider.markSymbolicLink(harness.resource('outputs'), harness.external('redirected'));
			let executorStarted = false;
			harness.registerExecutor(async () => {
				executorStarted = true;
				throw new Error('executor must not start');
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			const run = result.runs[0];

			assert.strictEqual(run.status, 'failed');
			assert.match(run.error ?? '', /symbolic-link component/);
			assert.strictEqual(executorStarted, false);
			assert.strictEqual(await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${run.id}`)), false);
			assert.strictEqual(await harness.fileService.exists(harness.external('redirected')), false);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects symbolic-link artifacts without deleting their external target', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			await harness.write('external.png', 'external');
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('external'), { overwrite: false });
				harness.fileSystemProvider.markSymbolicLink(artifact, harness.resource('external.png'));
				return {
					artifacts: [{ id: 'frame', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'frame'
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			const run = result.runs[0];

			assert.strictEqual(run.status, 'failed');
			assert.match(run.error ?? '', /symbolic-link component/);
			assert.strictEqual(await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${run.id}/artifacts/frame.png`)), true);
			assert.strictEqual(await harness.fileService.exists(harness.resource('external.png')), true);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects artifacts whose verified path resolves outside the run directory', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame', 'image', imageRecipe().id));
			await harness.write('external.png', 'external');
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('external'), { overwrite: false });
				harness.fileSystemProvider.redirectRealpath(artifact, harness.resource('external.png'));
				return {
					artifacts: [{ id: 'frame', outputId: 'result', kind: 'image', resource: artifact }],
					primaryArtifactId: 'frame'
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			const run = result.runs[0];

			assert.strictEqual(run.status, 'failed');
			assert.match(run.error ?? '', /resolves outside its verified run directory/);
			assert.strictEqual(await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${run.id}/artifacts/frame.png`)), true);
			assert.strictEqual(await harness.fileService.exists(harness.resource('external.png')), true);
		} finally {
			await harness.dispose();
		}
	});

	async function createHarness(recipe: IBaseHalfCanvasRecipeContribution, references: readonly { source: string; target: string }[] = [], modelServices: readonly IBaseHalfModelServiceDescriptor[] = []): Promise<TestHarness> {
		const harness = new TestHarness(recipe, references, modelServices);
		await harness.initialize();
		return harness;
	}
});

class TestHarness {
	readonly workspaceFolder: URI;
	readonly fileService: IFileService;
	readonly fileSystemProvider: TestFileSystemProvider;
	readonly checksumService: TestChecksumService;
	readonly service: BaseHalfNodeExecutionService;

	private readonly disposables = new DisposableStore();
	private readonly registry = this.disposables.add(new BaseHalfCanvasRecipeRegistryService());
	private readonly extensionService = new ControllableTestExtensionService();
	private readonly runtime: BaseHalfCanvasRecipeRuntimeService;
	private readonly badgeGraph: IBaseHalfBadgeGraphService;
	private readonly modelServicesService: IBaseHalfModelServiceService;
	private readonly workingCopyService: IWorkingCopyService;
	private executor: IDisposable | undefined;
	private modelServiceDescriptors: readonly IBaseHalfModelServiceDescriptor[];
	private modelServicesHandler: ((capability: BaseHalfModelCapability | undefined) => Promise<readonly IBaseHalfModelServiceDescriptor[]>) | undefined;

	constructor(
		private readonly recipe: IBaseHalfCanvasRecipeContribution,
		references: readonly { source: string; target: string }[],
		modelServices: readonly IBaseHalfModelServiceDescriptor[]
	) {
		this.modelServiceDescriptors = modelServices;
		this.workspaceFolder = URI.from({ scheme: 'basehalf-node-test', path: '/workspace' });
		const logService = new NullLogService();
		const fileService = this.disposables.add(new FileService(logService));
		this.fileSystemProvider = this.disposables.add(new TestFileSystemProvider());
		this.disposables.add(fileService.registerProvider(this.workspaceFolder.scheme, this.fileSystemProvider));
		this.fileService = fileService;
		this.disposables.add(this.registry.registerRecipe('test.workflow', recipe));
		this.runtime = this.disposables.add(new BaseHalfCanvasRecipeRuntimeService(this.registry, this.extensionService));
		this.badgeGraph = badgeGraphService(references);
		this.modelServicesService = {
			getServices: async (_consumer: undefined, capability?: BaseHalfModelCapability) => this.modelServicesHandler
				? this.modelServicesHandler(capability)
				: this.modelServiceDescriptors.filter(service => capability === undefined || service.capabilities.includes(capability))
		} as Partial<IBaseHalfModelServiceService> as IBaseHalfModelServiceService;
		this.checksumService = new TestChecksumService(fileService);
		const dirtyResources = this.dirtyResources;
		this.workingCopyService = {
				isDirty: (resource: URI) => this.dirtyResources.has(resource.toString()),
				get dirtyWorkingCopies() {
					return [...dirtyResources].map(value => ({ resource: URI.parse(value) }));
				}
			} as never;
		this.service = this.createPeerService();
	}

	async initialize(): Promise<void> {
		await this.fileService.createFolder(this.workspaceFolder);
		await this.fileService.createFolder(this.resource('.bh'));
		await this.fileService.createFolder(this.external(''));
	}

	resource(path: string): URI {
		return URI.joinPath(this.workspaceFolder, ...path.split('/'));
	}

	external(path: string): URI {
		return URI.from({ scheme: this.workspaceFolder.scheme, path: `/downloads${path ? `/${path}` : ''}` });
	}

	node(relativePath: string): IBaseHalfWorkspaceResource {
		return { resource: this.resource(relativePath), workspaceFolder: this.workspaceFolder, relativePath };
	}

	createPeerService(): BaseHalfNodeExecutionService {
		return this.disposables.add(new BaseHalfNodeExecutionService(
			this.fileService,
			this.badgeGraph,
			this.registry,
			this.runtime,
			this.modelServicesService,
			this.extensionService,
			this.checksumService,
			this.workingCopyService
		));
	}

	async write(path: string, content: string): Promise<void> {
		await this.fileService.writeFile(this.resource(path), VSBuffer.fromString(content));
	}

	async writeExternal(path: string, content: string): Promise<void> {
		await this.fileService.writeFile(this.external(path), VSBuffer.fromString(content));
	}

	async writeNode(path: string, document: IBaseHalfNodeDocument): Promise<void> {
		await this.write(path, serializeBaseHalfNodeDocument(document));
	}

	async read(path: string): Promise<string> {
		return (await this.fileService.readFile(this.resource(path))).value.toString();
	}

	private readonly dirtyResources = new Set<string>();

	setDirty(path: string, dirty: boolean): void {
		if (dirty) {
			this.dirtyResources.add(this.resource(path).toString());
		} else {
			this.dirtyResources.delete(this.resource(path).toString());
		}
	}

	setModelServices(modelServices: readonly IBaseHalfModelServiceDescriptor[]): void {
		this.modelServiceDescriptors = modelServices;
	}

	setModelServicesHandler(handler: ((capability: BaseHalfModelCapability | undefined) => Promise<readonly IBaseHalfModelServiceDescriptor[]>) | undefined): void {
		this.modelServicesHandler = handler;
	}

	setActivationHandler(handler: ((activationEvent: string) => Promise<void>) | undefined): void {
		this.extensionService.setActivationHandler(handler);
	}

	registerExecutor(execute: IBaseHalfCanvasRecipeRuntimeProvider['execute']): void {
		assert.strictEqual(this.executor, undefined);
		this.executor = this.runtime.registerExecutor(this.recipe.id, { extensionId: 'test.workflow', execute });
	}

	async dispose(): Promise<void> {
		this.executor?.dispose();
		this.executor = undefined;
		this.disposables.dispose();
	}
}

class ControllableTestExtensionService extends TestExtensionService {
	private activationHandler: ((activationEvent: string) => Promise<void>) | undefined;

	setActivationHandler(handler: ((activationEvent: string) => Promise<void>) | undefined): void {
		this.activationHandler = handler;
	}

	override activateByEvent(activationEvent: string): Promise<void> {
		return this.activationHandler?.(activationEvent) ?? super.activateByEvent(activationEvent);
	}
}

function badgeGraphService(references: readonly { source: string; target: string }[]): IBaseHalfBadgeGraphService {
	return {
		readBadgeNeighborhood: async node => {
			const paths = new Set([node.relativePath]);
			for (const reference of references) {
				if (reference.source === node.relativePath || reference.target === node.relativePath) {
					paths.add(reference.source);
					paths.add(reference.target);
				}
			}
			const badges = new Map<string, IBaseHalfBadgeFile>();
			for (const path of paths) {
				badges.set(path, {
					path,
					kind: 'file',
					references: references.filter(reference => reference.source === path).map(reference => reference.target),
					referenced_by: references.filter(reference => reference.target === path).map(reference => reference.source)
				});
			}
			return { badges, problems: [] };
		}
	} as Partial<IBaseHalfBadgeGraphService> as IBaseHalfBadgeGraphService;
}

function nodeDocument(
	label: 'frame' | 'plan',
	kind: 'image' | 'video',
	recipeId: string,
	inputBindings: readonly { sourcePath: string; slot: string; order: number }[] = []
): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({
		id: label === 'frame' ? baseHalfNodeTestId(1) : baseHalfNodeTestId(3),
		kind,
		title: label,
		role: 'result',
		recipe: { recipeId, parameters: {}, inputBindings }
	});
}

function imageRecipe(): IBaseHalfCanvasRecipeContribution {
	return {
		id: 'test.workflow.create-image',
		label: 'Create image',
		inputs: [{ id: 'prompt', label: 'Prompt', accepts: ['text'], minItems: 0, maxItems: 1 }],
		outputs: [{ id: 'result', kind: 'image', extensions: ['.png'], minItems: 1, maxItems: 1, primary: true }]
	};
}

function imageReferenceRecipe(): IBaseHalfCanvasRecipeContribution {
	return {
		...imageRecipe(),
		id: 'test.workflow.transform-image',
		label: 'Transform image',
		inputs: [{ id: 'reference', label: 'Reference', accepts: ['image'], minItems: 1, maxItems: 1 }]
	};
}

async function writeImportedImageSource(
	harness: TestHarness,
	diskContent: string | undefined,
	recordedContent: string
): Promise<IBaseHalfNodeDocument> {
	await harness.fileService.createFolder(harness.resource('assets/source'));
	if (diskContent !== undefined) {
		await harness.write('assets/source/reference.png', diskContent);
	}
	const source = importBaseHalfNodeCurrent(createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(2),
		kind: 'image',
		title: 'Source',
		role: 'reference'
	}), {
		id: 'source-revision-1',
		source: 'imported',
		createdAt: '2026-07-18T10:00:00Z',
		artifacts: [{
			id: 'source-artifact-1',
			outputId: 'imported',
			kind: 'image',
			path: 'assets/source/reference.png',
			sha256: await sha256(recordedContent),
			size: recordedContent.length
		}],
		primaryArtifactId: 'source-artifact-1'
	});
	await harness.writeNode('source.bhnode', source);
	return source;
}

function externalImageRecipe(): IBaseHalfCanvasRecipeContribution {
	return {
		...imageRecipe(),
		id: 'test.workflow.generate-image',
		label: 'Generate image',
		modelCapability: 'image'
	};
}

function modelService(id: string, label: string, identityCharacter: string): IBaseHalfModelServiceDescriptor {
	return {
		id,
		label,
		endpoint: 'https://models.example.com/v1',
		capabilities: ['image'],
		authorization: 'bearer',
		connectionIdentity: `sha256:${identityCharacter.repeat(43)}`,
		configured: true
	};
}

function fileRecipe(): IBaseHalfCanvasRecipeContribution {
	return {
		id: 'test.workflow.create-file',
		label: 'Create file',
		outputs: [{ id: 'result', kind: 'file', extensions: ['.md'], minItems: 1, maxItems: 1, primary: true }]
	};
}

class TestChecksumService implements IChecksumService {
	declare readonly _serviceBrand: undefined;
	afterNextChecksum: ((resource: URI) => Promise<void>) | undefined;
	callCount = 0;

	constructor(private readonly fileService: IFileService) { }

	async checksum(resource: URI): Promise<string> {
		this.callCount++;
		const content = (await this.fileService.readFile(resource)).value;
		const digest = await globalThis.crypto.subtle.digest('SHA-256', content.buffer);
		const afterChecksum = this.afterNextChecksum;
		this.afterNextChecksum = undefined;
		await afterChecksum?.(resource);
		return encodeBase64(VSBuffer.wrap(new Uint8Array(digest)), false);
	}

	resetCallCount(): void {
		this.callCount = 0;
	}
}

class TestFileSystemProvider extends InMemoryFileSystemProvider {
	private readonly symbolicLinks = new Set<string>();
	private readonly resolvedPaths = new Map<string, string>();

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities | FileSystemProviderCapabilities.FileRealpath;
	}

	override async stat(resource: URI): Promise<IStat> {
		const stat = await super.stat(resource);
		return this.symbolicLinks.has(resource.toString())
			? { ...stat, type: stat.type | FileType.SymbolicLink }
			: stat;
	}

	async realpath(resource: URI): Promise<string> {
		return this.resolvedPaths.get(resource.toString()) ?? resource.path;
	}

	markSymbolicLink(resource: URI, target: URI): void {
		this.symbolicLinks.add(resource.toString());
		this.redirectRealpath(resource, target);
	}

	redirectRealpath(resource: URI, target: URI): void {
		this.resolvedPaths.set(resource.toString(), target.path);
	}
}

async function sha256(value: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return encodeBase64(VSBuffer.wrap(new Uint8Array(digest)), false, true);
}
