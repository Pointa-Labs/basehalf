/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IChecksumService } from '../../../../platform/checksum/common/checksumService.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { FileSystemProviderCapabilities, FileType, IFileService, IFileStatWithMetadata, IStat, IWriteFileWithExpectedContentsOptions } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { TestExtensionService } from '../../../test/common/workbenchTestServices.js';
import {
	BaseHalfNodeExecutionService,
	baseHalfNodeRetryConfigurationMatches,
	baseHalfNodeImportedAssetDirectory,
	baseHalfSafeExecutionErrorMessage
} from '../../browser/basehalfNodeExecutionService.js';
import { IBaseHalfBadgeGraphService } from '../../common/basehalfBadgeGraph.js';
import { IBaseHalfBadgeFile } from '../../common/basehalfBadgeMirror.js';
import {
	BaseHalfCanvasRecipeRegistryService,
	BaseHalfCanvasRecipeRuntimeService,
	IBaseHalfCanvasRecipeContribution,
	IBaseHalfCanvasRecipeExecutionRequest,
	IBaseHalfCanvasRecipeExecutionResult,
	IBaseHalfCanvasRecipeRuntimeProvider
} from '../../common/basehalfCanvasRecipes.js';
import { IBaseHalfWorkspaceResource } from '../../common/basehalfCanvasNavigation.js';
import { IBaseHalfModelServiceDescriptor, IBaseHalfModelServiceService } from '../../common/basehalfModelServices.js';
import { BaseHalfVideoModelCatalogService } from '../../common/basehalfVideoModelCatalogs.js';
import { BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID } from '../../common/basehalfVideoModels.js';
import {
	beginBaseHalfNodeAttempt,
	createBaseHalfNodeDocument,
	getBaseHalfNodeResultArtifact,
	IBaseHalfNodeDocument,
	importBaseHalfNodeResult,
	serializeBaseHalfNodeDocument
} from '../../common/basehalfNodeDocument.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';

