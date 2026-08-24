/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import type { BaseHalfCanvasContentKind, IBaseHalfCanvasRecipeInputDefinition } from '../../common/basehalfCanvasRecipes.js';
import { createBaseHalfNodeDocument, IBaseHalfNodeInputBinding } from '../../common/basehalfNodeDocument.js';
import {
	applyBaseHalfVideoInputMutationToDocument,
	baseHalfVideoInputBindingIntegrity,
	BaseHalfVideoInputMutationError,
	BaseHalfVideoInputMutationProblemKind,
	createBaseHalfVideoInputsPresentation,
	IBaseHalfVideoInputMutationContext,
	IBaseHalfVideoInputSourceState,
	planBaseHalfVideoFrameSwap,
	planBaseHalfVideoInputPick,
	planBaseHalfVideoInputRemove,
	planBaseHalfVideoInputReorder,
	planBaseHalfVideoInputReplace,
	planBaseHalfVideoInputRoleChange
} from '../../common/basehalfVideoInputs.js';
import type {
	BaseHalfVideoGenerationMode,
	BaseHalfVideoInputKind,
	BaseHalfVideoInputState,
	IBaseHalfVideoInputEvaluation,
	IBaseHalfVideoInputProblem,
	IBaseHalfVideoModeCapability
} from '../../common/basehalfVideoModels.js';

