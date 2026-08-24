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
	freezeBaseHalfNodeAttemptExecution,
	freezeBaseHalfNodeAttemptProviderRequestId,
	freezeBaseHalfNodeAttemptSnapshotManifest,
	getBaseHalfNodeResultArtifact,
	IBaseHalfNodeDocument,
	importBaseHalfNodeResult,
	serializeBaseHalfNodeDocument
} from '../../common/basehalfNodeDocument.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';

suite('BaseHalfNodeExecutionService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const frameNodeId = baseHalfNodeTestId(1);
	const validMp4 = '\u0000\u0000\u0000\u000cftypisom';

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

	test('sanitizes extension progress before exposing active host state', async () => {
		const harness = await createHarness(imageRecipe());
		const visibleMessages: string[] = [];
		const listener = harness.service.onDidChange(event => {
			if (event.state?.message) {
				visibleMessages.push(event.state.message);
			}
		});
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			const secret = 'progress-secret-that-must-not-be-visible';
			harness.registerExecutor(async (request, progress) => {
				progress.report({
					message: `Working\u0000\nhttps://provider.example/task?token=${secret} Authorization: Bearer ${secret}`,
					increment: 25
				});
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('frame'), { overwrite: false });
				return { artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact } };
			});

			await harness.service.run(harness.node('frame.bhnode'));
			assert.ok(visibleMessages.some(message => message.startsWith('Working')));
			assert.strictEqual(visibleMessages.some(message => message.includes(secret)), false);
			assert.strictEqual(visibleMessages.some(message => /[\u0000-\u001F\u007F-\u009F]/.test(message)), false);
			assert.strictEqual(visibleMessages.some(message => message.includes('provider.example')), false);
		} finally {
			listener.dispose();
			await harness.dispose();
		}
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

	test('serializes repeated Generate into one active lease and one Attempt', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let started!: () => void;
			const didStart = new Promise<void>(resolve => { started = resolve; });
			let release!: () => void;
			const released = new Promise<void>(resolve => { release = resolve; });
			let calls = 0;
			harness.registerExecutor(async request => {
				calls++;
				started();
				await released;
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('frame'), { overwrite: false });
				return { artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact } };
			});

			const first = harness.service.run(harness.node('frame.bhnode'));
			await didStart;
			await assert.rejects(() => harness.service.run(harness.node('frame.bhnode')), /already has an active run/);
			release();
			const completed = await first;
			assert.deepStrictEqual({ calls, attempts: completed.attempts.length, status: completed.attempts[0].status }, {
				calls: 1,
				attempts: 1,
				status: 'succeeded'
			});
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

	test('rejects replacement of a resumed task id without an exact Retry authorization', async () => {
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
				providerRequestId: attempt.providerRequestId,
				failure: attempt.failure
			})), [
				{ status: 'failed', providerRequestId: 'provider/task-terminal', failure: undefined },
				{
					status: 'interrupted',
					providerRequestId: 'provider/task-terminal',
					failure: {
						kind: 'remote-id-uncommitted',
						retry: 'blocked',
						uncommittedProviderRequestId: 'provider/task-replacement'
					}
				}
			]);
			assert.strictEqual(result.result, undefined);
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
				firstRemoved: !await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${result.attempts[0].id}/artifacts/first.png`)),
				secondRemoved: !await harness.fileService.exists(harness.resource(`outputs/${frameNodeId}/${result.attempts[0].id}/artifacts/second.png`))
			}, {
				status: 'failed',
				error: 'BaseHalf canvas recipe \'test.workflow.transform-image\' returned an invalid result.',
				result: undefined,
				firstRemoved: true,
				secondRemoved: true
			});
		} finally {
			await harness.dispose();
		}
	});

	test('removes unsealed output when an executor returns one artifact but writes an extra file', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			harness.registerExecutor(async request => {
				const artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('frame'), { overwrite: false });
				await harness.fileService.createFile(URI.joinPath(request.outputDirectory, 'unexpected.tmp'), VSBuffer.fromString('extra'), { overwrite: false });
				return { artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact } };
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			const runDirectory = harness.resource(`outputs/${frameNodeId}/${result.attempts[0].id}`);
			assert.deepStrictEqual({
				status: result.attempts[0].status,
				error: result.attempts[0].error,
				result: result.result,
				runRemoved: !await harness.fileService.exists(runDirectory)
			}, {
				status: 'failed',
				error: 'The recipe output directory contains an unexpected extra file.',
				result: undefined,
				runRemoved: true
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

	test('does not acknowledge or poll a new provider task after an acknowledgement CAS conflict', async () => {
		const harness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoModelCatalog());
			await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			let continuedAfterAcknowledgement = false;
			harness.registerExecutor(async request => {
				await request.consumeProviderCreateAuthorization!(request.providerRequestFingerprint!, request.attemptId, 'new');
				await request.acknowledgeProviderRequestId('provider/video-uncommitted');
				continuedAfterAcknowledgement = true;
				throw new Error('A conflicted acknowledgement must stop provider polling.');
			});
			let conflicted = false;
			harness.setConditionalWriteHook(async (resource, contents) => {
				if (conflicted || !resource.path.endsWith('/frame.bhnode')) {
					return;
				}
				const candidate = JSON.parse(contents.toString()) as IBaseHalfNodeDocument;
				if (candidate.attempts.at(-1)?.providerRequestId !== 'provider/video-uncommitted') {
					return;
				}
				conflicted = true;
				const current = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
				await harness.writeNode('frame.bhnode', { ...current, title: 'Externally renamed before acknowledgement' });
			});

			const result = await harness.service.run(harness.node('frame.bhnode'), await harness.providerRunOptions('frame.bhnode'));
			assert.deepStrictEqual({
				conflicted,
				continuedAfterAcknowledgement,
				title: result.title,
				status: result.attempts[0].status,
				providerRequestId: result.attempts[0].providerRequestId,
				failure: result.attempts[0].failure,
				result: result.result
			}, {
				conflicted: true,
				continuedAfterAcknowledgement: false,
				title: 'Externally renamed before acknowledgement',
				status: 'interrupted',
				providerRequestId: undefined,
				failure: {
					kind: 'remote-id-uncommitted',
					retry: 'blocked',
					uncommittedProviderRequestId: 'provider/video-uncommitted'
				},
				result: undefined
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

	test('requires the exact prepared fingerprint and rejects a bare authorization boolean before Attempt', async () => {
		const harness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoModelCatalog());
			await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			let providerCalls = 0;
			harness.registerExecutor(async () => {
				providerCalls++;
				throw new Error('The provider must not run without current user authorization.');
			});

			for (const options of [{}, { newTaskAuthorized: true }]) {
				await assert.rejects(
					() => harness.service.run(harness.node('frame.bhnode'), options),
					/exact current preflight fingerprint and one-use user authorization/
				);
			}
			const preflight = await harness.service.prepareProviderRun(harness.node('frame.bhnode'));
			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode'), {
					providerAuthorization: {
						kind: 'replacement',
						requestFingerprint: preflight.requestFingerprint
					}
				}),
				/does not match the current immutable preflight fingerprint/
			);
			assert.strictEqual(providerCalls, 0);
			assert.strictEqual((JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument).attempts.length, 0);
		} finally {
			await harness.dispose();
		}
	});

	test('rejects a prepared provider authorization after the saved Draft drifts', async () => {
		const harness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoModelCatalog());
			const original = videoNodeDocument('2026-08-16');
			await harness.writeNode('frame.bhnode', original);
			let providerCalls = 0;
			harness.registerExecutor(async () => {
				providerCalls++;
				throw new Error('A drifted authorization must not reach the provider.');
			});
			const preflight = await harness.service.prepareProviderRun(harness.node('frame.bhnode'));
			await harness.writeNode('frame.bhnode', { ...original, prompt: 'Use a different approved camera move.' });

			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode'), {
					providerAuthorization: {
						kind: preflight.authorizationKind,
						requestFingerprint: preflight.requestFingerprint
					}
				}),
				/does not match the current immutable preflight fingerprint/
			);
			assert.strictEqual(providerCalls, 0);
			assert.strictEqual((JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument).attempts.length, 0);
		} finally {
			await harness.dispose();
		}
	});

	test('records post-commit input drift before any provider create or executor handoff', async () => {
		const references = [{ source: 'source.bhnode', target: 'clip.bhnode' }];
		const harness = await createHarness(videoFirstFrameRecipe(), references, [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoFirstFrameModelCatalog());
			const sourceBytes = 'stable-preflight-image';
			await harness.fileService.createFolder(harness.resource('assets/source'));
			await harness.write('assets/source/reference.png', sourceBytes);
			await harness.writeNode('source.bhnode', importBaseHalfNodeResult(createBaseHalfNodeDocument({
				id: baseHalfNodeTestId(2),
				kind: 'image',
				title: 'Source',
				role: 'first-frame'
			}), {
				id: 'source-artifact',
				outputId: 'imported',
				kind: 'image',
				path: 'assets/source/reference.png',
				sha256: await sha256(sourceBytes),
				size: new TextEncoder().encode(sourceBytes).byteLength
			}));
			await harness.writeNode('clip.bhnode', videoFirstFrameNodeDocument('2026-08-16'));
			let executorCalls = 0;
			harness.registerExecutor(async () => {
				executorCalls++;
				throw new Error('Input drift must stop before executor handoff.');
			});
			const options = await harness.providerRunOptions('clip.bhnode');
			let changed = false;
			harness.setConditionalWriteHook(async (resource, contents) => {
				if (changed || !resource.path.endsWith('/clip.bhnode')) {
					return;
				}
				const candidate = JSON.parse(contents.toString()) as IBaseHalfNodeDocument;
				if (candidate.attempts.at(-1)?.status !== 'running') {
					return;
				}
				changed = true;
				await harness.write('assets/source/reference.png', 'changed-after-attempt-commit');
			});

			const result = await harness.service.run(harness.node('clip.bhnode'), options);
			assert.deepStrictEqual({
				changed,
				executorCalls,
				attempts: result.attempts.length,
				status: result.attempts[0].status,
				failure: result.attempts[0].failure,
				result: result.result
			}, {
				changed: true,
				executorCalls: 0,
				attempts: 1,
				status: 'failed',
				failure: { kind: 'preparation', retry: 'fresh-submit' },
				result: undefined
			});
		} finally {
			await harness.dispose();
		}
	});

	test('completes connection and executor preflight before creating a video Attempt', async () => {
		const unavailableConnection = { ...videoModelServiceDescriptor(), configured: false };
		const credentialHarness = await createHarness(videoRecipe(), [], [unavailableConnection]);
		try {
			credentialHarness.registerVideoCatalog(videoModelCatalog());
			await credentialHarness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			await assert.rejects(
				() => credentialHarness.service.prepareProviderRun(credentialHarness.node('frame.bhnode')),
				/needs an API key/
			);
			assert.strictEqual((JSON.parse(await credentialHarness.read('frame.bhnode')) as IBaseHalfNodeDocument).attempts.length, 0);
			assert.strictEqual(await credentialHarness.fileService.exists(credentialHarness.resource('outputs')), false);
		} finally {
			await credentialHarness.dispose();
		}

		const executorHarness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
		try {
			executorHarness.registerVideoCatalog(videoModelCatalog());
			await executorHarness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			await assert.rejects(
				() => executorHarness.service.prepareProviderRun(executorHarness.node('frame.bhnode')),
				/executor is unavailable/
			);
			assert.strictEqual((JSON.parse(await executorHarness.read('frame.bhnode')) as IBaseHalfNodeDocument).attempts.length, 0);
			assert.strictEqual(await executorHarness.fileService.exists(executorHarness.resource('outputs')), false);
		} finally {
			await executorHarness.dispose();
		}
	});

	test('revalidates canonical reviewed video settings before invoking the provider', async () => {
		const descriptor = videoModelServiceDescriptor();
		const harness = await createHarness(videoRecipe(), [], [descriptor]);
		try {
			harness.registerVideoCatalog(videoModelCatalog());
			await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			let providerCalls = 0;
			let preparedFingerprint: string | undefined;
			let executorRequest: IBaseHalfCanvasRecipeExecutionRequest | undefined;
			harness.registerExecutor(async request => {
				providerCalls++;
				executorRequest = request;
				const committed = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
				assert.deepStrictEqual({
					status: committed.attempts[0]?.status,
					model: committed.attempts[0]?.model,
					execution: committed.attempts[0]?.execution
				}, {
					status: 'running',
					model: {
						source: 'service',
						connection: 'resolved',
						serviceId: descriptor.id,
						serviceLabel: descriptor.label,
						connectionIdentity: descriptor.connectionIdentity,
						capability: 'video',
						modelId: 'seedance-1.5-pro'
					},
					execution: {
						requestFingerprint: request.providerRequestFingerprint,
						intent: { kind: 'new' }
					}
				});
				assert.deepStrictEqual(request.providerTaskIntent, { kind: 'new' });
				assert.strictEqual(request.providerRequestFingerprint, preparedFingerprint);
				assert.match(request.providerRequestFingerprint ?? '', /^v1:[A-Za-z0-9_-]{43}$/);
				assert.ok(request.consumeProviderCreateAuthorization);
				await assert.rejects(
					() => request.consumeProviderCreateAuthorization!('v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', request.attemptId, 'new'),
					/does not match/
				);
				await request.consumeProviderCreateAuthorization(request.providerRequestFingerprint!, request.attemptId, 'new');
				await assert.rejects(
					() => request.consumeProviderCreateAuthorization!(request.providerRequestFingerprint!, request.attemptId, 'new'),
					/already been consumed/
				);
				await request.acknowledgeProviderRequestId('provider/video-1');
				const artifact = URI.joinPath(request.outputDirectory, 'clip.mp4');
				await harness.fileService.createFile(artifact, VSBuffer.fromString(validMp4), { overwrite: false });
				return {
					artifact: { id: 'clip', outputId: 'result', kind: 'video', resource: artifact },
					providerRequestId: 'provider/video-1'
				};
			});

			const preflight = await harness.service.prepareProviderRun(harness.node('frame.bhnode'));
			preparedFingerprint = preflight.requestFingerprint;
			assert.deepStrictEqual({
				authorizationKind: preflight.authorizationKind,
				document: preflight.document
			}, {
				authorizationKind: 'new',
				document: JSON.parse(await harness.read('frame.bhnode'))
			});
			const result = await harness.service.run(harness.node('frame.bhnode'), {
				providerAuthorization: {
					kind: preflight.authorizationKind,
					requestFingerprint: preflight.requestFingerprint
				}
			});
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
				execution: result.attempts[0].execution,
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
				execution: {
					requestFingerprint: executorRequest?.providerRequestFingerprint,
					intent: { kind: 'new' }
				},
				artifact: {
					id: 'clip',
					outputId: 'result',
					kind: 'video',
					path: `outputs/${frameNodeId}/${result.attempts[0].id}/artifacts/clip.mp4`,
					sha256: await sha256(validMp4),
					size: 12
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

	test('persists provider failure evidence and defaults exact Retry replacement authorization to false', async () => {
		const harness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoModelCatalog());
			await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			let calls = 0;
			let firstFingerprint: string | undefined;
			harness.registerExecutor(async request => {
				calls++;
				assert.strictEqual(request.resumeProviderRequestId, undefined);
				if (calls === 1) {
					assert.deepStrictEqual(request.providerTaskIntent, { kind: 'new' });
					firstFingerprint = request.providerRequestFingerprint;
					await request.consumeProviderCreateAuthorization!(request.providerRequestFingerprint!, request.attemptId, 'new');
					await request.acknowledgeProviderRequestId('provider/video-recover');
					await request.reportProviderExecutionFailure!({
						kind: 'poll-interrupted',
						retry: 'resume-existing',
						providerRequestId: 'provider/video-recover'
					});
					throw new Error('The provider read was interrupted.');
				}
				assert.deepStrictEqual(request.providerTaskIntent, {
					kind: 'exact-retry',
					sourceAttemptId: request.providerTaskIntent?.kind === 'exact-retry'
						? request.providerTaskIntent.sourceAttemptId
						: '',
					providerRequestId: 'provider/video-recover',
					sourceFailure: {
						kind: 'poll-interrupted',
						retry: 'resume-existing',
						providerRequestId: 'provider/video-recover'
					},
					replacementAuthorized: false
				});
				assert.strictEqual(request.consumeProviderCreateAuthorization, undefined);
				assert.notStrictEqual(request.providerRequestFingerprint, firstFingerprint);
				await request.acknowledgeProviderRequestId('provider/video-recover');
				const artifact = URI.joinPath(request.outputDirectory, 'clip.mp4');
				await harness.fileService.createFile(artifact, VSBuffer.fromString(validMp4), { overwrite: false });
				return {
					artifact: { id: 'clip', outputId: 'result', kind: 'video', resource: artifact },
					providerRequestId: 'provider/video-recover'
				};
			});

			const first = await harness.service.run(harness.node('frame.bhnode'), await harness.providerRunOptions('frame.bhnode'));
			assert.deepStrictEqual({
				status: first.attempts[0].status,
				providerRequestId: first.attempts[0].providerRequestId,
				failure: first.attempts[0].failure
			}, {
				status: 'interrupted',
				providerRequestId: 'provider/video-recover',
				failure: {
					kind: 'poll-interrupted',
					retry: 'resume-existing',
					providerRequestId: 'provider/video-recover'
				}
			});
			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.strictEqual(result.attempts[1].status, 'succeeded');
			assert.deepStrictEqual(result.attempts[1].execution?.intent, {
				kind: 'exact-retry',
				sourceAttemptId: first.attempts[0].id,
				providerRequestId: 'provider/video-recover',
				replacementAuthorized: false
			});
		} finally {
			await harness.dispose();
		}
	});

	test('copies exact Retry inputs from the source Attempt manifest without reading a changed direct source', async () => {
		const references = [{ source: 'source.bhnode', target: 'clip.bhnode' }];
		const harness = await createHarness(videoFirstFrameRecipe(), references, [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoFirstFrameModelCatalog());
			const sourceBytes = 'retry-frozen-source-image';
			await harness.fileService.createFolder(harness.resource('assets/source'));
			await harness.write('assets/source/reference.png', sourceBytes);
			const source = importBaseHalfNodeResult(createBaseHalfNodeDocument({
				id: baseHalfNodeTestId(2),
				kind: 'image',
				title: 'Source',
				role: 'first-frame'
			}), {
				id: 'source-artifact',
				outputId: 'imported',
				kind: 'image',
				path: 'assets/source/reference.png',
				sha256: await sha256(sourceBytes),
				size: new TextEncoder().encode(sourceBytes).byteLength
			});
			await harness.writeNode('source.bhnode', source);
			await harness.writeNode('clip.bhnode', videoFirstFrameNodeDocument('2026-08-16'));

			let calls = 0;
			const inputResources: URI[] = [];
			harness.registerExecutor(async request => {
				calls++;
				const inputResource = request.inputs[0].source.result!.resource;
				inputResources.push(inputResource);
				assert.strictEqual((await harness.fileService.readFile(inputResource)).value.toString(), sourceBytes);
				if (calls === 1) {
					assert.deepStrictEqual(request.providerTaskIntent, { kind: 'new' });
					await request.consumeProviderCreateAuthorization!(request.providerRequestFingerprint!, request.attemptId, 'new');
					await request.acknowledgeProviderRequestId('provider/exact-retry-source');
					await request.reportProviderExecutionFailure!({
						kind: 'poll-interrupted',
						retry: 'resume-existing',
						providerRequestId: 'provider/exact-retry-source'
					});
					throw new Error('Provider polling was interrupted.');
				}
				assert.strictEqual(request.providerTaskIntent?.kind, 'exact-retry');
				assert.strictEqual(request.providerTaskIntent?.kind === 'exact-retry'
					? request.providerTaskIntent.replacementAuthorized
					: undefined, false);
				assert.strictEqual(request.consumeProviderCreateAuthorization, undefined);
				await request.acknowledgeProviderRequestId('provider/exact-retry-source');
				const artifact = URI.joinPath(request.outputDirectory, 'retried.mp4');
				await harness.fileService.createFile(artifact, VSBuffer.fromString(validMp4), { overwrite: false });
				return {
					artifact: { id: 'retried', outputId: 'result', kind: 'video', resource: artifact },
					providerRequestId: 'provider/exact-retry-source'
				};
			});

			const first = await harness.service.run(harness.node('clip.bhnode'), await harness.providerRunOptions('clip.bhnode'));
			assert.strictEqual(first.attempts[0].status, 'interrupted');
			const sourceManifest = first.attempts[0].snapshotManifest!;
			await harness.write('assets/source/reference.png', 'mutable-source-changed-after-first-attempt');
			const retryPreflight = await harness.service.prepareProviderRun(harness.node('clip.bhnode'));
			assert.strictEqual(retryPreflight.authorizationKind, 'replacement');
			const retried = await harness.service.run(harness.node('clip.bhnode'));
			const retryAttempt = retried.attempts[1];
			const retryManifest = retryAttempt.snapshotManifest!;

			assert.deepStrictEqual({
				calls,
				statuses: retried.attempts.map(attempt => attempt.status),
				differentAttemptPaths: sourceManifest.frozenNodePath !== retryManifest.frozenNodePath
					&& sourceManifest.inputs[0].snapshotPath !== retryManifest.inputs[0].snapshotPath,
				sameFrozenDigests: sourceManifest.frozenNodeDigest === retryManifest.frozenNodeDigest
					&& sourceManifest.inputs[0].snapshotDigest === retryManifest.inputs[0].snapshotDigest,
				sameFrozenIdentity: {
					edgeId: retryManifest.inputs[0].edgeId,
					revision: retryManifest.inputs[0].revision,
					sourceId: retryManifest.inputs[0].sourceId,
					resultId: retryManifest.inputs[0].resultId
				},
				inputResourcesAreAttemptLocal: inputResources.length === 2
					&& inputResources[0].toString() !== inputResources[1].toString()
			}, {
				calls: 2,
				statuses: ['interrupted', 'succeeded'],
				differentAttemptPaths: true,
				sameFrozenDigests: true,
				sameFrozenIdentity: {
					edgeId: sourceManifest.inputs[0].edgeId,
					revision: sourceManifest.inputs[0].revision,
					sourceId: sourceManifest.inputs[0].sourceId,
					resultId: sourceManifest.inputs[0].resultId
				},
				inputResourcesAreAttemptLocal: true
			});
		} finally {
			await harness.dispose();
		}
	});

	test('rejects a changed exact Retry manifest payload before a new Attempt or provider call', async () => {
		const harness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoModelCatalog());
			await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			let providerCalls = 0;
			harness.registerExecutor(async request => {
				providerCalls++;
				await request.consumeProviderCreateAuthorization!(request.providerRequestFingerprint!, request.attemptId, 'new');
				await request.acknowledgeProviderRequestId('provider/tampered-retry');
				await request.reportProviderExecutionFailure!({
					kind: 'poll-interrupted',
					retry: 'resume-existing',
					providerRequestId: 'provider/tampered-retry'
				});
				throw new Error('Provider polling was interrupted.');
			});

			const first = await harness.service.run(harness.node('frame.bhnode'), await harness.providerRunOptions('frame.bhnode'));
			const frozenNodePath = first.attempts[0].snapshotManifest!.frozenNodePath;
			await harness.write(frozenNodePath, 'changed frozen declaration');
			await assert.rejects(
				() => harness.service.prepareProviderRun(harness.node('frame.bhnode')),
				/frozen node declaration failed integrity verification/
			);
			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode')),
				/frozen node declaration failed integrity verification/
			);
			const persisted = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.deepStrictEqual({
				providerCalls,
				attempts: persisted.attempts.map(attempt => attempt.id),
				statuses: persisted.attempts.map(attempt => attempt.status)
			}, {
				providerCalls: 1,
				attempts: [first.attempts[0].id],
				statuses: ['interrupted']
			});
		} finally {
			await harness.dispose();
		}
	});

	test('grants provider replacement only through the exact prepared retry fingerprint', async () => {
			const harness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
			try {
				harness.registerVideoCatalog(videoModelCatalog());
				await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
				let calls = 0;
				let replacementPreflightFingerprint: string | undefined;
				harness.registerExecutor(async request => {
					calls++;
					if (calls === 1) {
						await request.consumeProviderCreateAuthorization!(request.providerRequestFingerprint!, request.attemptId, 'new');
						await request.acknowledgeProviderRequestId('provider/video-terminal');
						await request.reportProviderExecutionFailure!({
							kind: 'remote-failed',
							retry: 'replace-after-terminal-proof',
							providerRequestId: 'provider/video-terminal'
						});
						throw new Error('The provider task failed.');
					}
					assert.deepStrictEqual(request.providerTaskIntent, {
						kind: 'exact-retry',
						sourceAttemptId: request.providerTaskIntent?.kind === 'exact-retry'
							? request.providerTaskIntent.sourceAttemptId
							: '',
						providerRequestId: 'provider/video-terminal',
						sourceFailure: {
							kind: 'remote-failed',
							retry: 'replace-after-terminal-proof',
							providerRequestId: 'provider/video-terminal'
						},
						replacementAuthorized: true
					});
					assert.strictEqual(request.providerRequestFingerprint, replacementPreflightFingerprint);
					await request.acknowledgeProviderRequestId('provider/video-terminal');
					await request.consumeProviderCreateAuthorization!(request.providerRequestFingerprint!, request.attemptId, 'replacement');
					await request.acknowledgeProviderRequestId('provider/video-replacement');
					const artifact = URI.joinPath(request.outputDirectory, 'clip.mp4');
					await harness.fileService.createFile(artifact, VSBuffer.fromString(validMp4), { overwrite: false });
					return {
						artifact: { id: 'clip', outputId: 'result', kind: 'video', resource: artifact },
						providerRequestId: 'provider/video-replacement'
					};
				});

				const first = await harness.service.run(harness.node('frame.bhnode'), await harness.providerRunOptions('frame.bhnode'));
				assert.strictEqual(first.attempts[0].status, 'failed');
				const retryPreflight = await harness.service.prepareProviderRun(harness.node('frame.bhnode'));
				replacementPreflightFingerprint = retryPreflight.requestFingerprint;
				assert.strictEqual(retryPreflight.authorizationKind, 'replacement');
				const result = await harness.service.run(harness.node('frame.bhnode'), {
					providerAuthorization: {
						kind: retryPreflight.authorizationKind,
						requestFingerprint: retryPreflight.requestFingerprint
					}
				});
				assert.strictEqual(calls, 2);
				assert.strictEqual(result.attempts[1].providerRequestId, 'provider/video-replacement');
				assert.strictEqual(result.attempts[1].execution?.intent.kind, 'exact-retry');
				assert.strictEqual(result.attempts[1].execution?.intent.kind === 'exact-retry'
					? result.attempts[1].execution.intent.replacementAuthorized
					: undefined, true);
			} finally {
				await harness.dispose();
			}
	});

	test('fails closed after an ambiguous provider submission without a durable task id', async () => {
		const harness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoModelCatalog());
			await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			let calls = 0;
			harness.registerExecutor(async request => {
				calls++;
				await request.consumeProviderCreateAuthorization!(request.providerRequestFingerprint!, request.attemptId, 'new');
				await request.reportProviderExecutionFailure!({ kind: 'submission-ambiguous', retry: 'blocked' });
				throw new Error('The provider submission outcome is unknown.');
			});

			const first = await harness.service.run(harness.node('frame.bhnode'), await harness.providerRunOptions('frame.bhnode'));
			assert.deepStrictEqual(first.attempts[0].failure, { kind: 'submission-ambiguous', retry: 'blocked' });
			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode')),
				/no safe automatic Retry path/
			);
			assert.strictEqual(calls, 1);
			assert.strictEqual((JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument).attempts.length, 1);
		} finally {
			await harness.dispose();
			}
	});

	test('persists unknown provider status as an interrupted resumable Attempt', async () => {
			const harness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
			try {
				harness.registerVideoCatalog(videoModelCatalog());
				await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
				harness.registerExecutor(async request => {
					await request.consumeProviderCreateAuthorization!(request.providerRequestFingerprint!, request.attemptId, 'new');
					await request.acknowledgeProviderRequestId('provider/video-unknown');
					await request.reportProviderExecutionFailure!({
						kind: 'protocol',
						retry: 'resume-existing',
						providerRequestId: 'provider/video-unknown'
					});
					throw new Error('The provider returned an unknown non-terminal status.');
				});

				const result = await harness.service.run(harness.node('frame.bhnode'), await harness.providerRunOptions('frame.bhnode'));
				await new Promise(resolve => setTimeout(resolve, 0));
				assert.deepStrictEqual({
					status: result.attempts[0].status,
					providerRequestId: result.attempts[0].providerRequestId,
					failure: result.attempts[0].failure,
					frozenPayloadRetained: result.attempts[0].snapshotManifest === undefined
						? false
						: await harness.fileService.exists(harness.resource(result.attempts[0].snapshotManifest.frozenNodePath))
				}, {
					status: 'interrupted',
					providerRequestId: 'provider/video-unknown',
					failure: {
						kind: 'protocol',
						retry: 'resume-existing',
						providerRequestId: 'provider/video-unknown'
					},
					frozenPayloadRetained: true
				});
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
				() => harness.service.prepareProviderRun(harness.node('frame.bhnode')),
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
			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode')),
				/Retry requires the unchanged frozen Recipe, inputs, and model connection/
			);
			const persisted = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;

			assert.deepStrictEqual({
				providerCalls,
				statuses: persisted.attempts.map(attempt => attempt.status),
				firstPreserved: JSON.stringify(persisted.attempts[0]) === JSON.stringify(first.attempts[0]),
				result: persisted.result
			}, {
				providerCalls: 1,
				statuses: ['failed'],
				firstPreserved: true,
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
			await assert.rejects(
				() => harness.service.run(harness.node('frame.bhnode')),
				/Retry requires the unchanged frozen Recipe, inputs, and model connection/
			);
			const persisted = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;

			assert.deepStrictEqual({
				providerCalls,
				statuses: persisted.attempts.map(attempt => attempt.status),
				firstPreserved: JSON.stringify(persisted.attempts[0]) === JSON.stringify(first.attempts[0]),
				result: persisted.result
			}, {
				providerCalls: 1,
				statuses: ['failed'],
				firstPreserved: true,
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

	test('rejects and removes a video Result without a valid MP4 header', async () => {
		const harness = await createHarness(videoRecipe(), [], [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoModelCatalog());
			await harness.writeNode('frame.bhnode', videoNodeDocument('2026-08-16'));
			let artifact: URI | undefined;
			harness.registerExecutor(async request => {
				await request.consumeProviderCreateAuthorization!(request.providerRequestFingerprint!, request.attemptId, 'new');
				await request.acknowledgeProviderRequestId('provider/video-invalid-artifact');
				artifact = URI.joinPath(request.outputDirectory, 'clip.mp4');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('not-an-mp4'), { overwrite: false });
				return {
					artifact: { id: 'clip', outputId: 'result', kind: 'video', resource: artifact },
					providerRequestId: 'provider/video-invalid-artifact'
				};
			});

			const result = await harness.service.run(harness.node('frame.bhnode'), await harness.providerRunOptions('frame.bhnode'));
			assert.deepStrictEqual({
				status: result.attempts[0].status,
				error: result.attempts[0].error,
				result: result.result,
				artifactRemoved: artifact === undefined ? false : !await harness.fileService.exists(artifact)
			}, {
				status: 'failed',
				error: "Recipe output 'clip' is not a valid MP4 file.",
				result: undefined,
				artifactRemoved: true
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
					error: 'A recipe path contains a symbolic-link component. Unsealed run data was retained because safe cleanup could not be proven.',
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
				artifactRemoved: artifact ? !await harness.fileService.exists(artifact) : false
			}, {
				status: 'failed',
				error: "Recipe output 'frame' changed while it was being accepted.",
				result: undefined,
				artifactRemoved: true
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
				failure: recovered.attempts[0].failure,
				result: recovered.result
			}, {
				status: 'interrupted',
				error: 'The abandoned Attempt has no complete durable provider recovery payload.',
				failure: { kind: 'execution-ownership', retry: 'blocked' },
				result: undefined
			});
		} finally {
			await interruptedHarness.dispose();
		}

		const frozenInputHarness = await createHarness(imageReferenceRecipe());
		try {
			let initial = beginBaseHalfNodeAttempt(nodeDocument('frame.bhnode', [
				{ sourcePath: 'source.bhnode', slot: 'reference', order: 0 }
			]), {
				id: 'abandoned-input-attempt',
				createdAt: '2026-08-13T00:00:00Z',
				startedAt: '2026-08-13T00:00:00Z',
				model: { source: 'local' },
				inputs: [{ sourcePath: 'source.bhnode', slot: 'reference', order: 0, revision: 'frozen-input-revision' }]
			});
			initial = freezeBaseHalfNodeAttemptProviderRequestId(initial, 'abandoned-input-attempt', 'provider/frozen-input');
			await frozenInputHarness.writeNode('frame.bhnode', initial);

			const recovered = await frozenInputHarness.service.recoverInterrupted(frozenInputHarness.node('frame.bhnode'));
			assert.deepStrictEqual({
				status: recovered.attempts[0].status,
				providerRequestId: recovered.attempts[0].providerRequestId,
				error: recovered.attempts[0].error,
				failure: recovered.attempts[0].failure,
				result: recovered.result
			}, {
				status: 'interrupted',
				providerRequestId: 'provider/frozen-input',
				error: 'The abandoned Attempt has no complete durable provider recovery payload.',
				failure: {
					kind: 'execution-ownership',
					retry: 'resume-existing',
					providerRequestId: 'provider/frozen-input'
				},
				result: undefined
			});
		} finally {
			await frozenInputHarness.dispose();
		}
	});

	test('recovers the same video Attempt from its verified frozen snapshot without rescanning the source Draft', async () => {
		const references = [{ source: 'source.bhnode', target: 'clip.bhnode' }];
		const harness = await createHarness(videoFirstFrameRecipe(), references, [videoModelServiceDescriptor()]);
		try {
			harness.registerVideoCatalog(videoFirstFrameModelCatalog());
			const sourceBytes = 'frozen-source-image';
			await harness.fileService.createFolder(harness.resource('assets/source'));
			await harness.write('assets/source/reference.png', sourceBytes);
			const source = importBaseHalfNodeResult(createBaseHalfNodeDocument({
				id: baseHalfNodeTestId(2),
				kind: 'image',
				title: 'Source',
				role: 'first-frame'
			}), {
				id: 'source-artifact',
				outputId: 'imported',
				kind: 'image',
				path: 'assets/source/reference.png',
				sha256: await sha256(sourceBytes),
				size: new TextEncoder().encode(sourceBytes).byteLength
			});
			await harness.writeNode('source.bhnode', source);
			await harness.writeNode('clip.bhnode', videoFirstFrameNodeDocument('2026-08-16'));

			let recoveredRequest: IBaseHalfCanvasRecipeExecutionRequest | undefined;
			harness.registerExecutor(async request => {
				recoveredRequest = request;
				assert.strictEqual(request.attemptId, baseHalfNodeTestId(9));
				assert.deepStrictEqual(request.providerTaskIntent, {
					kind: 'recover',
					providerRequestId: 'provider/restart-task'
				});
				assert.strictEqual(request.consumeProviderCreateAuthorization, undefined);
				assert.strictEqual(request.inputs.length, 1);
				assert.strictEqual(request.inputs[0].slotId, 'first-frame');
				assert.strictEqual(
					(await harness.fileService.readFile(request.inputs[0].source.result!.resource)).value.toString(),
					sourceBytes
				);
				assert.strictEqual(await harness.fileService.exists(URI.joinPath(request.outputDirectory, 'provisional')), false);
				await request.acknowledgeProviderRequestId('provider/restart-task');
				const artifact = URI.joinPath(request.outputDirectory, 'recovered.mp4');
				await harness.fileService.createFile(artifact, VSBuffer.fromString(validMp4), { overwrite: false });
				return {
					artifact: { id: 'recovered', outputId: 'result', kind: 'video', resource: artifact },
					providerRequestId: 'provider/restart-task'
				};
			});

			const preflight = await harness.service.prepareProviderRun(harness.node('clip.bhnode'));
			const inputRevision = await harness.service.getInputRevision(harness.workspaceFolder, 'source.bhnode', { fresh: true });
			const attemptId = baseHalfNodeTestId(9);
			const runRoot = `outputs/${preflight.document.id}/${attemptId}`;
			const frozenNode = createBaseHalfNodeDocument({
				id: preflight.document.id,
				kind: preflight.document.kind,
				title: preflight.document.title,
				role: preflight.document.role,
				prompt: preflight.document.prompt,
				recipe: preflight.document.recipe
			});
			const frozenNodeBytes = serializeBaseHalfNodeDocument(frozenNode);
			await harness.fileService.createFolder(harness.resource(`${runRoot}/inputs`));
			await harness.fileService.createFolder(harness.resource(`${runRoot}/artifacts`));
			await harness.write(`${runRoot}/.basehalf-run-guard`, baseHalfNodeTestId(8));
			await harness.write(`${runRoot}/inputs/node.bhnode`, frozenNodeBytes);
			await harness.write(`${runRoot}/inputs/000-reference.png`, sourceBytes);
			await harness.fileService.createFolder(harness.resource(`${runRoot}/artifacts/provisional`));
			await harness.write(`${runRoot}/artifacts/provisional/partial.mp4`, 'partial-provider-output');

			let running = beginBaseHalfNodeAttempt(preflight.document, {
				...videoAttemptOptions(),
				id: attemptId,
				inputs: [{
					sourcePath: 'source.bhnode',
					slot: 'first-frame',
					order: 0,
					revision: inputRevision
				}]
			});
			running = freezeBaseHalfNodeAttemptExecution(running, attemptId, {
				requestFingerprint: preflight.requestFingerprint,
				intent: { kind: 'new' }
			});
			running = freezeBaseHalfNodeAttemptProviderRequestId(running, attemptId, 'provider/restart-task');
			running = freezeBaseHalfNodeAttemptSnapshotManifest(running, attemptId, {
				version: 1,
				nodePath: 'clip.bhnode',
				frozenNodePath: `${runRoot}/inputs/node.bhnode`,
				frozenNodeDigest: await snapshotFileDigest(frozenNodeBytes),
				executorExtensionId: 'test.workflow',
				videoModelCatalogId: 'test.workflow.models',
				inputs: [{
					edgeId: 'source.bhnode->clip.bhnode',
					slot: 'first-frame',
					order: 0,
					revision: inputRevision,
					sourceId: source.id,
					sourcePath: 'source.bhnode',
					sourceKind: 'image',
					snapshotPath: `${runRoot}/inputs/000-reference.png`,
					snapshotDigest: await snapshotFileDigest(sourceBytes),
					resultId: `${source.id}:result`,
					resultKind: 'image'
				}]
			});
			await harness.writeNode('clip.bhnode', running);

			// The mutable source is corrupt before restart recovery. Recovery must use
			// only the verified run snapshot and the durable provider task id.
			await harness.write('assets/source/reference.png', 'changed-after-provider-ack');
			const recovered = await harness.service.recoverInterrupted(harness.node('clip.bhnode'));
			assert.ok(recoveredRequest);
			assert.strictEqual(recovered.attempts.length, 1);
			assert.strictEqual(recovered.attempts[0].id, attemptId);
			assert.strictEqual(recovered.attempts[0].status, 'succeeded');
			assert.strictEqual(recovered.attempts[0].providerRequestId, 'provider/restart-task');
			assert.strictEqual(recovered.result?.source === 'attempt' ? recovered.result.attemptId : undefined, attemptId);
			assert.strictEqual(getBaseHalfNodeResultArtifact(recovered)?.path, `${runRoot}/artifacts/recovered.mp4`);
		} finally {
			await harness.dispose();
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
					try {
						await harness.fileService.createFile(artifact, VSBuffer.fromString('late-result'), { overwrite: false });
					} finally {
						firstSettled();
					}
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
			assert.ok(firstRequest);
			const lateArtifact = URI.joinPath(firstRequest.outputDirectory, 'late.png');
			for (let cleanupAttempt = 0; cleanupAttempt < 20 && await harness.fileService.exists(lateArtifact); cleanupAttempt++) {
				await new Promise(resolve => setTimeout(resolve, 0));
			}
			assert.deepStrictEqual({
				attempts: cancelled.attempts.map(attempt => attempt.status),
				result: cancelled.result,
				nodeUnchangedAfterLateSuccess: await harness.read('frame.bhnode') === nodeAfterCancel,
				lateArtifactRemoved: !await harness.fileService.exists(lateArtifact)
			}, {
				attempts: ['cancelled'],
				result: undefined,
				nodeUnchangedAfterLateSuccess: true,
				lateArtifactRemoved: true
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

	test('fails a Result seal closed on one exact-content CAS conflict', async () => {
		const harness = await createHarness(imageRecipe());
		try {
			await harness.writeNode('frame.bhnode', nodeDocument('frame.bhnode'));
			let artifact: URI | undefined;
			harness.registerExecutor(async request => {
				artifact = URI.joinPath(request.outputDirectory, 'frame.png');
				await harness.fileService.createFile(artifact, VSBuffer.fromString('candidate-result'), { overwrite: false });
				return { artifact: { id: 'frame', outputId: 'result', kind: 'image', resource: artifact } };
			});
			let conflicted = false;
			harness.setConditionalWriteHook(async (resource, contents) => {
				if (conflicted || !resource.path.endsWith('/frame.bhnode')) {
					return;
				}
				const candidate = JSON.parse(contents.toString()) as IBaseHalfNodeDocument;
				if (!candidate.result) {
					return;
				}
				conflicted = true;
				const current = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
				await harness.writeNode('frame.bhnode', { ...current, title: 'Externally renamed while sealing' });
			});

			const result = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({
				conflicted,
				title: result.title,
				status: result.attempts[0].status,
				failure: result.attempts[0].failure,
				result: result.result,
				artifactRemoved: artifact !== undefined && !await harness.fileService.exists(artifact)
			}, {
				conflicted: true,
				title: 'Externally renamed while sealing',
				status: 'interrupted',
				failure: { kind: 'artifact-commit', retry: 'blocked' },
				result: undefined,
				artifactRemoved: true
			});
		} finally {
			await harness.dispose();
		}
	});

	test('creates zero Attempt when cancellation wins before the model snapshot is frozen', async () => {
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
			await assert.rejects(execution, /Canceled/);
			harness.setModelServices([descriptor]);

			const afterCancellation = JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument;
			assert.strictEqual(afterCancellation.attempts.length, 0);
			const completed = await harness.service.run(harness.node('frame.bhnode'));
			assert.deepStrictEqual({
				providerCalls,
				attempts: completed.attempts.map(attempt => ({ status: attempt.status, model: attempt.model, inputs: attempt.inputs })),
				persistedAttemptCount: (JSON.parse(await harness.read('frame.bhnode')) as IBaseHalfNodeDocument).attempts.length
			}, {
				providerCalls: 1,
				attempts: [{
					status: 'succeeded',
					model: {
						source: 'service',
						connection: 'resolved',
						serviceId: descriptor.id,
						serviceLabel: descriptor.label,
						connectionIdentity: descriptor.connectionIdentity,
						capability: 'image',
						modelId: 'image-v1'
					},
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

	async providerRunOptions(relativePath: string): Promise<{ readonly providerAuthorization: { readonly kind: 'new' | 'replacement'; readonly requestFingerprint: string } }> {
		const preflight = await this.service.prepareProviderRun(this.node(relativePath));
		return Object.freeze({
			providerAuthorization: Object.freeze({
				kind: preflight.authorizationKind,
				requestFingerprint: preflight.requestFingerprint
			})
		});
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

function videoFirstFrameRecipe(): IBaseHalfCanvasRecipeContribution {
	return {
		...videoRecipe(),
		id: 'test.workflow.first-frame-video',
		inputs: [{ id: 'first-frame', label: 'First frame', accepts: ['image'], minItems: 1, maxItems: 1 }]
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

function videoFirstFrameNodeDocument(revision: string): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(1),
		kind: 'video',
		title: 'Clip',
		role: 'result',
		prompt: 'Create a cinematic camera move.',
		recipe: {
			recipeId: videoFirstFrameRecipe().id,
			modelServiceId: 'studio.video',
			modelId: 'seedance-1.5-pro',
			parameters: {
				generationMode: 'first-frame-to-video',
				resolution: '720P',
				duration: 5,
				[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID]: {
					...videoModelSnapshot(revision),
					mode: 'first-frame-to-video',
					inputs: { 'text-prompt': 1, 'first-frame': 1 }
				}
			},
			inputBindings: [{ sourcePath: 'source.bhnode', slot: 'first-frame', order: 0 }]
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

function videoFirstFrameModelCatalog() {
	const catalog = videoModelCatalog();
	return {
		...catalog,
		models: catalog.models.map(model => ({
			...model,
			modes: [{
				...model.modes[0],
				mode: 'first-frame-to-video',
				inputs: [
					{ kind: 'text-prompt', minItems: 1, maxItems: 1, maxCharacters: 1_500 },
					{ kind: 'first-frame', minItems: 1, maxItems: 1 }
				]
			}]
		}))
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

async function snapshotFileDigest(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	return sha256(`\u0000file\u0000${bytes.byteLength}\u0000${await sha256(value)}`);
}