suite('BaseHalfNodeExecutionService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const frameNodeId = baseHalfNodeTestId(1);

	test('persists only a bounded actionable summary of execution errors', () => {
		const secret = 'sensitive-value-that-must-never-be-persisted';
		const safe = baseHalfSafeExecutionErrorMessage(new Error(
			`Request rejected\u0000\nhttps://api.example.invalid/v1/render?api_key=${secret} Authorization: Bearer ${secret}`
		));

		assert.deepStrictEqual({
			startsWithSummary: safe.startsWith('Request rejected'),
			bounded: safe.length <= 1024,
			hasControl: /[\u0000-\u001F\u007F-\u009F]/.test(safe),
			hasHost: safe.includes('api.example.invalid'),
			hasSecret: safe.includes(secret)
		}, {
			startsWithSummary: true,
			bounded: true,
			hasControl: false,
			hasHost: false,
			hasSecret: false
		});
	});

	test('seals the first successful attempt as exactly one local Result file', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let executorPrompt: string | undefined;
			harness.registerExecutor(async request => {
				executorPrompt = request.prompt;
				await request.acknowledgeProviderRequestId('provider-request-1');
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('generated-image'), { overwrite: false });
				return {
					artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact },
					providerRequestId: 'provider-request-1',
					usage: { images: 1 },
					cost: { currency: 'USD', amount: '0.04', kind: 'actual' }
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			const attempt = result.attempts[0];
			assert.deepStrictEqual({
				status: attempt.status,
				attemptPrompt: attempt.prompt,
				executorPrompt,
				providerRequestId: attempt.providerRequestId,
				usage: attempt.usage,
				cost: attempt.cost,
				resultSource: result.result?.source,
				resultAttemptId: result.result?.source === 'attempt' ? result.result.attemptId : undefined,
				artifact: getBaseHalfNodeResultArtifact(result)
			}, {
				status: 'succeeded',
				attemptPrompt: 'Render the frozen frame intent.',
				executorPrompt: 'Render the frozen frame intent.',
				providerRequestId: 'provider-request-1',
				usage: { images: 1 },
				cost: { currency: 'USD', amount: '0.04', kind: 'actual' },
				resultSource: 'attempt',
				resultAttemptId: attempt.id,
				artifact: {
					id: 'frame',
					outputId: 'result',
					kind: 'image',
					path: `outputs/${frameNodeId}/${attempt.id}/artifacts/frame.png`,
					sha256: await sha256('generated-image'),
					size: 15
				}
			});
			assert.deepStrictEqual(JSON.parse(await harness.read('frame.bhnode')), result);
		} finally {
			await harness.dispose();
		}
	});

	test('retries an acknowledged remote task by resuming the same provider id', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let calls = 0;
			const resumeIds: Array<string | undefined> = [];
			harness.registerExecutor(async request => {
				calls++;
				resumeIds.push(request.resumeProviderRequestId);
				if (calls === 1) {
					await request.acknowledgeProviderRequestId('provider/task-resume');
					throw new Error('Polling was interrupted.');
				}
				assert.strictEqual(request.resumeProviderRequestId, 'provider/task-resume');
				await request.acknowledgeProviderRequestId(request.resumeProviderRequestId);
				const artifact = URI.joinPath(request.outputDirectory, 'retry.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('retry-result'), { overwrite: false });
				return {
					artifact: { id: 'retry', outputId: 'result', kind: 'image', resource: artifact },
					providerRequestId: request.resumeProviderRequestId
				};
			});

			const first = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(first.attempts[0].providerRequestId, 'provider/task-resume');
			const second = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual(resumeIds, [undefined, 'provider/task-resume']);
			assert.deepStrictEqual(second.attempts.map(attempt => ({
				status: attempt.status,
				providerRequestId: attempt.providerRequestId
			})), [
				{ status: 'failed', providerRequestId: 'provider/task-resume' },
				{ status: 'succeeded', providerRequestId: 'provider/task-resume' }
			]);
		} finally {
			await harness.dispose();
		}
	});

	test('records one replacement task id when a resumed provider task is terminal', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let calls = 0;
			harness.registerExecutor(async request => {
				calls++;
				if (calls === 1) {
					await request.acknowledgeProviderRequestId('provider/task-terminal');
					throw new Error('The remote task failed.');
				}
				assert.strictEqual(request.resumeProviderRequestId, 'provider/task-terminal');
				await request.acknowledgeProviderRequestId('provider/task-replacement');
				const artifact = URI.joinPath(request.outputDirectory, 'replacement.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('replacement-result'), { overwrite: false });
				return {
					artifact: { id: 'replacement', outputId: 'result', kind: 'image', resource: artifact },
					providerRequestId: 'provider/task-replacement'
				};
			});

			await harness.service.run(harness.node('frame.bhnode'));
			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual(result.attempts.map(attempt => ({
				status: attempt.status,
				providerRequestId: attempt.providerRequestId
			})), [
				{ status: 'failed', providerRequestId: 'provider/task-terminal' },
				{ status: 'succeeded', providerRequestId: 'provider/task-replacement' }
			]);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects a legacy multi-file payload and records a failed Attempt without sealing a Result', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			harness.registerExecutor(async request => {
				const first = URI.joinPath(request.outputDirectory, 'first.png');
				const second = URI.joinPath(request.outputDirectory, 'second.png');
				await harness.fileService.createFile(first, VSBuffer.fromString('first'), { overwrite: false });
				await harness.fileService.createFile(second, VSBuffer.fromString('second'), { overwrite: false });
				return {
					artifacts: [
						{ id: 'first', outputId: 'result', kind: 'image', resource: first },
						{ id: 'second', outputId: 'result', kind: 'image', resource: second }
					],
					primaryArtifactId: 'first'
				} as unknown as IBaseHalfCanvasRecipeExecutionResult;
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({
				status: result.attempts[0].status,
				error: result.attempts[0].error,
				result: result.result,
				firstKept: await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${result.attempts[0].id}/artifacts/first.png`)),
				secondKept: await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${result.attempts[0].id}/artifacts/second.png`))
			}, {
				status: 'failed',
				error: 'BaseHalf canvas recipe \'test.workflow.transform-image\' returned an invalid result.',
				result: undefined,
				firstKept: true,
				secondKept: true
			});
		} finally {
			await harness.dispose();
		}
	});

	test('records a failed Attempt and retries the same frozen recipe into a sealed Result', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let calls = 0;
			harness.registerExecutor(async request => {
				calls++;
				if (calls === 1) {
					throw new Error('Provider unavailable.');
				}
				const artifact = URI.joinPath(request.outputDirectory, 'retry.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('retry-result'), { overwrite: false });
				return {
					artifact: { id: 'retry', outputId: 'result', kind: 'image', resource: artifact }
				};
			});

			const first = await harness.service.run(harness.node('frame.bhnode'));
			const firstAttempt = first.attempts[0];
			const second = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({
				statuses: second.attempts.map(attempt => attempt.status),
				firstPreserved: second.attempts[0],
				recipesEqual: JSON.stringify(second.recipe) === JSON.stringify(first.recipe),
				frozenModelsEqual: JSON.stringify(second.attempts[1].model) === JSON.stringify(firstAttempt.model),
				frozenInputsEqual: JSON.stringify(second.attempts[1].inputs) === JSON.stringify(firstAttempt.inputs),
				sealedAttemptId: second.result?.source === 'attempt' ? second.result.attemptId : undefined
			}, {
				statuses: ['failed', 'succeeded'],
				firstPreserved: firstAttempt,
				recipesEqual: true,
				frozenModelsEqual: true,
				frozenInputsEqual: true,
				sealedAttemptId: second.attempts[1].id
			});
		} finally {
			await harness.dispose();
		}
	});

	test('durably acknowledges a provider task id before asynchronous work can continue', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			harness.registerExecutor(async request => {
				await request.acknowledgeProviderRequestId('provider/task-9');
				const persisted = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
				assert.strictEqual(persisted.attempts[0].providerRequestId, 'provider/task-9');
				throw new Error('Polling failed after submission.');
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({
				status: result.attempts[0].status,
				providerRequestId: result.attempts[0].providerRequestId,
				error: result.attempts[0].error
			}, {
				status: 'failed',
				providerRequestId: 'provider/task-9',
				error: 'Polling failed after submission.'
			});
		} finally {
			await harness.dispose();
		}
	});

	test('rejects a provider result id that was not durably acknowledged', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('generated-image'), { overwrite: false });
				return {
					artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact },
					providerRequestId: 'provider/task-unacknowledged'
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(result.attempts[0].status, 'failed');
			assert.match(result.attempts[0].error ?? '', /without durably acknowledging/);
			assert.strictEqual(result.attempts[0].providerRequestId, undefined);
			assert.strictEqual(result.result, undefined);
		} finally {
			await harness.dispose();
		}
	});

	test('revalidates canonical reviewed video settings before invoking the provider', async () => {
		const descriptor = videoModelServiceDescriptor();
		const harness = await createHarness(videoRecipe(), [], [descriptor]);
		try {
			harness.registerVideoCatalog(videoModelCatalog());
			await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			let providerCalls = 0;
			let executorRequest: IBaseHalfCanvasRecipeExecutionRequest | undefined;
			harness.registerExecutor(async request => {
				providerCalls++;
				executorRequest = request;
				const artifact = URI.joinPath(request.outputDirectory, 'clip.mp4');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('generated-video'), { overwrite: false });
				return { artifact: { id: 'clip', outputId: 'result', kind: 'video', resource: artifact } };
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(providerCalls, 1);
			assert.deepStrictEqual(executorRequest?.parameters, {
				generationMode: 'text-to-video',
				resolution: '720P',
				duration: 5,
				[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID]: videoModelSnapshot('2026-08-16')
			});
			assert.deepStrictEqual({
				status: result.attempts[0].status,
				model: result.attempts[0].model,
				artifact: getBaseHalfNodeResultArtifact(result)
			}, {
				status: 'succeeded',
				model: {
					source: 'service',
					connection: 'resolved',
					serviceId: descriptor.id,
					serviceLabel: descriptor.label,
					connectionIdentity: descriptor.connectionIdentity,
					capability: 'video',
					modelId: 'seedance-1.5-pro'
				},
				artifact: {
					id: 'clip',
					outputId: 'result',
					kind: 'video',
					path: `outputs/${frameNodeId}/${result.attempts[0].id}/artifacts/clip.mp4`,
					sha256: await sha256('generated-video'),
					size: 15
				}
			});

			await harness.writeNode('source.bhnode', videoNodeDocument('2026-07-01', baseHalfNodeTestId(2)));
			await assert.rejects(
				() => harness.service.run(harness.node('source.bhnode')),
				/No reviewed capability matches byteplus\/global\/ap-southeast-1\/seedance-1\.5-pro@2026-07-01/
			);
			assert.strictEqual(providerCalls, 1);
			assert.strictEqual((JSON.parse(await harness.read('source.bhnode')) as IBaseHalfNodeDocument).attempts.length, 0);

			await harness.writeNode('prompt.bhnode', { ...videoNodeDocument('2026-08-16', baseHalfNodeTestId(3)), prompt: '' });
			await assert.rejects(
				() => harness.service.run(harness.node('prompt.bhnode')),
				/Write a prompt for this generation method/
			);
			assert.strictEqual(providerCalls, 1);
			assert.strictEqual((JSON.parse(await harness.read('prompt.bhnode')) as IBaseHalfNodeDocument).attempts.length, 0);

			await harness.writeNode('long-prompt.bhnode', {
				...videoNodeDocument('2026-08-16', baseHalfNodeTestId(4)),
				prompt: 'x'.repeat(1_501)
			});
			await assert.rejects(
				() => harness.service.run(harness.node('long-prompt.bhnode')),
				/1,500 characters or fewer/
			);
			assert.strictEqual(providerCalls, 1);
			assert.strictEqual((JSON.parse(await harness.read('long-prompt.bhnode')) as IBaseHalfNodeDocument).attempts.length, 0);
		} finally {
			await harness.dispose();
		}
	});

	test('never resolves a video recipe against another extension owner\'s catalog', async () => {
		const harness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoModelCatalog(), 'other.workflow');
			await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			let providerCalls = 0;
			harness.registerExecutor(async () => {
				providerCalls++;
				throw new Error('The provider must not see a foreign catalog selection.');
			});

			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode')),
				/No reviewed capability matches byteplus\/global\/ap-southeast-1\/seedance-1\.5-pro@2026-08-16/
			);
			assert.strictEqual(providerCalls, 0);
			assert.strictEqual((JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument).attempts.length, 0);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects an incompatible reviewed-video connection before creating an Attempt', async () => {
		const descriptor: IBaseHalfModelServiceDescriptor = {
			...videoModelServiceDescriptor(),
			endpoint: 'http://127.0.0.1:8787',
			configured: true
		};
		const harness = await createHarness(videoRecipe(), [], [descriptor]);
		try {
			harness.registerVideoCatalog(videoModelCatalog());
			await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			let providerCalls = 0;
			harness.registerExecutor(async () => {
				providerCalls++;
				throw new Error('The provider must not receive an incompatible connection.');
			});

			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode')),
				/public HTTPS endpoint and Bearer API key/
			);
			assert.strictEqual(providerCalls, 0);
			assert.strictEqual((JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument).attempts.length, 0);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects legacy model fields on a local video recipe before creating an Attempt', async () => {
		const harness = await createHarness(localVideoRecipe());
		try {
			await harness.writeNode('frame.bhnode', createBaseHalfNodeDocument({
				id: frameNodeId,
				kind: 'video',
				title: 'Local clip',
				role: 'result',
				prompt: 'Render the local timeline.',
				recipe: {
					recipeId: localVideoRecipe().id,
					modelServiceId: 'legacy.video',
					modelId: 'free-form-model-id',
					parameters: { fps: 24 },
					inputBindings: []
				}
			}));
			let executorCalls = 0;
			harness.registerExecutor(async () => {
				executorCalls++;
				throw new Error('The local executor must not receive legacy model fields.');
			});

			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode')),
				/cannot use a legacy model service or free-form Model ID/
			);
			assert.strictEqual(executorCalls, 0);
			assert.strictEqual((JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument).attempts.length, 0);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects a Retry configuration whose prompt differs from the frozen Attempt', () => {
		const document = videoNodeDocument('2026-08-16');
		const attempt = beginBaseHalfNodeAttempt(document, videoAttemptOptions()).attempts[0];

		assert.strictEqual(baseHalfNodeRetryConfigurationMatches(document.prompt, document.recipe!, attempt), true);
		assert.strictEqual(baseHalfNodeRetryConfigurationMatches('Use a different camera move.', document.recipe!, attempt), false);
	});

	test('rejects a Retry configuration whose dynamic video parameter differs from the frozen Attempt', () => {
		const document = videoNodeDocument('2026-08-16');
		const attempt = beginBaseHalfNodeAttempt(document, videoAttemptOptions()).attempts[0];
		const changedRecipe = {
			...document.recipe!,
			parameters: {
				...document.recipe!.parameters,
				duration: 10
			}
		};

		assert.strictEqual(baseHalfNodeRetryConfigurationMatches(document.prompt, document.recipe!, attempt), true);
		assert.strictEqual(baseHalfNodeRetryConfigurationMatches(document.prompt, changedRecipe, attempt), false);
	});

	test('rejects Retry before provider invocation when a frozen direct input revision changed', async () => {
		const references = [{ source: 'brief.txt', target: 'frame.bhnode' }];
		const harness = await createHarness(textReferenceRecipe(), references);
		try {
			await harness.write('brief.txt', 'first brief');
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode', [
				{ sourcePath: 'brief.txt', slot: 'reference', order: 0 }
			]));
			let providerCalls = 0;
			harness.registerExecutor(async () => {
				providerCalls++;
				throw new Error('Provider unavailable.');
			});

			const first = await harness.service.run(harness.node('frame.bhnode'));
			await harness.write('brief.txt', 'changed brief');
			const retried = await harness.service.run(harness.node('frame.bhnode'));

			assert.deepStrictEqual({
				providerCalls,
				statuses: retried.attempts.map(attempt => attempt.status),
				frozenInputsEqual: JSON.stringify(retried.attempts[1].inputs) === JSON.stringify(first.attempts[0].inputs),
				error: retried.attempts[1].error,
				result: retried.result
			}, {
				providerCalls: 1,
				statuses: ['failed', 'failed'],
				frozenInputsEqual: true,
				error: 'Retry requires the unchanged frozen Recipe, inputs, and model connection. Copy settings to a new Draft.',
				result: undefined
			});
		} finally {
			await harness.dispose();
		}
	});

	test('rejects Retry before provider invocation when the frozen model connection changed', async () => {
		const firstConnection = modelServiceDescriptor('A');
		const harness = await createHarness(modelImageRecipe(), [], [firstConnection]);
		try {
			await harness.writeNode('frame.bhnode', createBaseHalfNodeDocument({
				id: frameNodeId,
				kind: 'image',
				title: 'Frame',
				role: 'result',
				recipe: {
					recipeId: modelImageRecipe().id,
					modelServiceId: firstConnection.id,
					modelId: 'image-v1',
					parameters: {},
					inputBindings: []
				}
			}));
			let providerCalls = 0;
			harness.registerExecutor(async () => {
				providerCalls++;
				throw new Error('Provider unavailable.');
			});

			const first = await harness.service.run(harness.node('frame.bhnode'));
			harness.setModelServices([modelServiceDescriptor('B')]);
			const retried = await harness.service.run(harness.node('frame.bhnode'));

			assert.deepStrictEqual({
				providerCalls,
				statuses: retried.attempts.map(attempt => attempt.status),
				frozenModelsEqual: JSON.stringify(retried.attempts[1].model) === JSON.stringify(first.attempts[0].model),
				error: retried.attempts[1].error,
				result: retried.result
			}, {
				providerCalls: 1,
				statuses: ['failed', 'failed'],
				frozenModelsEqual: true,
				error: 'Retry requires the unchanged frozen Recipe, inputs, and model connection. Copy settings to a new Draft.',
				result: undefined
			});
		} finally {
			await harness.dispose();
		}
	});

	test('rejects running a sealed Result and never calls the executor again', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let calls = 0;
			harness.registerExecutor(async request => {
				calls++;
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('sealed'), { overwrite: false });
				return {
					artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact }
				};
			});

			const sealed = await harness.service.run(harness.node('frame.bhnode'));
			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode')),
				/A sealed result node cannot run again/
			);
			assert.deepStrictEqual({ calls, persisted: JSON.parse(await harness.read('frame.bhnode')) }, { calls: 1, persisted: sealed });
		} finally {
			await harness.dispose();
		}
	});

	test('rejects an artifact whose kind does not match the node kind', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'wrong.mp4');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('video'), { overwrite: false });
				return {
					artifact: { id: 'wrong', outputId: 'result', kind: 'video', resource: artifact }
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({ status: result.attempts[0].status, error: result.attempts[0].error, result: result.result }, {
				status: 'failed',
				error: 'BaseHalf canvas recipe \'test.workflow.transform-image\' returned artifact \'wrong\' for an incompatible output.',
				result: undefined
			});
		} finally {
			await harness.dispose();
		}
	});

	test('records an invalid persistent artifact id as a terminal failed Attempt', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let providerCalls = 0;
			harness.registerExecutor(async request => {
				providerCalls++;
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('frame'), { overwrite: false });
				return { artifact: { id: 'invalid/id', outputId: 'result', kind: 'image', resource: artifact } };
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({
				providerCalls,
				status: result.attempts[0].status,
				result: result.result
			}, {
				providerCalls: 1,
				status: 'failed',
				result: undefined
			});
			assert.match(result.attempts[0].error ?? '', /contains unsupported characters\.$/);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects a directory presented as the sealed Result artifact', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'directory.png');
				await harness.fileService.createFolder(artifact);
				return { artifact: { id: 'directory', outputId: 'result', kind: 'image', resource: artifact } };
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({ status: result.attempts[0].status, error: result.attempts[0].error, result: result.result }, {
				status: 'failed',
				error: "Recipe output 'directory' must be a regular local file.",
				result: undefined
			});
		} finally {
			await harness.dispose();
		}
	});

	test('rejects symbolic-link artifact leaves and ancestors', async () => {
		for (const symbolicComponent of ['leaf', 'ancestor'] as const) {
			const harness = await createHarness(imageRecipe());
			try {
				await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
				harness.registerExecutor(async request => {
					const directory = URI.joinPath(request.outputDirectory, 'nested');
					await harness.fileService.createFolder(directory);
					const artifact = URI.joinPath(directory, 'frame.png');
					await harness.fileService.createFile(artifact, VSBuffer.fromString('frame'), { overwrite: false });
					harness.fileSystemProvider.markSymbolicLink(symbolicComponent === 'leaf' ? artifact : directory);
					return { artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact } };
				});

				const result = await harness.service.run(harness.node('frame.bhnode'));
				assert.deepStrictEqual({ status: result.attempts[0].status, error: result.attempts[0].error, result: result.result }, {
					status: 'failed',
					error: 'A recipe path contains a symbolic-link component.',
					result: undefined
				});
			} finally {
				await harness.dispose();
			}
		}
	});

	test('rejects an artifact whose real path escapes the verified output directory', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('frame'), { overwrite: false });
				harness.fileSystemProvider.setRealpath(artifact, '/outside/frame.png');
				return { artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact } };
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({ status: result.attempts[0].status, error: result.attempts[0].error, result: result.result }, {
				status: 'failed',
				error: "Recipe output 'frame' resolves outside its verified run directory.",
				result: undefined
			});
		} finally {
			await harness.dispose();
		}
	});

	test('rejects a same-size artifact rewrite between hashing and final metadata verification', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let artifact: URI | undefined;
			harness.setChecksumHook(async resource => {
				if (!artifact || resource.toString() !== artifact.toString()) {
					return;
				}
				await new Promise(resolve => setTimeout(resolve, 2));
				await harness.fileService.writeFile(resource, VSBuffer.fromString('other'));
			});
			harness.registerExecutor(async request => {
				artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('frame'), { overwrite: false });
				return { artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact } };
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({
				status: result.attempts[0].status,
				error: result.attempts[0].error,
				result: result.result,
				bytes: artifact ? (await harness.fileService.readFile(artifact)).value.toString() : undefined
			}, {
				status: 'failed',
				error: "Recipe output 'frame' changed while it was being accepted.",
				result: undefined,
				bytes: 'other'
			});
		} finally {
			await harness.dispose();
		}
	});

	test('freezes a direct generated Result and records its Attempt source identity', async () => {
		const references = [{ source: 'source.bhnode', target: 'frame.bhnode' }];
		const harness = await createHarness(imageReferenceRecipe(), references);
		try {
			await harness.writeNode('source.bhnode', nodeDocument('source.bhnode', []));
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode', [
				{ sourcePath: 'source.bhnode', slot: 'reference', order: 0 }
			]));
			let targetRequest: IBaseHalfCanvasRecipeExecutionRequest | undefined;
			harness.registerExecutor(async request => {
				const isSource = request.node.path === 'source.bhnode';
				if (!isSource) {
					targetRequest = request;
				}
				const artifact = URI.joinPath(request.outputDirectory, isSource ? 'source.png' : 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString(isSource ? 'source-result' : 'frame-result'), { overwrite: false });
				return {
					artifact: { id: isSource ? 'source' : 'frame', outputId: 'result', kind: 'image', resource: artifact }
				};
			});

			const source = await harness.service.run(harness.node('source.bhnode'));
			const directRevision = await harness.service.getInputRevision(harness.workspaceFolder, 'source.bhnode', { fresh: true });
			const target = await harness.service.run(harness.node('frame.bhnode'));
			const frozenResource = targetRequest?.inputs[0].source.result?.resource;
			assert.ok(frozenResource);
			assert.deepStrictEqual({
				sourceKind: targetRequest?.inputs[0].source.result?.kind,
				frozenBytes: (await harness.fileService.readFile(frozenResource)).value.toString(),
				directRevision,
				attemptRevision: target.attempts[0].inputs[0].revision,
				sourceAttemptId: source.result?.source === 'attempt' ? source.result.attemptId : undefined
			}, {
				sourceKind: 'image',
				frozenBytes: 'source-result',
				directRevision,
				attemptRevision: directRevision,
				sourceAttemptId: source.attempts[0].id
			});
			assert.match(directRevision, /^v1;attempt=[A-Za-z0-9_-]{43};artifact=[A-Za-z0-9_-]{43};sha256=[A-Za-z0-9_-]{43}$/);
		} finally {
			await harness.dispose();
		}
	});

	test('reads an imported direct Result with an imported source identity', async () => {
		const references = [{ source: 'source.bhnode', target: 'frame.bhnode' }];
		const harness = await createHarness(imageReferenceRecipe(), references);
		try {
			await harness.fileService.createFolder(harness.resource('assets/source'));
			await harness.write('assets/source/reference.png', 'imported-source');
			const source = importBaseHalfNodeResult(createBaseHalfNodeDocument({
				id: baseHalfNodeTestId(2),
				kind: 'image',
				title: 'Source',
				role: 'reference'
			}), {
				id: 'source-artifact',
				outputId: 'imported',
				kind: 'image',
				path: 'assets/source/reference.png',
				sha256: await sha256('imported-source'),
				size: 15
			});
			await harness.writeNode('source.bhnode', source);
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode', [
				{ sourcePath: 'source.bhnode', slot: 'reference', order: 0 }
			]));
			harness.registerExecutor(async request => {
				assert.strictEqual((await harness.fileService.readFile(request.inputs[0].source.result!.resource)).value.toString(), 'imported-source');
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('frame-result'), { overwrite: false });
				return {
					artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact }
				};
			});

			const expectedRevision = await harness.service.getInputRevision(harness.workspaceFolder, 'source.bhnode');
			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(result.attempts[0].inputs[0].revision, expectedRevision);
			assert.match(expectedRevision, /^v1;imported=[A-Za-z0-9_-]{43};artifact=[A-Za-z0-9_-]{43};sha256=[A-Za-z0-9_-]{43}$/);
		} finally {
			await harness.dispose();
		}
	});

	test('records cancellation and interruption as terminal Attempts without a Result', async () => {
		const cancelledHarness = await createHarness(imageRecipe());
		try {
			await cancelledHarness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let started!: () => void;
			const didStart = new Promise<void>(resolve => { started = resolve; });
			cancelledHarness.registerExecutor(async (_request, _progress, token) => {
				started();
				return new Promise((_resolve, reject) => {
					const listener = token.onCancellationRequested(() => {
						listener.dispose();
						reject(new CancellationError());
					});
				});
			});
			const execution = cancelledHarness.service.run(cancelledHarness.node('frame.bhnode'));
			await didStart;
			const active = cancelledHarness.service.getActiveRun(cancelledHarness.resource('frame.bhnode'))!;
			assert.strictEqual(cancelledHarness.service.cancel(active.resource, active.runId), true);
			const cancelled = await execution;
			assert.deepStrictEqual({ status: cancelled.attempts[0].status, result: cancelled.result }, { status: 'cancelled', result: undefined });
		} finally {
			await cancelledHarness.dispose();
		}

		const interruptedHarness = await createHarness(imageRecipe());
		try {
			const initial = beginBaseHalfNodeAttempt(nodeDocument('frame.bhnode'), {
				id: 'abandoned-attempt',
				createdAt: '2026-08-13T00:00:00Z',
				startedAt: '2026-08-13T00:00:00Z',
				model: { source: 'local' },
				inputs: []
			});
			await interruptedHarness.writeNode('frame.bhnode', initial);
			const recovered = await interruptedHarness.service.recoverInterrupted(interruptedHarness.node('frame.bhnode'));
			assert.deepStrictEqual({
				status: recovered.attempts[0].status,
				error: recovered.attempts[0].error,
				result: recovered.result
			}, {
				status: 'interrupted',
				error: 'The previous execution host stopped before this run completed.',
				result: undefined
			});
		} finally {
			await interruptedHarness.dispose();
		}
	});

	test('keeps a cancelled Attempt sealed against a non-cooperative late success and permits one safe Retry', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let calls = 0;
			let firstRequest: IBaseHalfCanvasRecipeExecutionRequest | undefined;
			let firstStarted!: () => void;
			const firstDidStart = new Promise<void>(resolve => { firstStarted = resolve; });
			let resolveLateSuccess!: () => void;
			const lateSuccess = new Promise<void>(resolve => { resolveLateSuccess = resolve; });
			let firstSettled!: () => void;
			const firstDidSettle = new Promise<void>(resolve => { firstSettled = resolve; });
			harness.registerExecutor(async request => {
				calls++;
				if (calls === 1) {
					firstRequest = request;
					firstStarted();
					await lateSuccess;
					const artifact = URI.joinPath(request.outputDirectory, 'late.png');
					await harness.fileService.createFile(artifact, VSBuffer.fromString('late-result'), { overwrite: false });
					firstSettled();
					return { artifact: { id: 'late', outputId: 'result', kind: 'image', resource: artifact } };
				}
				const artifact = URI.joinPath(request.outputDirectory, 'retry.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('retry-result'), { overwrite: false });
				return { artifact: { id: 'retry', outputId: 'result', kind: 'image', resource: artifact } };
			});

			const execution = harness.service.run(harness.node('frame.bhnode'));
			await firstDidStart;
			const active = harness.service.getActiveRun(harness.resource('frame.bhnode'))!;
			assert.strictEqual(harness.service.cancel(active.resource, 'wrong-attempt-id'), false);
			assert.strictEqual(harness.service.cancel(active.resource, active.runId), true);
			assert.strictEqual(harness.service.cancel(active.resource, active.runId), true);
			const cancelled = await execution;
			const nodeAfterCancel = await harness.read('frame.bhnode');

			resolveLateSuccess();
			await firstDidSettle;
			await Promise.resolve();
			assert.ok(firstRequest);
			const lateArtifact = URI.joinPath(firstRequest.outputDirectory, 'late.png');
			assert.deepStrictEqual({
				attempts: cancelled.attempts.map(attempt => attempt.status),
				result: cancelled.result,
				nodeUnchangedAfterLateSuccess: await harness.read('frame.bhnode') === nodeAfterCancel,
				lateArtifactExistsButIsUnbound: await harness.fileService.exists(lateArtifact)
			}, {
				attempts: ['cancelled'],
				result: undefined,
				nodeUnchangedAfterLateSuccess: true,
				lateArtifactExistsButIsUnbound: true
			});

			const retried = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({
				calls,
				statuses: retried.attempts.map(attempt => attempt.status),
				resultAttemptId: retried.result?.source === 'attempt' ? retried.result.attemptId : undefined,
				artifactId: getBaseHalfNodeResultArtifact(retried)?.id
			}, {
				calls: 2,
				statuses: ['cancelled', 'succeeded'],
				resultAttemptId: retried.attempts[1].id,
				artifactId: 'retry'
			});
		} finally {
			await harness.dispose();
		}
	});

	test('linearizes cancellation against an in-flight sealed Result commit', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('committed-result'), { overwrite: false });
				return { artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact } };
			});

			let releaseCommit!: () => void;
			const commitRelease = new Promise<void>(resolve => { releaseCommit = resolve; });
			let resultCommitStarted!: () => void;
			const resultCommitDidStart = new Promise<void>(resolve => { resultCommitStarted = resolve; });
			let blocked = false;
			harness.setConditionalWriteHook(async (_resource, contents) => {
				if (blocked) {
					return;
				}
				const candidate = JSON.parse(contents.toString()) as IBaseHalfNodeDocument;
				if (!candidate.result) {
					return;
				}
				blocked = true;
				resultCommitStarted();
				await commitRelease;
			});

			const execution = harness.service.run(harness.node('frame.bhnode'));
			await resultCommitDidStart;
			const active = harness.service.getActiveRun(harness.resource('frame.bhnode'))!;
			// Result commit won the synchronous linearization point. A cancellation
			// must now report false instead of claiming that it can prevent sealing.
			assert.strictEqual(harness.service.cancel(active.resource, active.runId), false);
			releaseCommit();
			const result = await execution;

			assert.deepStrictEqual({
				status: result.attempts[0].status,
				artifactId: getBaseHalfNodeResultArtifact(result)?.id,
				persisted: JSON.parse(await harness.read('frame.bhnode'))
			}, {
				status: 'succeeded',
				artifactId: 'frame',
				persisted: result
			});
		} finally {
			await harness.dispose();
		}
	});

	test('does not offer a false Retry after cancellation before the model snapshot was frozen', async () => {
		const descriptor = modelServiceDescriptor('A');
		const harness = await createHarness(modelImageRecipe(), [], [descriptor]);
		try {
			await harness.writeNode('frame.bhnode', createBaseHalfNodeDocument({
				id: frameNodeId,
				kind: 'image',
				title: 'Frame',
				role: 'result',
				recipe: {
					recipeId: modelImageRecipe().id,
					modelServiceId: descriptor.id,
					modelId: 'image-v1',
					parameters: {},
					inputBindings: []
				}
			}));
			let providerCalls = 0;
			harness.registerExecutor(async request => {
				providerCalls++;
				const artifact = URI.joinPath(request.outputDirectory, 'unexpected.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('unexpected'), { overwrite: false });
				return { artifact: { id: 'unexpected', outputId: 'result', kind: 'image', resource: artifact } };
			});
			let modelCheckStarted!: () => void;
			const modelCheckDidStart = new Promise<void>(resolve => { modelCheckStarted = resolve; });
			let resolveModelCheck!: (services: readonly IBaseHalfModelServiceDescriptor[]) => void;
			const modelCheck = new Promise<readonly IBaseHalfModelServiceDescriptor[]>(resolve => { resolveModelCheck = resolve; });
			harness.setModelServicesResolver(() => {
				modelCheckStarted();
				return modelCheck;
			});

			const execution = harness.service.run(harness.node('frame.bhnode'));
			await modelCheckDidStart;
			const active = harness.service.getActiveRun(harness.resource('frame.bhnode'))!;
			assert.strictEqual(harness.service.cancel(active.resource, active.runId), true);
			await Promise.resolve();
			resolveModelCheck([descriptor]);
			const cancelled = await execution;
			harness.setModelServices([descriptor]);

			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode')),
				/Retry requires the unchanged frozen Recipe, inputs, and model connection\. Copy settings to a new Draft\./
			);
			assert.deepStrictEqual({
				providerCalls,
				attempts: cancelled.attempts.map(attempt => ({ status: attempt.status, model: attempt.model, inputs: attempt.inputs })),
				persistedAttemptCount: (JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument).attempts.length
			}, {
				providerCalls: 0,
				attempts: [{
					status: 'cancelled',
					model: { source: 'service', connection: 'unavailable', serviceId: descriptor.id, capability: 'image', modelId: 'image-v1' },
					inputs: []
				}],
				persistedAttemptCount: 1
			});
		} finally {
			await harness.dispose();
		}
	});

	test('copies one imported file into the node asset folder without replacing node state', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			const empty = createBaseHalfNodeDocument({
				id: frameNodeId,
				kind: 'image',
				title: 'Imported frame',
				role: 'result'
			});
			await harness.writeNode('frame.bhnode', empty);
			await harness.writeExternal('frame.png', 'imported-image');
			const target = URI.joinPath(baseHalfNodeImportedAssetDirectory(harness.workspaceFolder, frameNodeId), 'frame.png');
			const artifact = await harness.service.copyImportedResult(
				harness.workspaceFolder,
				harness.external('frame.png'),
				target,
				'image'
			);

			assert.deepStrictEqual({
				artifact: { ...artifact, id: '<generated>' },
				bytes: (await harness.fileService.readFile(target)).value.toString(),
				node: JSON.parse(await harness.read('frame.bhnode'))
			}, {
				artifact: {
					id: '<generated>',
					outputId: 'imported',
					kind: 'image',
					path: `assets/${frameNodeId}/frame.png`,
					sha256: await sha256('imported-image'),
					size: 14,
					label: 'frame.png'
				},
				bytes: 'imported-image',
				node: empty
			});
		} finally {
			await harness.dispose();
		}
	});
});

