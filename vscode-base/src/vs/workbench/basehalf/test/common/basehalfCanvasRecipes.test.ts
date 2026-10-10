/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestExtensionService } from '../../../test/common/workbenchTestServices.js';
import {
	BaseHalfCanvasRecipeRegistryService,
	BaseHalfCanvasRecipeRuntimeService,
	compensateBaseHalfCanvasConnectedNodeCreate,
	createBaseHalfCanvasConnectedNodeDocument,
	getBaseHalfCanvasConnectionNodeTargets,
	getBaseHalfCanvasDefaultNodeRole,
	IBaseHalfCanvasRecipeContribution,
	IBaseHalfCanvasRecipeExecutionRequest,
	IBaseHalfCanvasRecipeExecutionResult,
	validateBaseHalfCanvasRecipeInputs,
	validateBaseHalfCanvasRecipeContribution,
	validateBaseHalfCanvasTemplateContribution
} from '../../common/basehalfCanvasRecipes.js';
import { baseHalfNodeTestId } from './basehalfNodeTestFixtures.js';

suite('BaseHalfCanvasRecipes', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('validates and normalizes bounded declarative recipes', () => {
		const recipe = validateBaseHalfCanvasRecipeContribution('Studio.Workflow', recipeContribution());

		assert.strictEqual(recipe.id, 'studio.workflow.generate-video');
		assert.strictEqual(recipe.extensionId, 'studio.workflow');
		assert.deepStrictEqual(recipe.inputs[0].accepts, ['text', 'image']);
		assert.deepStrictEqual(recipe.outputs[0].extensions, ['.mp4']);
		assert.strictEqual(Object.isFrozen(recipe), true);
		assert.strictEqual(Object.isFrozen(recipe.inputs), true);
	});

	test('keeps reviewed video settings out of the static recipe schema', () => {
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			modelCapability: 'video',
			videoModelCatalogId: 'studio.workflow.video-models'
		}), /reviewed catalog settings instead of static parameters/);

		const reviewedVideoRecipe = validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			modelCapability: 'video',
			videoModelCatalogId: 'studio.workflow.video-models',
			parameters: []
		});
		assert.strictEqual(reviewedVideoRecipe.modelCapability, 'video');
		assert.strictEqual(reviewedVideoRecipe.videoModelCatalogId, 'studio.workflow.video-models');
		assert.deepStrictEqual(reviewedVideoRecipe.parameters, []);

		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			modelCapability: 'video',
			parameters: []
		}), /must declare its exact video model catalog/);
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			modelCapability: 'video',
			videoModelCatalogId: 'other.workflow.video-models',
			parameters: []
		}), /must be prefixed/);
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			videoModelCatalogId: 'studio.workflow.video-models'
		}), /cannot declare a video model catalog/);
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			modelCapability: 'video',
			videoModelCatalogId: 'studio.workflow.video-models',
			parameters: [],
			outputs: [{ ...recipeContribution().outputs[0], kind: 'image', extensions: ['.png'] }]
		}), /must produce a video Result/);
		for (const modelCapability of ['text', 'image', 'audio'] as const) {
			assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
				...recipeContribution(),
				modelCapability
			}), /local video recipe.*must omit model capability/);
		}
	});

	test('rejects contributions outside their extension namespace', () => {
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			id: 'other.workflow.generate-video'
		}), /must be prefixed/);
	});

	test('rejects non-canonical template contribution identifiers', () => {
		const ids = [
			'Studio.workflow.storyboard',
			' studio.workflow.storyboard',
			'studio.workflow.storyboard ',
			'1studio.workflow.storyboard',
			'studio.2workflow.storyboard',
			'studio.workflow.story_board',
			`studio.workflow.${'a'.repeat(113)}`
		];
		for (const id of ids) {
			assert.throws(() => validateBaseHalfCanvasTemplateContribution('studio.workflow', URI.file('/extensions/studio.workflow'), {
				id,
				label: 'Storyboard',
				resource: 'templates/storyboard.json'
			}), /must be prefixed/);
		}
	});

	test('rejects ambiguous recipe shapes and unsafe template resources', () => {
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			inputs: [recipeContribution().inputs![0], recipeContribution().inputs![0]]
		}), /duplicate input id/);
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			outputs: recipeContribution().outputs.map(output => ({ ...output, primary: false }))
		}), /exactly one primary output/);
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			outputs: recipeContribution().outputs.map(output => ({ ...output, maxItems: 2 }))
		}), /primary output must produce exactly one artifact/);
		for (const kind of ['text', 'code']) {
			assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
				...recipeContribution(),
				outputs: [{ ...recipeContribution().outputs[0], kind }]
			} as unknown as IBaseHalfCanvasRecipeContribution), /invalid content kind/);
		}
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			parameters: [{
				id: 'mode',
				label: 'Mode',
				type: 'enum',
				default: 'missing',
				options: [{ value: 'safe', label: 'Safe' }]
			}]
		}), /default is not an enum option/);
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			parameters: [{ id: 'payload', label: 'Payload', type: 'object' } as unknown as NonNullable<IBaseHalfCanvasRecipeContribution['parameters']>[number]]
		}), /invalid type/);
		for (const type of ['string', 'multiline'] as const) {
			assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
				...recipeContribution(),
				parameters: [{ id: 'prompt', label: 'Prompt', type, required: true, default: ' \t ' }]
			}), /blank default/);
		}
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			inputs: [{ ...recipeContribution().inputs![0], maxItems: 65 }]
		}), /integer from 1 to 64|at most 64 direct inputs/);
		assert.throws(() => validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			outputs: [
				{ ...recipeContribution().outputs[0], maxItems: 1 },
				{ id: 'extras', kind: 'file', extensions: ['.bin'], minItems: 0, maxItems: 64 }
			]
		}), /exactly one output/);
		assert.throws(() => validateBaseHalfCanvasTemplateContribution('studio.workflow', URI.file('/extensions/studio.workflow'), {
			id: 'studio.workflow.storyboard',
			label: 'Storyboard',
			resource: '../outside.json'
		}), /canonical relative JSON path/);
	});

	test('returns the sole declared artifact without a primary selector', async () => {
		const registry = new BaseHalfCanvasRecipeRegistryService();
		const recipeRegistration = registry.registerRecipe('studio.workflow', recipeContribution());
		const runtime = new BaseHalfCanvasRecipeRuntimeService(registry, new TestExtensionService());
		const executor = runtime.registerExecutor(recipeContribution().id, {
			extensionId: 'studio.workflow',
			execute: async () => ({
				artifact: { id: 'clip', outputId: 'primary', kind: 'video', resource: URI.file('/workspace/outputs/node/run/clip.mp4') }
			})
		});
		try {
			const result = await runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None);
			assert.strictEqual(result.artifact.id, 'clip');
		} finally {
			executor.dispose();
			runtime.dispose();
			recipeRegistration.dispose();
			registry.dispose();
		}
	});

	test('rejects executor artifact ids that cannot be persisted in a node Result', async () => {
		const registry = new BaseHalfCanvasRecipeRegistryService();
		const recipeRegistration = registry.registerRecipe('studio.workflow', recipeContribution());
		const runtime = new BaseHalfCanvasRecipeRuntimeService(registry, new TestExtensionService());
		let artifactId: unknown = 'clip';
		const executor = runtime.registerExecutor(recipeContribution().id, {
			extensionId: 'studio.workflow',
			execute: async () => ({
				artifact: { id: artifactId as string, outputId: 'primary', kind: 'video', resource: URI.file('/workspace/outputs/node/run/clip.mp4') }
			})
		});
		try {
			for (const invalidId of ['clip/frame', 'clip frame', '-clip', `clip${'x'.repeat(125)}`, 1, ' \t ']) {
				artifactId = invalidId;
				await assert.rejects(
					() => runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None),
					/studio\.workflow\.generate-video\.artifact\.id (contains unsupported characters|is too long|must be a string|cannot be empty)/
				);
			}
		} finally {
			executor.dispose();
			runtime.dispose();
			recipeRegistration.dispose();
			registry.dispose();
		}
	});

	test('registers immutable definitions and releases duplicate ids on dispose', () => {
		const registry = new BaseHalfCanvasRecipeRegistryService();
		try {
			let changes = 0;
			const listener = registry.onDidChange(() => changes++);
			const registration = registry.registerRecipe('studio.workflow', recipeContribution());
			assert.strictEqual(registry.getRecipe(recipeContribution().id)?.label, 'Generate video');
			assert.throws(() => registry.registerRecipe('studio.workflow', recipeContribution()), /already registered/);

			const template = registry.registerTemplate('studio.workflow', URI.file('/extensions/studio.workflow'), {
				id: 'studio.workflow.storyboard',
				label: 'Storyboard',
				resource: 'templates/storyboard.json'
			});
			assert.strictEqual(registry.getTemplate('studio.workflow.storyboard')?.resource.path, '/extensions/studio.workflow/templates/storyboard.json');

			registration.dispose();
			assert.strictEqual(registry.getRecipe(recipeContribution().id), undefined);
			const replacement = registry.registerRecipe('studio.workflow', recipeContribution());
			replacement.dispose();
			template.dispose();
			listener.dispose();
			assert.strictEqual(changes, 6);
		} finally {
			registry.dispose();
		}
	});

	test('executes only through the declaring extension and validates artifacts', async () => {
		const registry = new BaseHalfCanvasRecipeRegistryService();
		const recipeRegistration = registry.registerRecipe('studio.workflow', recipeContribution());
		const runtime = new BaseHalfCanvasRecipeRuntimeService(registry, new TestExtensionService());
		try {
			assert.throws(() => runtime.registerExecutor(recipeContribution().id, {
				extensionId: 'other.workflow',
				execute: async () => ({ artifact: { id: 'clip', outputId: 'primary', kind: 'video', resource: URI.file('/workspace/outputs/node/run/clip.mp4') } })
			}), /cannot be executed/);

			const executor = runtime.registerExecutor(recipeContribution().id, {
				extensionId: 'studio.workflow',
				execute: async (_request, progress) => {
					progress.report({ message: 'Generating', increment: 50 });
					return {
						artifact: {
							id: 'clip',
							outputId: 'primary',
							kind: 'video',
							resource: URI.file('/workspace/outputs/node/run/clip.mp4')
						}
					};
				}
			});
			assert.throws(() => runtime.registerExecutor(recipeContribution().id, {
				extensionId: 'studio.workflow',
				execute: async () => ({ artifact: { id: 'clip', outputId: 'primary', kind: 'video', resource: URI.file('/workspace/outputs/node/run/clip.mp4') } })
			}), /already registered/);

			const progress: unknown[] = [];
			const result = await runtime.executeRecipe(recipeContribution().id, executionRequest(), { report: value => progress.push(value) }, CancellationToken.None);
			assert.strictEqual(result.artifact.id, 'clip');
			assert.deepStrictEqual(progress, [{ message: 'Generating', increment: 50 }]);

			executor.dispose();
			assert.strictEqual(runtime.hasExecutor(recipeContribution().id), false);
			await assert.rejects(() => runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None), /No BaseHalf canvas recipe executor/);
		} finally {
			runtime.dispose();
			recipeRegistration.dispose();
			registry.dispose();
		}
	});

	test('activates the declaring extension before requiring its executor', async () => {
		const registry = new BaseHalfCanvasRecipeRegistryService();
		const recipeRegistration = registry.registerRecipe('studio.workflow', recipeContribution());
		const activationEvents: string[] = [];
		let executorRegistration: { dispose(): void } | undefined;
		let runtime!: BaseHalfCanvasRecipeRuntimeService;
		const extensionService = new class extends TestExtensionService {
			override async activateByEvent(activationEvent: string): Promise<void> {
				activationEvents.push(activationEvent);
				executorRegistration ??= runtime.registerExecutor(recipeContribution().id, {
					extensionId: 'studio.workflow',
					execute: async () => ({
						artifact: {
							id: 'clip',
							outputId: 'primary',
							kind: 'video',
							resource: URI.file('/workspace/outputs/node/run/clip.mp4')
						}
					})
				});
			}
		};
		runtime = new BaseHalfCanvasRecipeRuntimeService(registry, extensionService);
		try {
			const result = await runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None);
			assert.strictEqual(result.artifact.id, 'clip');
			assert.deepStrictEqual(activationEvents, [`onBaseHalfCanvasRecipe:${recipeContribution().id}`]);
		} finally {
			executorRegistration?.dispose();
			runtime.dispose();
			recipeRegistration.dispose();
			registry.dispose();
		}
	});

	test('executor disposal cancels active work during an extension host restart', async () => {
		const registry = new BaseHalfCanvasRecipeRegistryService();
		const recipeRegistration = registry.registerRecipe('studio.workflow', recipeContribution());
		const runtime = new BaseHalfCanvasRecipeRuntimeService(registry, new TestExtensionService());
		let didStart!: () => void;
		const started = new Promise<void>(resolve => { didStart = resolve; });
		let didCancel!: () => void;
		const cancelled = new Promise<void>(resolve => { didCancel = resolve; });
		try {
			const executor = runtime.registerExecutor(recipeContribution().id, {
				extensionId: 'studio.workflow',
				execute: async (_request, _progress, token) => {
					didStart();
					return new Promise((_resolve, reject) => {
						const listener = token.onCancellationRequested(() => {
							listener.dispose();
							didCancel();
							reject(new CancellationError());
						});
					});
				}
			});

			const execution = runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None);
			await started;
			executor.dispose();
			await cancelled;
			await assert.rejects(() => execution, /Canceled/);
		} finally {
			runtime.dispose();
			recipeRegistration.dispose();
			registry.dispose();
		}
	});

	test('rejects executor artifacts outside the host output directory', async () => {
		const registry = new BaseHalfCanvasRecipeRegistryService();
		const recipeRegistration = registry.registerRecipe('studio.workflow', recipeContribution());
		const runtime = new BaseHalfCanvasRecipeRuntimeService(registry, new TestExtensionService());
		const executor = runtime.registerExecutor(recipeContribution().id, {
			extensionId: 'studio.workflow',
			execute: async () => ({
				artifact: { id: 'clip', outputId: 'primary', kind: 'video', resource: URI.file('/outside/clip.mp4') }
			})
		});
		try {
			await assert.rejects(() => runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None), /outside its output directory/);
		} finally {
			executor.dispose();
			runtime.dispose();
			recipeRegistration.dispose();
			registry.dispose();
		}
	});

	test('accepts only bounded provider audit disclosures from executors', async () => {
		const registry = new BaseHalfCanvasRecipeRegistryService();
		const recipeRegistration = registry.registerRecipe('studio.workflow', recipeContribution());
		const runtime = new BaseHalfCanvasRecipeRuntimeService(registry, new TestExtensionService());
		const artifact = {
			id: 'clip',
			outputId: 'primary',
			kind: 'video' as const,
			resource: URI.file('/workspace/outputs/node/run/clip.mp4')
		};
		try {
			const valid = runtime.registerExecutor(recipeContribution().id, {
				extensionId: 'studio.workflow',
				execute: async () => ({
					artifact,
					providerRequestId: 'provider/request-1',
					usage: { inputTokens: 12, outputTokens: 3, videoSeconds: 5.5 },
					cost: { currency: 'USD', amount: '0.12', kind: 'estimated' }
				})
			});
			const accepted = await runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None);
			assert.strictEqual(accepted.providerRequestId, 'provider/request-1');
			assert.deepStrictEqual(accepted.usage, { inputTokens: 12, outputTokens: 3, videoSeconds: 5.5 });
			assert.deepStrictEqual(accepted.cost, { currency: 'USD', amount: '0.12', kind: 'estimated' });
			valid.dispose();

			const invalidResults = [
				{ providerRequestId: 'request\nsecret' },
				{ usage: { inputTokens: Number.MAX_SAFE_INTEGER + 1 } },
				{ usage: { videoSeconds: Number.POSITIVE_INFINITY } },
				{ cost: { currency: 'usd', amount: '1', kind: 'actual' as const } },
				{ cost: { currency: 'USD', amount: '1e3', kind: 'actual' as const } }
			];
			for (const disclosure of invalidResults) {
				const executor = runtime.registerExecutor(recipeContribution().id, {
					extensionId: 'studio.workflow',
					execute: async () => ({ artifact, ...disclosure })
				});
				await assert.rejects(() => runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None));
				executor.dispose();
			}
		} finally {
			runtime.dispose();
			recipeRegistration.dispose();
			registry.dispose();
		}
	});

	test('rejects legacy result arrays and undeclared result fields', async () => {
		const registry = new BaseHalfCanvasRecipeRegistryService();
		const recipeRegistration = registry.registerRecipe('studio.workflow', recipeContribution());
		const runtime = new BaseHalfCanvasRecipeRuntimeService(registry, new TestExtensionService());
		const artifact = { id: 'clip', outputId: 'primary', kind: 'video' as const, resource: URI.file('/workspace/outputs/node/run/clip.mp4') };
		try {
			const legacy = runtime.registerExecutor(recipeContribution().id, {
				extensionId: 'studio.workflow',
				execute: async () => ({ artifacts: [artifact], primaryArtifactId: artifact.id } as unknown as IBaseHalfCanvasRecipeExecutionResult)
			});
			await assert.rejects(
				() => runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None),
				/returned an invalid result/
			);
			legacy.dispose();

			const extra = runtime.registerExecutor(recipeContribution().id, {
				extensionId: 'studio.workflow',
				execute: async () => ({ artifact, artifacts: [artifact], primaryArtifactId: artifact.id } as unknown as IBaseHalfCanvasRecipeExecutionResult)
			});
			await assert.rejects(
				() => runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None),
				/unsupported property 'artifacts'/
			);
			extra.dispose();
		} finally {
			runtime.dispose();
			recipeRegistration.dispose();
			registry.dispose();
		}
	});

	test('requires target-owned input order to be unique and continuous', () => {
		const recipe = validateBaseHalfCanvasRecipeContribution('studio.workflow', recipeContribution());
		const input = executionRequest().inputs[0];
		assert.throws(() => validateBaseHalfCanvasRecipeInputs(recipe, [
			input,
			{ ...input, edgeId: 'edge-2', source: { ...input.source, id: 'node-2', path: 'other.md' } }
		]), /duplicate order/);
		assert.throws(() => validateBaseHalfCanvasRecipeInputs(recipe, [
			{ ...input, order: 1 }
		]), /contiguous from zero/);
	});

	test('offers every node kind and binds a connection only through the implicit video recipe', () => {
		const videoRecipe = validateBaseHalfCanvasRecipeContribution('studio.workflow', connectionVideoRecipeContribution());
		const imagePlanning = validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			id: 'studio.workflow.storyboard',
			outputs: [{ id: 'primary', kind: 'image', extensions: ['.svg'], minItems: 1, maxItems: 1, primary: true }]
		});
		const secondVideoRecipe = validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...connectionVideoRecipeContribution(),
			id: 'studio.workflow.other-video'
		});
		const summarize = (targets: ReturnType<typeof getBaseHalfCanvasConnectionNodeTargets>) => targets.map(target => ({
			kind: target.kind,
			recipe: target.recipe?.id,
			slots: target.slots.map(slot => slot.id)
		}));
		const source = [imagePlanning, videoRecipe] as const;
		const before = JSON.stringify(source);
		const fromImage = getBaseHalfCanvasConnectionNodeTargets(source, 'image');

		assert.deepStrictEqual({
			fromImage: summarize(fromImage),
			fromText: summarize(getBaseHalfCanvasConnectionNodeTargets(source, 'text')).map(target => target.kind),
			twoVideoRecipes: summarize(getBaseHalfCanvasConnectionNodeTargets([videoRecipe, secondVideoRecipe], 'text')).find(target => target.kind === 'video')
		}, {
			fromImage: [
				{ kind: 'image', recipe: undefined, slots: [] },
				{ kind: 'video', recipe: videoRecipe.id, slots: ['reference', 'first-frame'] },
				{ kind: 'audio', recipe: undefined, slots: [] },
				{ kind: 'file', recipe: undefined, slots: [] },
				{ kind: 'pdf', recipe: undefined, slots: [] },
				{ kind: 'presentation', recipe: undefined, slots: [] }
			],
			fromText: ['image', 'audio', 'file', 'pdf', 'presentation'],
			twoVideoRecipes: { kind: 'video', recipe: undefined, slots: [] }
		});
		assert.strictEqual(Object.isFrozen(fromImage), true);
		assert.strictEqual(JSON.stringify(source), before, 'planning a cancelled menu must not mutate recipe state');
	});

	test('creates a connected node that lists its source and binds it only to the chosen role', () => {
		const videoRecipe = validateBaseHalfCanvasRecipeContribution('studio.workflow', connectionVideoRecipeContribution());
		const video = getBaseHalfCanvasConnectionNodeTargets([videoRecipe], 'image').find(target => target.kind === 'video')!;
		const image = getBaseHalfCanvasConnectionNodeTargets([videoRecipe], 'text').find(target => target.kind === 'image')!;

		const bound = createBaseHalfCanvasConnectedNodeDocument(video, baseHalfNodeTestId(1), 'Video', 'frame.png', 'image', 'first-frame');
		const unbound = createBaseHalfCanvasConnectedNodeDocument(image, baseHalfNodeTestId(2), 'Image', 'brief.md', 'text', undefined);

		assert.deepStrictEqual([bound, unbound].map(document => ({
			id: document.id,
			kind: document.kind,
			title: document.title,
			role: document.role,
			upstream: document.upstream,
			recipe: document.recipe,
			attempts: document.attempts,
			result: document.result
		})), [{
			id: baseHalfNodeTestId(1),
			kind: 'video',
			title: 'Video',
			role: 'Video clip',
			upstream: ['frame.png'],
			recipe: { recipeId: videoRecipe.id, parameters: {}, inputBindings: [{ sourcePath: 'frame.png', slot: 'first-frame', order: 0 }] },
			attempts: [],
			result: undefined
		}, {
			id: baseHalfNodeTestId(2),
			kind: 'image',
			title: 'Image',
			role: 'Image result',
			upstream: ['brief.md'],
			recipe: undefined,
			attempts: [],
			result: undefined
		}]);
		assert.throws(
			() => createBaseHalfCanvasConnectedNodeDocument(video, baseHalfNodeTestId(3), 'Video', 'clip.mp4', 'video', 'first-frame'),
			/cannot bind input role/
		);
		assert.throws(
			() => createBaseHalfCanvasConnectedNodeDocument(video, baseHalfNodeTestId(3), 'Video', 'frame.png', 'image', undefined),
			/cannot bind input role/
		);
	});

	test('uses a readable neutral role for every output kind', () => {
		assert.deepStrictEqual(([
			'file',
			'image',
			'video',
			'audio',
			'pdf',
			'presentation'
		] as const).map(kind => getBaseHalfCanvasDefaultNodeRole(kind)), [
			'Output file',
			'Image result',
			'Video clip',
			'Audio result',
			'PDF document',
			'Presentation'
		]);
	});

	test('removes every created layer when connected-node creation fails before commit', async () => {
		// The connection lives in the created file's `upstream`, so discarding
		// the file also discards it: only the canvas row and the file remain.
		const residual = {
			target: true,
			mirror: { card: true, edge: true },
			cache: [] as string[]
		};

		const errors = await compensateBaseHalfCanvasConnectedNodeCreate({
			canvasApplied: true,
			fileCreated: true,
			rollbackCanvas: async () => {
				residual.mirror.card = false;
				residual.mirror.edge = false;
			},
			discardFile: async () => {
				residual.target = false;
			}
		});

		assert.deepStrictEqual(errors, []);
		assert.deepStrictEqual(residual, {
			target: false,
			mirror: { card: false, edge: false },
			cache: []
		});
	});
});

