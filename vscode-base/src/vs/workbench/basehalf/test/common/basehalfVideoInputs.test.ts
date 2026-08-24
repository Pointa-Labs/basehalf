/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import type { BaseHalfCanvasContentKind, IBaseHalfCanvasRecipeInputDefinition } from '../../common/basehalfCanvasRecipes.js';
import { createBaseHalfNodeDocument, IBaseHalfNodeInputBinding } from '../../common/basehalfNodeDocument.js';
import {
	acceptBaseHalfVideoCanvasPickSelection,
	acquireBaseHalfVideoInputTransaction,
	applyBaseHalfVideoInputMutationToDocument,
	baseHalfVideoCanvasPickDraftRevisionIsCurrent,
	baseHalfVideoCanvasPickSelectionIsActive,
	baseHalfVideoInputTransactionIsCurrent,
	baseHalfVideoInputBindingIntegrity,
	beginBaseHalfVideoCanvasPick,
	BaseHalfVideoInputMutationError,
	BaseHalfVideoInputMutationProblemKind,
	cancelBaseHalfVideoCanvasPick,
	completeBaseHalfVideoCanvasPick,
	confirmBaseHalfVideoDocumentWriteAcknowledgement,
	consumeBaseHalfVideoCanvasPickDeferredFocus,
	createBaseHalfVideoCanvasPickState,
	createBaseHalfVideoDocumentWriteAcknowledgement,
	createBaseHalfVideoInputTransactionOwnerState,
	createBaseHalfVideoInputsPresentation,
	getBaseHalfVideoCanvasPickInteraction,
	getBaseHalfVideoInputsExecutionGate,
	IBaseHalfVideoCanvasPickRequest,
	IBaseHalfVideoInputMutationContext,
	IBaseHalfVideoInputSourceState,
	markBaseHalfVideoCanvasPickCommitting,
	markBaseHalfVideoCanvasPickReady,
	markBaseHalfVideoCanvasPickRevalidating,
	observeBaseHalfVideoDocumentVersion,
	planBaseHalfVideoFrameSwap,
	planBaseHalfVideoInputPick,
	planBaseHalfVideoInputRemove,
	planBaseHalfVideoInputReorder,
	planBaseHalfVideoInputReplace,
	planBaseHalfVideoInputRoleChange,
	releaseBaseHalfVideoInputTransaction,
	settleBaseHalfVideoDocumentWriteAcknowledgement,
	updateBaseHalfVideoCanvasPickViewport
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

	test('rejects a concurrent End removal while Start owns the input transaction', () => {
		const bindings = [
			binding('frames/start.bhnode', 'first-frame', 0),
			binding('frames/end.bhnode', 'last-frame', 1)
		];
		const context = mutationContext('first-last-frame-to-video', bindings, [
			source('frames/start.bhnode'),
			source('frames/end.bhnode')
		]);
		let owner = createBaseHalfVideoInputTransactionOwnerState();
		const start = acquireBaseHalfVideoInputTransaction(owner);
		owner = start.state;
		const end = acquireBaseHalfVideoInputTransaction(owner);

		assert.strictEqual(start.transactionId, 1);
		assert.strictEqual(end.transactionId, undefined);
		assert.strictEqual(end.state, owner);
		assert.strictEqual(baseHalfVideoInputTransactionIsCurrent(owner, start.transactionId!), true);

		const startRemoval = planBaseHalfVideoInputRemove({
			...context,
			sourcePath: 'frames/start.bhnode',
			edgeState: 'present'
		});
		assert.deepStrictEqual(startRemoval.afterBindings, [binding('frames/end.bhnode', 'last-frame', 0)]);
		assert.deepStrictEqual(startRemoval.graph, {
			addSourcePaths: [],
			removeSourcePaths: ['frames/start.bhnode']
		});

		owner = releaseBaseHalfVideoInputTransaction(owner, start.transactionId!);
		assert.strictEqual(baseHalfVideoInputTransactionIsCurrent(owner, start.transactionId!), false);
		const endAfterStartSettles = acquireBaseHalfVideoInputTransaction(owner);
		assert.strictEqual(endAfterStartSettles.transactionId, 2);
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

	test('fails unknown roles and source kinds closed without contaminating readable siblings', () => {
		const bindings = [
			binding('frames/missing.bhnode', 'first-frame', 0),
			binding('frames/end.bhnode', 'last-frame', 1),
			binding('refs/unknown-role.bhnode', 'future-role', 2),
			binding('refs/unknown-kind.bhnode', 'reference-image', 3)
		];
		const presentation = createBaseHalfVideoInputsPresentation({
			capability: capability('first-last-frame-to-video', ['reference-image']),
			recipeInputs: recipeInputs(),
			bindings,
			sources: [
				source('frames/end.bhnode'),
				source('refs/unknown-role.bhnode'),
				source('refs/unknown-kind.bhnode', { kind: undefined })
			],
			inputEvaluation: evaluation({
				'text-prompt': 1,
				'first-frame': 1,
				'last-frame': 1,
				'reference-image': 1
			})
		});

		assert.deepStrictEqual(presentation.bindings.map(row => [row.binding.sourcePath, row.status]), [
			['frames/missing.bhnode', 'source-missing'],
			['frames/end.bhnode', 'active'],
			['refs/unknown-role.bhnode', 'incompatible'],
			['refs/unknown-kind.bhnode', 'incompatible']
		]);
		assert.strictEqual(presentation.frameSlots[1].source?.sourcePath, 'frames/end.bhnode');
		assert.strictEqual(presentation.frameSlots[1].problem, undefined);
		assert.strictEqual(presentation.needsReview.length, 3);
	});

	test('orders current missing frame blockers before retained binding review and exposes a strict execution gate', () => {
		const presentation = createBaseHalfVideoInputsPresentation({
			capability: capability('first-last-frame-to-video'),
			recipeInputs: recipeInputs(),
			bindings: [binding('frames/end.bhnode', 'last-frame', 0)],
			sources: [source('frames/end.bhnode', { integrity: 'changed' })],
			inputEvaluation: evaluation(
				{ 'text-prompt': 1, 'last-frame': 1 },
				problem('too-few', 'first-frame', 0, 1, 1)
			)
		});

		assert.deepStrictEqual(presentation.readinessProblems.map(candidate => candidate.kind), [
			'missing-start-frame',
			'source-changed'
		]);
		assert.deepStrictEqual(getBaseHalfVideoInputsExecutionGate(presentation), {
			ready: false,
			problem: presentation.readinessProblems[0]
		});

		const ready = createBaseHalfVideoInputsPresentation({
			capability: capability('first-last-frame-to-video'),
			recipeInputs: recipeInputs(),
			bindings: [
				binding('frames/start.bhnode', 'first-frame', 0),
				binding('frames/end.bhnode', 'last-frame', 1)
			],
			sources: [source('frames/start.bhnode'), source('frames/end.bhnode')],
			inputEvaluation: evaluation({ 'text-prompt': 1, 'first-frame': 1, 'last-frame': 1 })
			});
			assert.deepStrictEqual(getBaseHalfVideoInputsExecutionGate(ready), { ready: true });
			assert.strictEqual(baseHalfVideoCanvasPickSelectionIsActive(ready, 'frames/start.bhnode', 'first-frame'), true);
			assert.strictEqual(baseHalfVideoCanvasPickSelectionIsActive(ready, 'frames/end.bhnode', 'first-frame'), false);
		});

	test('keeps canvas-pick epoch stable across pan and zoom and accepts one selection', () => {
		const idle = createBaseHalfVideoCanvasPickState();
		const preflighting = beginBaseHalfVideoCanvasPick(idle, canvasPickRequest());
			assert.strictEqual(preflighting.phase, 'preflighting');
			assert.strictEqual(preflighting.epoch, 1);
			assert.deepStrictEqual(getBaseHalfVideoCanvasPickInteraction(preflighting), {
				viewportNavigationAllowed: true,
				nodeGeometryGesturesDisabled: true,
				acceptsSelection: false,
				cancelAllowed: true
			});

			const preflightPanned = updateBaseHalfVideoCanvasPickViewport(preflighting, preflighting.epoch, false);
			assert.strictEqual(preflightPanned.targetVisible, false);
			assert.strictEqual(preflightPanned.candidateLayoutRevision, preflighting.candidateLayoutRevision + 1);
			const ready = markBaseHalfVideoCanvasPickReady(preflightPanned, preflightPanned.epoch);
			const panned = updateBaseHalfVideoCanvasPickViewport(ready, ready.epoch, false);
			const zoomed = updateBaseHalfVideoCanvasPickViewport(panned, panned.epoch, true);
		assert.strictEqual(zoomed.epoch, ready.epoch);
		assert.strictEqual(zoomed.request, ready.request);
		assert.strictEqual(zoomed.candidateLayoutRevision, ready.candidateLayoutRevision + 2);
		assert.deepStrictEqual(getBaseHalfVideoCanvasPickInteraction(zoomed), {
			viewportNavigationAllowed: true,
			nodeGeometryGesturesDisabled: true,
			acceptsSelection: true,
			cancelAllowed: true
		});

			const accepting = acceptBaseHalfVideoCanvasPickSelection(zoomed, zoomed.epoch);
			assert.strictEqual(accepting.phase, 'accepting');
			assert.strictEqual(acceptBaseHalfVideoCanvasPickSelection(accepting, accepting.epoch), accepting);
			const acceptingOffscreen = updateBaseHalfVideoCanvasPickViewport(accepting, accepting.epoch, false);
			assert.strictEqual(acceptingOffscreen.targetVisible, false);
			assert.deepStrictEqual(getBaseHalfVideoCanvasPickInteraction(acceptingOffscreen), {
				viewportNavigationAllowed: true,
				nodeGeometryGesturesDisabled: true,
				acceptsSelection: false,
				cancelAllowed: true
			});
			const revalidating = markBaseHalfVideoCanvasPickRevalidating(acceptingOffscreen, acceptingOffscreen.epoch);
			const revalidatingVisible = updateBaseHalfVideoCanvasPickViewport(revalidating, revalidating.epoch, true);
			assert.strictEqual(revalidatingVisible.targetVisible, true);
			const committing = markBaseHalfVideoCanvasPickCommitting(revalidatingVisible, revalidatingVisible.epoch);
			const committingOffscreen = updateBaseHalfVideoCanvasPickViewport(committing, committing.epoch, false);
			assert.strictEqual(committingOffscreen.targetVisible, false);
			assert.deepStrictEqual(getBaseHalfVideoCanvasPickInteraction(committingOffscreen), {
				viewportNavigationAllowed: true,
				nodeGeometryGesturesDisabled: true,
				acceptsSelection: false,
				cancelAllowed: false
			});
			assert.strictEqual(markBaseHalfVideoCanvasPickReady(accepting, accepting.epoch), accepting);
		});

	test('captures the durable checkpoint revision only when pick becomes ready', () => {
		const preflighting = beginBaseHalfVideoCanvasPick(createBaseHalfVideoCanvasPickState(), canvasPickRequest({
			expectedDraftRevision: 'etag:before-checkpoint'
		}));
		const ready = markBaseHalfVideoCanvasPickReady(preflighting, preflighting.epoch, 'etag:durable-checkpoint');
		assert.strictEqual(ready.phase, 'ready');
		assert.strictEqual(ready.request?.expectedDraftRevision, 'etag:durable-checkpoint');
		assert.strictEqual(preflighting.request?.expectedDraftRevision, 'etag:before-checkpoint');
		assert.strictEqual(baseHalfVideoCanvasPickDraftRevisionIsCurrent(ready, ready.epoch, 'etag:durable-checkpoint'), true);
		assert.strictEqual(baseHalfVideoCanvasPickDraftRevisionIsCurrent(ready, ready.epoch, 'etag:same-configuration-new-write'), false);
		assert.strictEqual(baseHalfVideoCanvasPickDraftRevisionIsCurrent(ready, ready.epoch + 1, 'etag:durable-checkpoint'), false);
	});

	test('defers off-screen pick focus for the exact selected target and consumes it once', () => {
			let state = beginBaseHalfVideoCanvasPick(createBaseHalfVideoCanvasPickState(), canvasPickRequest({
				returnFocusKey: 'video-overlay:inputs:input:pick:first-frame'
			}));
			const epoch = state.epoch;
			assert.strictEqual(state.request?.returnFocusKey, 'video-overlay:inputs:input:pick:first-frame');
			state = markBaseHalfVideoCanvasPickReady(state, epoch);
		state = updateBaseHalfVideoCanvasPickViewport(state, epoch, false);
		state = acceptBaseHalfVideoCanvasPickSelection(state, epoch);
		state = markBaseHalfVideoCanvasPickRevalidating(state, epoch);
		state = markBaseHalfVideoCanvasPickCommitting(state, epoch);

		assert.strictEqual(cancelBaseHalfVideoCanvasPick(state, epoch), state);
		assert.strictEqual(completeBaseHalfVideoCanvasPick(state, epoch, false).state, state);
			const completed = completeBaseHalfVideoCanvasPick(state, epoch, true, 'video:input:first-frame');
		assert.strictEqual(completed.state.phase, 'idle');
		assert.strictEqual(completed.reopenInputs, false);
		assert.strictEqual(completed.focusKey, undefined);
		assert.strictEqual(completed.state.deferredFocus?.epoch, epoch);

		const wrongTarget = consumeBaseHalfVideoCanvasPickDeferredFocus(completed.state, {
			sceneKey: 'scene-a',
			targetNodePath: 'shots/other.bhnode',
			targetNodeId: 'node-a',
			selected: true,
			visible: true
		});
		assert.strictEqual(wrongTarget.state, completed.state);
		assert.strictEqual(wrongTarget.focusKey, undefined);

		const restored = consumeBaseHalfVideoCanvasPickDeferredFocus(completed.state, {
			sceneKey: 'scene-a',
			targetNodePath: 'shots/video.bhnode',
			targetNodeId: 'node-a',
			selected: true,
			visible: true
		});
		assert.strictEqual(restored.focusKey, 'video:input:first-frame');
		assert.strictEqual(restored.state.deferredFocus, undefined);
		assert.strictEqual(consumeBaseHalfVideoCanvasPickDeferredFocus(restored.state, {
			sceneKey: 'scene-a',
			targetNodePath: 'shots/video.bhnode',
			targetNodeId: 'node-a',
			selected: true,
			visible: true
		}).focusKey, undefined);
	});

	test('cancellation and re-entry allocate a fresh epoch and ignore stale continuations', () => {
		const first = beginBaseHalfVideoCanvasPick(createBaseHalfVideoCanvasPickState(), canvasPickRequest());
		const cancelled = cancelBaseHalfVideoCanvasPick(first, first.epoch);
		assert.strictEqual(cancelled.phase, 'idle');
		const second = beginBaseHalfVideoCanvasPick(cancelled, canvasPickRequest({ requestedRole: 'last-frame' }));
		assert.strictEqual(second.epoch, first.epoch + 1);
		assert.strictEqual(second.request?.requestedRole, 'last-frame');
		assert.strictEqual(markBaseHalfVideoCanvasPickReady(second, first.epoch), second);
		assert.strictEqual(cancelBaseHalfVideoCanvasPick(second, first.epoch), second);
		assert.strictEqual(markBaseHalfVideoCanvasPickReady(second, second.epoch).phase, 'ready');
	});

	test('distinguishes own intermediate versions, expected durable acknowledgement, and external revisions', () => {
		let acknowledgement = createBaseHalfVideoDocumentWriteAcknowledgement(
			'configuration:expected',
			{ configurationKey: 'configuration:previous', etag: 'etag:1' }
		);
		const intermediate = observeBaseHalfVideoDocumentVersion(
			acknowledgement,
			{ configurationKey: 'configuration:intermediate', etag: 'etag:2' },
			false
		);
		assert.strictEqual(intermediate.classification, 'own-intermediate');
		assert.strictEqual(intermediate.rereadRequired, true);
		acknowledgement = intermediate.acknowledgement;

		const watcherExpected = observeBaseHalfVideoDocumentVersion(
			acknowledgement,
			{ configurationKey: 'configuration:expected', etag: 'etag:3' },
			false
		);
		assert.strictEqual(watcherExpected.classification, 'own-intermediate');
		assert.strictEqual(watcherExpected.acknowledgement.phase, 'pending-write');

		const durableExpected = observeBaseHalfVideoDocumentVersion(
			watcherExpected.acknowledgement,
			{ configurationKey: 'configuration:expected', etag: 'etag:3' },
			true
		);
		assert.strictEqual(durableExpected.classification, 'expected');
		assert.strictEqual(durableExpected.acknowledgement.phase, 'observed-expected');
		assert.strictEqual(durableExpected.rereadRequired, false);

		const oldEcho = observeBaseHalfVideoDocumentVersion(
			durableExpected.acknowledgement,
			{ configurationKey: 'configuration:intermediate', etag: 'etag:2' },
			false
		);
		assert.strictEqual(oldEcho.classification, 'own-echo');
		const rewrittenPrevious = observeBaseHalfVideoDocumentVersion(
			durableExpected.acknowledgement,
			{ configurationKey: 'configuration:previous', etag: 'etag:4' },
			true
		);
		assert.strictEqual(rewrittenPrevious.classification, 'external');
		const rewrittenExpected = observeBaseHalfVideoDocumentVersion(
			durableExpected.acknowledgement,
			{ configurationKey: 'configuration:expected', etag: 'etag:5' },
			true
		);
		assert.strictEqual(rewrittenExpected.classification, 'external');

		const settled = settleBaseHalfVideoDocumentWriteAcknowledgement(durableExpected.acknowledgement);
		assert.strictEqual(settled.phase, 'settled');
		assert.strictEqual(Object.isFrozen(settled.ownVersions), true);
		const refreshedExpected = observeBaseHalfVideoDocumentVersion(
			settled,
			{ configurationKey: 'configuration:expected', etag: 'etag:3' },
			true
		);
		assert.strictEqual(refreshedExpected.classification, 'expected');
		assert.strictEqual(refreshedExpected.rereadRequired, false);

		const sameConfiguration = createBaseHalfVideoDocumentWriteAcknowledgement(
			'configuration:same',
			{ configurationKey: 'configuration:same', etag: 'etag:old' }
		);
		const staleDurableRead = observeBaseHalfVideoDocumentVersion(
			sameConfiguration,
			{ configurationKey: 'configuration:same', etag: 'etag:old' },
			true
		);
		assert.strictEqual(staleDurableRead.classification, 'own-echo');
		assert.strictEqual(staleDurableRead.rereadRequired, true);
		assert.strictEqual(staleDurableRead.acknowledgement.phase, 'pending-write');
		const rewrittenSameConfiguration = observeBaseHalfVideoDocumentVersion(
			staleDurableRead.acknowledgement,
			{ configurationKey: 'configuration:same', etag: 'etag:new' },
			true
		);
		assert.strictEqual(rewrittenSameConfiguration.classification, 'expected');
		assert.strictEqual(rewrittenSameConfiguration.acknowledgement.phase, 'observed-expected');
		const confirmedSameConfiguration = confirmBaseHalfVideoDocumentWriteAcknowledgement(
			sameConfiguration,
			{ configurationKey: 'configuration:same', etag: 'etag:new' }
		);
		assert.strictEqual(confirmedSameConfiguration.confirmed, true);
		assert.strictEqual(confirmedSameConfiguration.acknowledgement?.phase, 'settled');
		const durableMismatch = confirmBaseHalfVideoDocumentWriteAcknowledgement(
			createBaseHalfVideoDocumentWriteAcknowledgement(
				'configuration:expected',
				{ configurationKey: 'configuration:previous', etag: 'etag:old' }
			),
			{ configurationKey: 'configuration:external', etag: 'etag:new' }
		);
		assert.strictEqual(durableMismatch.confirmed, false);
		assert.strictEqual(durableMismatch.acknowledgement, undefined);

		const nextWrite = createBaseHalfVideoDocumentWriteAcknowledgement(
			'configuration:next',
			{ configurationKey: 'configuration:expected', etag: 'etag:3' },
			settled.ownVersions
		);
		const priorTransactionEcho = observeBaseHalfVideoDocumentVersion(
			nextWrite,
			{ configurationKey: 'configuration:intermediate', etag: 'etag:2' },
			true
		);
		assert.strictEqual(priorTransactionEcho.classification, 'own-echo');
		assert.strictEqual(priorTransactionEcho.rereadRequired, true);
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

function canvasPickRequest(overrides: Partial<{
	readonly sceneKey: string;
	readonly targetNodePath: string;
	readonly targetNodeId: string;
	readonly expectedDraftRevision: string;
	readonly recipeId: string;
	readonly requestedRole: string;
	readonly returnFocusKey: string;
}> = {}): Omit<IBaseHalfVideoCanvasPickRequest, 'epoch'> {
	return {
		sceneKey: 'scene-a',
		targetNodePath: 'shots/video.bhnode',
		targetNodeId: 'node-a',
		expectedDraftRevision: 'etag:draft',
		recipeId: 'video.generate',
		requestedRole: 'first-frame',
		returnFocusKey: 'video:input:first-frame',
		...overrides
	};
}

function assertMutationKind(block: () => unknown, kind: BaseHalfVideoInputMutationProblemKind): void {
	assert.throws(block, error => error instanceof BaseHalfVideoInputMutationError && error.kind === kind);
}