class TestHarness {
	readonly workspaceFolder: URI;
	readonly fileService: TestFileService;
	readonly service: BaseHalfNodeExecutionService;
	readonly fileSystemProvider: TestFileSystemProvider;

	private readonly disposables = new DisposableStore();
	private readonly registry = this.disposables.add(new BaseHalfCanvasRecipeRegistryService());
	private readonly videoModels = this.disposables.add(new BaseHalfVideoModelCatalogService());
	private readonly extensionService = new TestExtensionService();
	private readonly runtime: BaseHalfCanvasRecipeRuntimeService;
	private readonly workingCopyService: IWorkingCopyService;
	private executor: IDisposable | undefined;
	private modelServices: readonly IBaseHalfModelServiceDescriptor[];
	private modelServicesResolver: () => Promise<readonly IBaseHalfModelServiceDescriptor[]>;
	private checksumHook: ((resource: URI) => Promise<void>) | undefined;

	constructor(
		private readonly recipe: IBaseHalfCanvasRecipeContribution,
		references: readonly { source: string; target: string }[],
		modelServices: readonly IBaseHalfModelServiceDescriptor[]
	) {
		this.modelServices = modelServices;
		this.modelServicesResolver = () => Promise.resolve(this.modelServices);
		this.workspaceFolder = URI.from({ scheme: 'basehalf-node-test', path: '/workspace' });
		const fileService = this.disposables.add(new TestFileService(new NullLogService()));
		this.fileSystemProvider = this.disposables.add(new TestFileSystemProvider());
		this.disposables.add(fileService.registerProvider(this.workspaceFolder.scheme, this.fileSystemProvider));
		this.fileService = fileService;
		this.disposables.add(this.registry.registerRecipe('test.workflow', recipe));
		this.runtime = this.disposables.add(new BaseHalfCanvasRecipeRuntimeService(this.registry, this.extensionService));
		const dirtyResources = new Set<string>();
		this.workingCopyService = {
			isDirty: (resource: URI) => dirtyResources.has(resource.toString()),
			get dirtyWorkingCopies() {
				return [...dirtyResources].map(value => ({ resource: URI.parse(value) }));
			}
		} as never;
		const modelServicesService = { getServices: () => this.modelServicesResolver() } as Partial<IBaseHalfModelServiceService> as IBaseHalfModelServiceService;
		this.service = this.disposables.add(new BaseHalfNodeExecutionService(
			this.fileService,
			badgeGraphService(references),
			this.registry,
			this.runtime,
			modelServicesService,
			this.videoModels,
			this.extensionService,
			new TestChecksumService(fileService, resource => this.checksumHook?.(resource)),
			this.workingCopyService
		));
	}