suite('BaseHalfVideoInputs', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('derives named frame slots from the selected method while required inputs are empty', () => {
		const startCapability = capability('first-frame-to-video');
		const presentation = createBaseHalfVideoInputsPresentation({
			capability: startCapability,
			recipeInputs: recipeInputs(),
			bindings: [],
			sources: [],
			inputEvaluation: evaluation(
				{ 'text-prompt': 1 },
				problem('too-few', 'first-frame', 0, 1, 1)
			)
		});

		assert.deepStrictEqual(presentation.frameSlots.map(slot => ({ role: slot.role, actions: slot.actions })), [
			{ role: 'first-frame', actions: ['pick'] }
		]);
		assert.deepStrictEqual(presentation.readinessProblems.map(candidate => candidate.kind), ['missing-start-frame']);
		assert.strictEqual(presentation.mode, 'first-frame-to-video');
		assert.strictEqual(Object.isFrozen(presentation), true);
		assert.strictEqual(Object.isFrozen(presentation.frameSlots), true);

		const textPresentation = createBaseHalfVideoInputsPresentation({
			capability: capability('text-to-video'),
			recipeInputs: recipeInputs(),
			bindings: [],
			sources: [],
			inputEvaluation: evaluation({ 'text-prompt': 1 })
		});
		assert.deepStrictEqual(textPresentation.frameSlots, []);

		assertMutationKind(() => createBaseHalfVideoInputsPresentation({
			capability: {
				...startCapability,
				inputs: startCapability.inputs.map(input => input.kind === 'first-frame' ? { ...input, minItems: 0 } : input)
			},
			recipeInputs: recipeInputs(),
			bindings: [],
			sources: [],
			inputEvaluation: evaluation({ 'text-prompt': 1 })
		}), 'invalid-capability');
		assertMutationKind(() => createBaseHalfVideoInputsPresentation({
			capability: {
				...startCapability,
				inputs: [...startCapability.inputs, { kind: 'text-prompt', minItems: 1, maxItems: 1, maxCharacters: 8_000 }]
			},
			recipeInputs: recipeInputs(),
			bindings: [],
			sources: [],
			inputEvaluation: evaluation({ 'text-prompt': 1 })
		}), 'invalid-capability');
	});

	test('keeps Start and End distinct when only one temporal input is present', () => {
		const bindings = [binding('frames/start.bhnode', 'first-frame', 0)];
		const presentation = createBaseHalfVideoInputsPresentation({
			capability: capability('first-last-frame-to-video'),
			recipeInputs: recipeInputs(),
			bindings,
			sources: [source('frames/start.bhnode')],
			inputEvaluation: evaluation(
				{ 'text-prompt': 1, 'first-frame': 1 },
				problem('too-few', 'last-frame', 0, 1, 1)
			)
		});

		assert.strictEqual(presentation.frameSlots[0].binding?.sourcePath, 'frames/start.bhnode');
		assert.strictEqual(presentation.frameSlots[1].binding, undefined);
		assert.strictEqual(presentation.frameSlots[1].problem?.kind, 'missing-end-frame');
		assert.strictEqual(presentation.canSwapFrames, false);
		assert.deepStrictEqual(presentation.needsReview, []);
		assert.deepStrictEqual(bindings, [binding('frames/start.bhnode', 'first-frame', 0)]);
	});

	test('plans one atomic Start and End role swap without graph changes', () => {
		const bindings = [
			binding('frames/start.bhnode', 'first-frame', 0),
			binding('frames/end.bhnode', 'last-frame', 1)
		];
		const context = mutationContext('first-last-frame-to-video', bindings, [
			source('frames/start.bhnode'),
			source('frames/end.bhnode')
		]);
		const presentation = createBaseHalfVideoInputsPresentation({
			...context,
			inputEvaluation: evaluation({ 'text-prompt': 1, 'first-frame': 1, 'last-frame': 1 })
		});
		const plan = planBaseHalfVideoFrameSwap(context);

		assert.strictEqual(presentation.canSwapFrames, true);
		assert.deepStrictEqual(plan.afterBindings, [
			binding('frames/start.bhnode', 'last-frame', 0),
			binding('frames/end.bhnode', 'first-frame', 1)
		]);
		assert.deepStrictEqual(plan.graph, { addSourcePaths: [], removeSourcePaths: [] });
		assert.deepStrictEqual(bindings, [
			binding('frames/start.bhnode', 'first-frame', 0),
			binding('frames/end.bhnode', 'last-frame', 1)
		]);
		assert.strictEqual(Object.isFrozen(plan), true);
		assert.strictEqual(Object.isFrozen(plan.afterBindings), true);
		assert.strictEqual(Object.isFrozen(plan.graph), true);
	});

	test('reclassifies retained End as Needs review without changing bindings or edges', () => {
		const bindings = [
			binding('frames/start.bhnode', 'first-frame', 0),
			binding('frames/end.bhnode', 'last-frame', 1)
		];
		const sources = [source('frames/start.bhnode'), source('frames/end.bhnode')];
		const startOnly = createBaseHalfVideoInputsPresentation({
			capability: capability('first-frame-to-video'),
			recipeInputs: recipeInputs(),
			bindings,
			sources,
			inputEvaluation: evaluation(
				{ 'text-prompt': 1, 'first-frame': 1, 'last-frame': 1 },
				problem('unsupported', 'last-frame', 1, 0, 0)
			)
		});

		assert.deepStrictEqual(startOnly.activeBindings.map(row => row.binding.sourcePath), ['frames/start.bhnode']);
		assert.deepStrictEqual(startOnly.needsReview.map(row => ({
			path: row.binding.sourcePath,
			role: row.binding.slot,
			status: row.status,
			problem: row.problem?.kind
		})), [{
			path: 'frames/end.bhnode',
			role: 'last-frame',
			status: 'unused',
			problem: 'unused-role'
		}]);
		assert.deepStrictEqual(startOnly.needsReview[0].actions, ['change-method', 'remove']);
		assert.deepStrictEqual(startOnly.bindings.map(row => row.binding), bindings);

		const restored = createBaseHalfVideoInputsPresentation({
			capability: capability('first-last-frame-to-video'),
			recipeInputs: recipeInputs(),
			bindings,
			sources,
			inputEvaluation: evaluation({ 'text-prompt': 1, 'first-frame': 1, 'last-frame': 1 })
		});
		assert.deepStrictEqual(restored.needsReview, []);
		assert.deepStrictEqual(restored.frameSlots.map(slot => slot.binding?.sourcePath), [
			'frames/start.bhnode',
			'frames/end.bhnode'
		]);
	});

	test('does not infer a frame method from two attached Images after model fallback', () => {
		const bindings = [
			binding('frames/start.bhnode', 'first-frame', 0),
			binding('frames/end.bhnode', 'last-frame', 1)
		];
		const presentation = createBaseHalfVideoInputsPresentation({
			capability: capability('text-to-video'),
			recipeInputs: recipeInputs(),
			bindings,
			sources: [source('frames/start.bhnode'), source('frames/end.bhnode')],
			inputEvaluation: evaluation(
				{ 'text-prompt': 1, 'first-frame': 1, 'last-frame': 1 },
				problem('unsupported', 'first-frame', 1, 0, 0),
				problem('unsupported', 'last-frame', 1, 0, 0)
			)
		});

		assert.strictEqual(presentation.mode, 'text-to-video');
		assert.deepStrictEqual(presentation.frameSlots, []);
		assert.deepStrictEqual(presentation.needsReview.map(row => [row.binding.slot, row.status]), [
			['first-frame', 'unused'],
			['last-frame', 'unused']
		]);
		assert.deepStrictEqual(presentation.bindings.map(row => row.binding), bindings);
	});

	test('classifies every binding exactly once with deterministic stable problems', () => {
		const referenceCapability = capability('reference-to-video', ['reference-image']);
		const bindings = [
			binding('refs/extra.bhnode', 'reference-image', 6),
			binding('refs/missing.bhnode', 'reference-image', 0),
			binding('refs/changed.bhnode', 'reference-image', 1),
			binding('refs/unverified.bhnode', 'reference-image', 2),
			binding('refs/wrong-kind.bhnode', 'reference-image', 3),
			binding('refs/active.bhnode', 'reference-image', 5),
			binding('refs/unused.bhnode', 'source-video', 4)
		];
		const presentation = createBaseHalfVideoInputsPresentation({
			capability: referenceCapability,
			recipeInputs: recipeInputs(),
			bindings,
			sources: [
				source('refs/changed.bhnode', { integrity: 'changed' }),
				source('refs/unverified.bhnode', { saved: false }),
				source('refs/wrong-kind.bhnode', { kind: 'audio' }),
				source('refs/unused.bhnode', { kind: 'video' }),
				source('refs/active.bhnode'),
				source('refs/extra.bhnode')
			],
			inputEvaluation: evaluation({ 'text-prompt': 1, 'reference-image': 2 }, problem('too-many', 'reference-image', 2, 1, 1))
		});

		assert.deepStrictEqual(presentation.bindings.map(row => [row.binding.order, row.status, row.problem?.kind]), [
			[0, 'source-missing', 'source-missing'],
			[1, 'source-changed', 'source-changed'],
			[2, 'source-unverified', 'source-unverified'],
			[3, 'incompatible', 'incompatible-role'],
			[4, 'unused', 'unused-role'],
			[5, 'active', undefined],
			[6, 'over-capacity', 'over-capacity']
		]);
		assert.strictEqual(presentation.bindings.length, bindings.length);
		assert.strictEqual(presentation.activeBindings.length, 1);
		assert.strictEqual(presentation.needsReview.length, 6);
		assert.deepStrictEqual(presentation.bindings[3].actions, ['replace', 'change-method', 'remove']);
		assert.strictEqual(presentation.readinessProblems.some(candidate => candidate.kind === 'too-many'), true);
	});

	test('classifies persisted source identity and revision without timestamp inference', () => {
		const captured = binding('refs/current.bhnode', 'reference-image', 0);
		assert.strictEqual(baseHalfVideoInputBindingIntegrity(captured, source('refs/current.bhnode')), 'available');
		assert.strictEqual(baseHalfVideoInputBindingIntegrity(captured, source('refs/current.bhnode', {
			sourceId: 'id:replacement'
		})), 'changed');
		assert.strictEqual(baseHalfVideoInputBindingIntegrity(captured, source('refs/current.bhnode', {
			revision: 'sha256:replacement'
		})), 'changed');
		assert.strictEqual(baseHalfVideoInputBindingIntegrity(legacyBinding('refs/current.bhnode', 'reference-image', 0), source('refs/current.bhnode')), 'unverified');
		assert.strictEqual(baseHalfVideoInputBindingIntegrity(captured, source('refs/current.bhnode', {
			revision: undefined
		})), 'unverified');
		assert.strictEqual(baseHalfVideoInputBindingIntegrity(captured, undefined), 'missing');
	});

	test('plans canvas pick only for a saved eligible source and absent edge', () => {
		const context = mutationContext('first-frame-to-video', [], [source('frames/start.bhnode')]);
		const plan = planBaseHalfVideoInputPick({
			...context,
			sourcePath: 'frames/start.bhnode',
			role: 'first-frame',
			edgeState: 'absent'
		});

		assert.deepStrictEqual(plan.afterBindings, [binding('frames/start.bhnode', 'first-frame', 0)]);
		assert.strictEqual(plan.afterBindings[0].sourceId, 'id:frames/start.bhnode');
		assert.strictEqual(plan.afterBindings[0].sourceRevision, 'sha256:test');
		assert.deepStrictEqual(plan.graph, { addSourcePaths: ['frames/start.bhnode'], removeSourcePaths: [] });

		assertMutationKind(() => planBaseHalfVideoInputPick({
			...context,
			sourcePath: 'frames/start.bhnode',
			role: 'first-frame',
			edgeState: 'present'
		}), 'edge-not-absent');

		const unsaved = mutationContext('first-frame-to-video', [], [source('frames/draft.bhnode', { saved: false })]);
		assertMutationKind(() => planBaseHalfVideoInputPick({
			...unsaved,
			sourcePath: 'frames/draft.bhnode',
			role: 'first-frame',
			edgeState: 'absent'
		}), 'source-not-saved');

		const occupied = mutationContext('first-frame-to-video', [binding('frames/start.bhnode', 'first-frame', 0)], [
			source('frames/start.bhnode'),
			source('frames/other.bhnode')
		]);
		assertMutationKind(() => planBaseHalfVideoInputPick({
			...occupied,
			sourcePath: 'frames/other.bhnode',
			role: 'first-frame',
			edgeState: 'absent'
		}), 'role-full');
		assertMutationKind(() => planBaseHalfVideoInputPick({
			...occupied,
			sourcePath: 'frames/start.bhnode',
			role: 'first-frame',
			edgeState: 'absent'
		}), 'source-already-bound');
	});

	test('plans Replace and Remove with exact graph deltas and canonical order', () => {
		const context = mutationContext('first-frame-to-video', [binding('frames/old.bhnode', 'first-frame', 3)], [
			source('frames/old.bhnode'),
			source('frames/new.bhnode')
		]);
		const replaced = planBaseHalfVideoInputReplace({
			...context,
			sourcePath: 'frames/old.bhnode',
			replacementSourcePath: 'frames/new.bhnode',
			currentEdgeState: 'present',
			replacementEdgeState: 'absent'
		});

		assert.deepStrictEqual(replaced.afterBindings, [binding('frames/new.bhnode', 'first-frame', 0)]);
		assert.deepStrictEqual(replaced.graph, {
			addSourcePaths: ['frames/new.bhnode'],
			removeSourcePaths: ['frames/old.bhnode']
		});

		const removed = planBaseHalfVideoInputRemove({
			...context,
			sourcePath: 'frames/old.bhnode',
			edgeState: 'present'
		});
		assert.deepStrictEqual(removed.afterBindings, []);
		assert.deepStrictEqual(removed.graph, { addSourcePaths: [], removeSourcePaths: ['frames/old.bhnode'] });

		assertMutationKind(() => planBaseHalfVideoInputReplace({
			...context,
			sourcePath: 'frames/old.bhnode',
			replacementSourcePath: 'frames/old.bhnode',
			currentEdgeState: 'present',
			replacementEdgeState: 'absent'
		}), 'same-source');
		const inconsistentRemoval = planBaseHalfVideoInputRemove({
			...context,
			sourcePath: 'frames/old.bhnode',
			edgeState: 'inconsistent'
		});
		assert.deepStrictEqual(inconsistentRemoval.afterBindings, []);

		const missingSourceRemoval = planBaseHalfVideoInputRemove({
			...mutationContext('first-frame-to-video', [binding('frames/missing.bhnode', 'first-frame', 0)], []),
			sourcePath: 'frames/missing.bhnode',
			edgeState: 'absent'
		});
		assert.deepStrictEqual(missingSourceRemoval.graph, {
			addSourcePaths: [],
			removeSourcePaths: ['frames/missing.bhnode']
		});
	});

	test('applies an input plan to the persisted binding slice only', () => {
		const before = binding('frames/old.bhnode', 'first-frame', 0);
		const document = createBaseHalfNodeDocument({
			id: 'ecfae9de-f1c4-426d-92d6-b54ca0438f44',
			kind: 'video',
			title: 'Persisted title',
			role: 'Persisted role',
			prompt: 'Persisted prompt',
			recipe: {
				recipeId: 'video.start-frame',
				modelServiceId: 'service',
				modelId: 'model',
				parameters: { duration: 5, aspectRatio: '16:9' },
				inputBindings: [before]
			}
		});
		const plan = planBaseHalfVideoInputRemove({
			...mutationContext('first-frame-to-video', [before], []),
			sourcePath: before.sourcePath,
			edgeState: 'absent'
		});
		const updated = applyBaseHalfVideoInputMutationToDocument({ document, plan });

		assert.deepStrictEqual(updated.recipe?.inputBindings, []);
		assert.strictEqual(updated.title, document.title);
		assert.strictEqual(updated.role, document.role);
		assert.strictEqual(updated.prompt, document.prompt);
		assert.strictEqual(updated.recipe?.recipeId, document.recipe?.recipeId);
		assert.strictEqual(updated.recipe?.modelServiceId, document.recipe?.modelServiceId);
		assert.strictEqual(updated.recipe?.modelId, document.recipe?.modelId);
		assert.strictEqual(updated.recipe?.parameters, document.recipe?.parameters);
		assert.deepStrictEqual(document.recipe?.inputBindings, [before]);

		assertMutationKind(() => applyBaseHalfVideoInputMutationToDocument({
			document: createBaseHalfNodeDocument({
				...document,
				recipe: { ...document.recipe!, inputBindings: [] }
			}),
			plan
		}), 'stale-binding-set');
		assertMutationKind(() => applyBaseHalfVideoInputMutationToDocument({
			document: createBaseHalfNodeDocument({
				id: 'fe188610-5b53-4cb9-a41f-44d5b0a2dd1f',
				kind: 'video',
				title: 'Sealed',
				role: 'Generated video'
			}),
			plan
		}), 'target-not-editable');
	});

	test('plans role conversion only as an explicit binding-only mutation', () => {
		const context = mutationContext('first-last-frame-to-video', [binding('frames/end.bhnode', 'last-frame', 0)], [
			source('frames/end.bhnode')
		]);
		const plan = planBaseHalfVideoInputRoleChange({
			...context,
			sourcePath: 'frames/end.bhnode',
			role: 'first-frame'
		});

		assert.deepStrictEqual(plan.afterBindings, [binding('frames/end.bhnode', 'first-frame', 0)]);
		assert.deepStrictEqual(plan.graph, { addSourcePaths: [], removeSourcePaths: [] });
		assert.deepStrictEqual(context.bindings, [binding('frames/end.bhnode', 'last-frame', 0)]);

		assertMutationKind(() => planBaseHalfVideoInputRoleChange({
			...context,
			sourcePath: 'frames/end.bhnode',
			role: 'last-frame'
		}), 'same-role');

		const full = mutationContext('first-last-frame-to-video', [
			binding('frames/start.bhnode', 'first-frame', 0),
			binding('frames/end.bhnode', 'last-frame', 1)
		], [source('frames/start.bhnode'), source('frames/end.bhnode')]);
		assertMutationKind(() => planBaseHalfVideoInputRoleChange({
			...full,
			sourcePath: 'frames/end.bhnode',
			role: 'first-frame'
		}), 'role-full');
	});

	test('rejects one source in multiple roles and other invalid binding sets', () => {
		const context = mutationContext('first-last-frame-to-video', [binding('Frames/A.bhnode', 'first-frame', 0)], [
			source('Frames/A.bhnode'),
			source('frames/other.bhnode')
		]);
		assertMutationKind(() => planBaseHalfVideoInputPick({
			...context,
			sourcePath: 'Frames/A.bhnode',
			role: 'last-frame',
			edgeState: 'absent'
		}), 'source-already-bound');

		assertMutationKind(() => createBaseHalfVideoInputsPresentation({
			capability: capability('first-last-frame-to-video'),
			recipeInputs: recipeInputs(),
			bindings: [
				binding('Frames/A.bhnode', 'first-frame', 0),
				binding('frames/a.bhnode', 'last-frame', 1)
			],
			sources: [source('Frames/A.bhnode')],
			inputEvaluation: evaluation({})
		}), 'invalid-binding-set');
	});

	test('reorders only within one role and leaves graph state unchanged', () => {
		const referenceCapability = capability('reference-to-video', ['reference-image']);
		const context: IBaseHalfVideoInputMutationContext = {
			capability: { ...referenceCapability, inputs: referenceCapability.inputs.map(input => input.kind === 'reference-image' ? { ...input, maxItems: 3 } : input) },
			recipeInputs: recipeInputs().map(input => input.id === 'reference-image' ? { ...input, maxItems: 3 } : input),
			bindings: [
				binding('refs/a.bhnode', 'reference-image', 0),
				binding('clips/source.bhnode', 'source-video', 1),
				binding('refs/b.bhnode', 'reference-image', 2)
			],
			sources: [
				source('refs/a.bhnode'),
				source('clips/source.bhnode', { kind: 'video' }),
				source('refs/b.bhnode')
			]
		};
		const plan = planBaseHalfVideoInputReorder({ ...context, sourcePath: 'refs/b.bhnode', direction: -1 });

		assert.deepStrictEqual(plan.afterBindings.map(binding => binding.sourcePath), [
			'refs/b.bhnode',
			'clips/source.bhnode',
			'refs/a.bhnode'
		]);
		assert.deepStrictEqual(plan.graph, { addSourcePaths: [], removeSourcePaths: [] });
		assertMutationKind(() => planBaseHalfVideoInputReorder({ ...context, sourcePath: 'refs/a.bhnode', direction: -1 }), 'move-unavailable');
	});
});

