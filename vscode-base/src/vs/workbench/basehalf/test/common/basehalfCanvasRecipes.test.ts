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
	getBaseHalfCanvasConnectedRecipeChoices,
	getBaseHalfCanvasDefaultNodeRole,
	IBaseHalfCanvasRecipeContribution,
	IBaseHalfCanvasRecipeExecutionRequest,
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
		}), /at most 64 artifacts/);
		assert.throws(() => validateBaseHalfCanvasTemplateContribution('studio.workflow', URI.file('/extensions/studio.workflow'), {
			id: 'studio.workflow.storyboard',
			label: 'Storyboard',
			resource: '../outside.json'
		}), /canonical relative JSON path/);
	});

	test('derives the sole declared primary artifact and rejects ambiguous primary results', async () => {
		const registry = new BaseHalfCanvasRecipeRegistryService();
		const recipeRegistration = registry.registerRecipe('studio.workflow', recipeContribution());
		const runtime = new BaseHalfCanvasRecipeRuntimeService(registry, new TestExtensionService());
		const executor = runtime.registerExecutor(recipeContribution().id, {
			extensionId: 'studio.workflow',
			execute: async () => ({
				artifacts: [{ id: 'clip', outputId: 'primary', kind: 'video', resource: URI.file('/workspace/outputs/node/run/clip.mp4') }]
			})
		});
		try {
			const result = await runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None);
			assert.strictEqual(result.primaryArtifactId, 'clip');
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
				execute: async () => ({ artifacts: [] })
			}), /cannot be executed/);

			const executor = runtime.registerExecutor(recipeContribution().id, {
				extensionId: 'studio.workflow',
				execute: async (_request, progress) => {
					progress.report({ message: 'Generating', increment: 50 });
					return {
						artifacts: [{
							id: 'clip',
							outputId: 'primary',
							kind: 'video',
							resource: URI.file('/workspace/outputs/node/run/clip.mp4')
						}],
						primaryArtifactId: 'clip'
					};
				}
			});
			assert.throws(() => runtime.registerExecutor(recipeContribution().id, {
				extensionId: 'studio.workflow',
				execute: async () => ({ artifacts: [] })
			}), /already registered/);

			const progress: unknown[] = [];
			const result = await runtime.executeRecipe(recipeContribution().id, executionRequest(), { report: value => progress.push(value) }, CancellationToken.None);
			assert.strictEqual(result.primaryArtifactId, 'clip');
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
						artifacts: [{
							id: 'clip',
							outputId: 'primary',
							kind: 'video',
							resource: URI.file('/workspace/outputs/node/run/clip.mp4')
						}],
						primaryArtifactId: 'clip'
					})
				});
			}
		};
		runtime = new BaseHalfCanvasRecipeRuntimeService(registry, extensionService);
		try {
			const result = await runtime.executeRecipe(recipeContribution().id, executionRequest(), { report() { } }, CancellationToken.None);
			assert.strictEqual(result.primaryArtifactId, 'clip');
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
				artifacts: [{ id: 'clip', outputId: 'primary', kind: 'video', resource: URI.file('/outside/clip.mp4') }],
				primaryArtifactId: 'clip'
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
					artifacts: [artifact],
					primaryArtifactId: artifact.id,
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
					execute: async () => ({ artifacts: [artifact], primaryArtifactId: artifact.id, ...disclosure })
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

	test('offers only installed operations with a compatible direct-input role and primary result', () => {
		const compatible = validateBaseHalfCanvasRecipeContribution('studio.workflow', recipeContribution());
		const imageOnly = validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			id: 'studio.workflow.image-only',
			inputs: [{ id: 'image', label: 'Image', accepts: ['image'], minItems: 1, maxItems: 1 }]
		});
		const missingPrimary = {
			...compatible,
			id: 'studio.workflow.invalid',
			outputs: compatible.outputs.map(output => ({ ...output, primary: false }))
		};
		const source = [compatible, imageOnly, missingPrimary] as const;
		const before = JSON.stringify(source);

		const choices = getBaseHalfCanvasConnectedRecipeChoices(source, 'text');

		assert.deepStrictEqual(choices.map(choice => choice.recipe.id), [compatible.id]);
		assert.deepStrictEqual(choices[0].slots.map(slot => slot.id), ['context']);
		assert.strictEqual(choices[0].primaryOutput.kind, 'video');
		assert.strictEqual(Object.isFrozen(choices), true);
		assert.strictEqual(JSON.stringify(source), before, 'planning a cancelled picker must not mutate recipe state');
	});

	test('creates one stable result identity with only defaults and the selected direct binding', () => {
		const recipe = validateBaseHalfCanvasRecipeContribution('studio.workflow', {
			...recipeContribution(),
			parameters: [
				...recipeContribution().parameters!,
				{ id: 'prompt', label: 'Prompt', type: 'multiline', required: true }
			]
		});

		const document = createBaseHalfCanvasConnectedNodeDocument(recipe, baseHalfNodeTestId(1), 'brief.md', 'text', 'context');

		assert.strictEqual(document.id, baseHalfNodeTestId(1));
		assert.strictEqual(document.kind, 'video');
		assert.strictEqual(document.role, 'Video clip');
		assert.strictEqual(document.recipe?.recipeId, recipe.id);
		assert.deepStrictEqual(document.recipe?.parameters, { seconds: 5 });
		assert.deepStrictEqual(document.recipe?.inputBindings, [{ sourcePath: 'brief.md', slot: 'context', order: 0 }]);
		assert.strictEqual(document.recipe?.modelServiceId, undefined);
		assert.strictEqual(document.recipe?.modelId, undefined);
		assert.deepStrictEqual(document.runs, []);
		assert.deepStrictEqual(document.revisions, []);
		assert.throws(
			() => createBaseHalfCanvasConnectedNodeDocument(recipe, 'other-id', 'sound.wav', 'audio', 'context'),
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
		const residual = {
			target: true,
			mirror: { reference: true, card: true, edge: true },
			cache: [] as string[]
		};

		const errors = await compensateBaseHalfCanvasConnectedNodeCreate({
			canvasApplied: true,
			referenceApplied: true,
			fileCreated: true,
			rollbackCanvas: async () => {
				residual.mirror.card = false;
				residual.mirror.edge = false;
			},
			rollbackReference: async () => {
				residual.mirror.reference = false;
			},
			discardFile: async () => {
				residual.target = false;
			}
		});

		assert.deepStrictEqual(errors, []);
		assert.deepStrictEqual(residual, {
			target: false,
			mirror: { reference: false, card: false, edge: false },
			cache: []
		});
	});
});

function recipeContribution(): IBaseHalfCanvasRecipeContribution {
	return {
		id: 'studio.workflow.generate-video',
		label: 'Generate video',
		description: 'Generate one local video artifact.',
		icon: 'device-camera-video',
		modelCapability: 'video',
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
		runId: 'run-1',
		workspaceFolder: URI.file('/workspace'),
		node: { id: 'node-1', path: 'clip.mp4', kind: 'video' },
		recipeId: recipeContribution().id,
		parameters: { seconds: 5 },
		modelServiceId: 'studio.video',
		inputs: [{
			edgeId: 'edge-1',
			slotId: 'context',
			order: 0,
			source: { id: 'node-0', path: 'prompt.md', kind: 'text', resource: URI.file('/workspace/prompt.md') }
		}],
		outputDirectory: URI.file('/workspace/outputs/node/run')
	};
}