	async initialize(): Promise<void> {
		await this.fileService.createFolder(this.workspaceFolder);
		await this.fileService.createFolder(this.resource('.bh'));
		await this.fileService.createFolder(this.external(''));
	}

	resource(path: string): URI {
		return URI.joinPath(this.workspaceFolder, ...path.split('/').filter(Boolean));
	}

	external(path: string): URI {
		return URI.from({ scheme: this.workspaceFolder.scheme, path: `/downloads${path ? `/${path}` : ''}` });
	}

	node(relativePath: string): IBaseHalfWorkspaceResource {
		return { resource: this.resource(relativePath), workspaceFolder: this.workspaceFolder, relativePath };
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

	registerExecutor(execute: IBaseHalfCanvasRecipeRuntimeProvider['execute']): void {
		assert.strictEqual(this.executor, undefined);
		this.executor = this.runtime.registerExecutor(this.recipe.id, { extensionId: 'test.workflow', execute });
	}

	registerVideoCatalog(value: unknown, extensionId = 'test.workflow'): void {
		this.disposables.add(this.videoModels.registerCatalog(extensionId, `${extensionId}.models`, value));
	}

	setModelServices(modelServices: readonly IBaseHalfModelServiceDescriptor[]): void {
		this.modelServices = modelServices;
		this.modelServicesResolver = () => Promise.resolve(this.modelServices);
	}

	setModelServicesResolver(resolver: () => Promise<readonly IBaseHalfModelServiceDescriptor[]>): void {
		this.modelServicesResolver = resolver;
	}

	setChecksumHook(hook: (resource: URI) => Promise<void>): void {
		this.checksumHook = hook;
	}

	setConditionalWriteHook(hook: (resource: URI, contents: VSBuffer) => Promise<void>): void {
		this.fileService.conditionalWriteHook = hook;
	}

	async dispose(): Promise<void> {
		this.executor?.dispose();
		this.executor = undefined;
		this.disposables.dispose();
	}
}

class TestFileService extends FileService {
	conditionalWriteHook: ((resource: URI, contents: VSBuffer) => Promise<void>) | undefined;