function capability(
	mode: BaseHalfVideoGenerationMode,
	additionalInputs: readonly BaseHalfVideoInputKind[] = []
): IBaseHalfVideoModeCapability {
	const inputs: IBaseHalfVideoModeCapability['inputs'][number][] = [
		{ kind: 'text-prompt', minItems: 1, maxItems: 1, maxCharacters: 16_000 }
	];
	if (mode === 'first-frame-to-video' || mode === 'first-last-frame-to-video') {
		inputs.push({ kind: 'first-frame', minItems: 1, maxItems: 1 });
	}
	if (mode === 'first-last-frame-to-video') {
		inputs.push({ kind: 'last-frame', minItems: 1, maxItems: 1 });
	}
	for (const input of additionalInputs) {
		inputs.push({ kind: input, minItems: 1, maxItems: 1 });
	}
	return { mode, inputs, parameters: [], constraints: [] };
}

function recipeInputs(): readonly IBaseHalfCanvasRecipeInputDefinition[] {
	return [
		recipeInput('first-frame', ['image'], 1),
		recipeInput('last-frame', ['image'], 1),
		recipeInput('reference-image', ['image'], 1),
		recipeInput('source-video', ['video'], 1),
		recipeInput('audio', ['audio'], 1)
	];
}

function recipeInput(id: string, accepts: readonly BaseHalfCanvasContentKind[], maxItems: number): IBaseHalfCanvasRecipeInputDefinition {
	return { id, label: id, accepts, minItems: 0, maxItems };
}