function connectionVideoRecipeContribution(): IBaseHalfCanvasRecipeContribution {
	return {
		...recipeContribution(),
		modelCapability: 'video',
		videoModelCatalogId: 'studio.workflow.video-models',
		inputs: [
			{ id: 'reference', label: 'Reference Media', accepts: ['image', 'video'], minItems: 0, maxItems: 8 },
			{ id: 'first-frame', label: 'First Frame', accepts: ['image'], minItems: 0, maxItems: 1 }
		],
		parameters: []
	};
}

function recipeContribution(): IBaseHalfCanvasRecipeContribution {
	return {
		id: 'studio.workflow.generate-video',
		label: 'Generate video',
		description: 'Generate one local video artifact.',
		icon: 'device-camera-video',
		inputs: [{
			id: 'context',
			label: 'Context',
			accepts: ['text', 'image'],
			minItems: 1,
			maxItems: 8
		}],
		parameters: [{
			id: 'seconds',
			label: 'Seconds',
			type: 'number',
			default: 5,
			minimum: 1,
			maximum: 120
		}],
		outputs: [{
			id: 'primary',
			kind: 'video',
			extensions: ['.MP4'],
			minItems: 1,
			maxItems: 1,
			primary: true
		}]
	};
}

function executionRequest(): IBaseHalfCanvasRecipeExecutionRequest {
	return {
		attemptId: 'attempt-1',
		workspaceFolder: URI.file('/workspace'),
		node: { id: 'node-1', path: 'clip.mp4', kind: 'video' },
		recipeId: recipeContribution().id,
		prompt: 'A calm orbit around the product.',
		parameters: { seconds: 5 },
		modelServiceId: 'studio.video',
		inputs: [{
			edgeId: 'edge-1',
			slotId: 'context',
			order: 0,
			source: { id: 'node-0', path: 'prompt.md', kind: 'text', resource: URI.file('/workspace/prompt.md') }
		}],
		outputDirectory: URI.file('/workspace/outputs/node/run'),
		acknowledgeProviderRequestId: async () => undefined
	};
}