	override async writeFileWithExpectedContents(
		resource: URI,
		contents: VSBuffer,
		expectedContents: VSBuffer | null,
		options: IWriteFileWithExpectedContentsOptions
	): Promise<IFileStatWithMetadata> {
		await this.conditionalWriteHook?.(resource, contents);
		return super.writeFileWithExpectedContents(resource, contents, expectedContents, options);
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
	path: 'frame.bhnode' | 'source.bhnode',
	inputBindings: readonly { sourcePath: string; slot: string; order: number }[] = []
): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({
		id: path === 'frame.bhnode' ? baseHalfNodeTestId(1) : baseHalfNodeTestId(2),
		kind: 'image',
		title: path === 'frame.bhnode' ? 'Frame' : 'Source',
		role: 'result',
		prompt: 'Render the frozen frame intent.',
		recipe: { recipeId: imageReferenceRecipe().id, parameters: {}, inputBindings }
	});
}

function imageRecipe(): IBaseHalfCanvasRecipeContribution {
	return {
		id: 'test.workflow.transform-image',
		label: 'Transform image',
		inputs: [{ id: 'reference', label: 'Reference', accepts: ['image'], minItems: 0, maxItems: 1 }],
		outputs: [{ id: 'result', kind: 'image', extensions: ['.png'], minItems: 1, maxItems: 1, primary: true }]
	};
}

function imageReferenceRecipe(): IBaseHalfCanvasRecipeContribution {
	return imageRecipe();
}

function textReferenceRecipe(): IBaseHalfCanvasRecipeContribution {
	return {
		...imageRecipe(),
		inputs: [{ id: 'reference', label: 'Reference', accepts: ['text'], minItems: 1, maxItems: 1 }]
	};
}

function modelImageRecipe(): IBaseHalfCanvasRecipeContribution {
	return { ...imageRecipe(), modelCapability: 'image', inputs: [] };
}

function videoRecipe(): IBaseHalfCanvasRecipeContribution {
	return {
		id: 'test.workflow.generate-video',
		label: 'Generate video',
		modelCapability: 'video',
		videoModelCatalogId: 'test.workflow.models',
		inputs: [],
		outputs: [{ id: 'result', kind: 'video', extensions: ['.mp4'], minItems: 1, maxItems: 1, primary: true }]
	};
}

function localVideoRecipe(): IBaseHalfCanvasRecipeContribution {
	return {
		id: 'test.workflow.render-local-video',
		label: 'Render local video',
		inputs: [],
		parameters: [{ id: 'fps', label: 'FPS', type: 'number', default: 24, minimum: 1, maximum: 60, step: 1 }],
		outputs: [{ id: 'result', kind: 'video', extensions: ['.mp4'], minItems: 1, maxItems: 1, primary: true }]
	};
}

function videoNodeDocument(revision: string, id: string = baseHalfNodeTestId(1)): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({
		id,
		kind: 'video',
		title: 'Clip',
		role: 'result',
		prompt: 'Create a cinematic camera move.',
		recipe: {
			recipeId: videoRecipe().id,
			modelServiceId: 'studio.video',
			modelId: 'seedance-1.5-pro',
			parameters: {
				generationMode: 'text-to-video',
				resolution: '720P',
				duration: 5,
				[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID]: videoModelSnapshot(revision)
			},
			inputBindings: []
		}
	});
}