function binding(
	sourcePath: string,
	slot: string,
	order: number,
	overrides: Partial<IBaseHalfNodeInputBinding> = {}
): IBaseHalfNodeInputBinding {
	return {
		sourcePath,
		slot,
		order,
		sourceId: `id:${sourcePath}`,
		sourceRevision: 'sha256:test',
		...overrides
	};
}

function legacyBinding(sourcePath: string, slot: string, order: number): IBaseHalfNodeInputBinding {
	return { sourcePath, slot, order };
}

function source(
	sourcePath: string,
	overrides: Partial<IBaseHalfVideoInputSourceState> = {}
): IBaseHalfVideoInputSourceState {
	return {
		sourcePath,
		sourceId: `id:${sourcePath}`,
		title: sourcePath,
		kind: 'image',
		saved: true,
		integrity: 'available',
		revision: 'sha256:test',
		...overrides
	};
}

function evaluation(
	inputs: BaseHalfVideoInputState,
	...problems: readonly IBaseHalfVideoInputProblem[]
): IBaseHalfVideoInputEvaluation {
	return { ready: problems.length === 0, inputs, problems };
}

function problem(
	kind: IBaseHalfVideoInputProblem['kind'],
	input: BaseHalfVideoInputKind,
	actualCount: number,
	minimum: number,
	maximum: number
): IBaseHalfVideoInputProblem {
	return { kind, input, actualCount, minimum, maximum, reason: 'Stable test diagnostic.' };
}

function mutationContext(
	mode: BaseHalfVideoGenerationMode,
	bindings: readonly IBaseHalfNodeInputBinding[],
	sources: readonly IBaseHalfVideoInputSourceState[]
): IBaseHalfVideoInputMutationContext {
	return { capability: capability(mode), recipeInputs: recipeInputs(), bindings, sources };
}

function assertMutationKind(block: () => unknown, kind: BaseHalfVideoInputMutationProblemKind): void {
	assert.throws(block, error => error instanceof BaseHalfVideoInputMutationError && error.kind === kind);
}