function videoModelSnapshot(revision: string) {
	return {
		schemaVersion: 1,
		catalogId: 'test.workflow.models',
		providerId: 'byteplus',
		deploymentId: 'global',
		region: 'ap-southeast-1',
		modelId: 'seedance-1.5-pro',
		revision,
		mode: 'text-to-video',
		inputs: { 'text-prompt': 1 }
	};
}

function videoModelCatalog() {
	return {
		schemaVersion: 1,
		models: [{
			key: {
				provider: 'byteplus',
				deployment: 'global',
				region: 'ap-southeast-1',
				modelId: 'seedance-1.5-pro',
				revision: '2026-08-16'
			},
			label: 'Seedance 1.5 Pro',
			source: {
				url: 'https://docs.byteplus.com/en/docs/modelark/1520757',
				verifiedAt: '2026-08-16'
			},
			modes: [{
				mode: 'text-to-video',
				inputs: [{ kind: 'text-prompt', minItems: 1, maxItems: 1, maxCharacters: 1_500 }],
				parameters: [{
					id: 'resolution',
					label: 'Resolution',
					type: 'enum',
					default: '720P',
					options: [{ value: '720P', label: '720P' }]
				}, {
					id: 'duration',
					label: 'Duration',
					type: 'enum',
					default: 5,
					options: [{ value: 5, label: '5s' }, { value: 10, label: '10s' }]
				}],
				constraints: []
			}]
		}]
	};
}

function videoModelServiceDescriptor(): IBaseHalfModelServiceDescriptor {
	return {
		id: 'studio.video',
		specId: 'pointa.video.studio',
		label: 'Studio Video',
		endpoint: 'https://video.example.invalid/v1',
		providerId: 'byteplus',
		deploymentId: 'global',
		region: 'ap-southeast-1',
		capabilities: ['video'],
		authorization: 'bearer',
		publicValues: {},
		connectionIdentity: `sha256:${'V'.repeat(43)}`,
		configured: true
	};
}

function videoAttemptOptions(): Parameters<typeof beginBaseHalfNodeAttempt>[1] {
	return {
		id: baseHalfNodeTestId(9),
		createdAt: '2026-08-16T10:00:00Z',
		startedAt: '2026-08-16T10:00:00Z',
		model: {
			source: 'service',
			connection: 'resolved',
			serviceId: 'studio.video',
			serviceLabel: 'Studio Video',
			connectionIdentity: `sha256:${'V'.repeat(43)}`,
			capability: 'video',
			modelId: 'seedance-1.5-pro'
		},
		inputs: []
	};
}

function modelServiceDescriptor(identity: 'A' | 'B'): IBaseHalfModelServiceDescriptor {
	return {
		id: 'studio.image',
		specId: 'pointa.image.studio',
		label: 'Studio Image',
		endpoint: 'https://images.example.invalid/v1',
		providerId: 'example',
		deploymentId: 'global',
		region: 'global',
		capabilities: ['image'],
		authorization: 'bearer',
		publicValues: {},
		connectionIdentity: `sha256:${identity.repeat(43)}`,
		configured: true
	};
}

class TestChecksumService implements IChecksumService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly fileService: IFileService,
		private readonly afterDigest?: (resource: URI) => Promise<void> | undefined
	) { }

	async checksum(resource: URI): Promise<string> {
		const content = (await this.fileService.readFile(resource)).value;
		const digest = await globalThis.crypto.subtle.digest('SHA-256', content.buffer);
		await this.afterDigest?.(resource);
		return encodeBase64(VSBuffer.wrap(new Uint8Array(digest)), false);
	}
}

class TestFileSystemProvider extends InMemoryFileSystemProvider {
	private readonly symbolicLinks = new Set<string>();
	private readonly realpaths = new Map<string, string>();

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities | FileSystemProviderCapabilities.FileRealpath;
	}

	override async stat(resource: URI): Promise<IStat> {
		const stat = await super.stat(resource);
		return this.symbolicLinks.has(resource.toString()) ? { ...stat, type: stat.type | FileType.SymbolicLink } : stat;
	}

	async realpath(resource: URI): Promise<string> {
		return this.realpaths.get(resource.toString()) ?? resource.path;
	}

	markSymbolicLink(resource: URI): void {
		this.symbolicLinks.add(resource.toString());
	}

	setRealpath(resource: URI, realpath: string): void {
		this.realpaths.set(resource.toString(), realpath);
	}
}

async function createHarness(
	recipe: IBaseHalfCanvasRecipeContribution,
	references: readonly { source: string; target: string }[] = [],
	modelServices: readonly IBaseHalfModelServiceDescriptor[] = []
): Promise<TestHarness> {
	const harness = new TestHarness(recipe, references, modelServices);
	await harness.initialize();
	return harness;
}

async function sha256(value: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return encodeBase64(VSBuffer.wrap(new Uint8Array(digest)), false, true);
}
