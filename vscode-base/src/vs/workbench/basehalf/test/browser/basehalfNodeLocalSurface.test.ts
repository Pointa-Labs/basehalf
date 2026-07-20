/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { AnchorAlignment, AnchorAxisAlignment, AnchorPosition } from '../../../../base/common/layout.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BaseHalfNodeLocalDraftExitCoordinator,
	baseHalfNodeArtifactUsesTextPreview,
	baseHalfNodeCanImportContentKind,
	baseHalfNodeImportActionLabel,
	baseHalfNodeLocalPrimaryActionOpensSurface,
	baseHalfNodeLocalSurfaceTargetOwnsEscape,
	chooseBaseHalfNodeConnectionSlot,
	configureBaseHalfNodeLocalSurfaceAccessibility,
	createBaseHalfNodeModelSelection,
	createBaseHalfNodeParameterDraft,
	decodeBaseHalfNodeTextPreview,
	getBaseHalfNodeAvailableInputSlots,
	getBaseHalfNodeAssignableInputSlots,
	getBaseHalfNodeCardStatusText,
	getBaseHalfNodeHistoricalArtifactOpenProblem,
	getBaseHalfNodeImportHistoryProblem,
	getBaseHalfNodeInputCurrentVersionLabel,
	getBaseHalfNodeInputStructureProblem,
	getBaseHalfNodeInputRows,
	getBaseHalfNodeLocalExecutionState,
	getBaseHalfNodeLocalState,
	getBaseHalfNodeModelSelectionProblem,
	getBaseHalfNodeRunDisclosureLines,
	getBaseHalfNodeRunHistoryDetail,
	isBaseHalfNodeCardStatusPositive,
	IBaseHalfNodeLocalConfigurationDraft,
	mergeBaseHalfNodeLocalConfigurationDraft,
	moveBaseHalfNodeInputBinding,
	parseBaseHalfNodeParameterDraft,
	resolveBaseHalfNodeLocalDraftExit,
	resolveBaseHalfNodeLocalSurfacePlacement,
	resolveBaseHalfNodeRecipeDraft
} from '../../browser/basehalfNodeLocalSurface.js';
import { IBaseHalfCanvasRecipeDescriptor } from '../../common/basehalfCanvasRecipes.js';
import { IBaseHalfModelServiceDescriptor } from '../../common/basehalfModelServices.js';
import {
	beginBaseHalfNodeRun,
	completeBaseHalfNodeRun,
	createBaseHalfNodeDocument,
	failBaseHalfNodeRun,
	IBaseHalfNodeDocument,
	importBaseHalfNodeCurrent
} from '../../common/basehalfNodeDocument.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';

suite('BaseHalfNodeLocalSurface', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps focused controls inside a stably named non-modal node dialog', () => {
		const fixture = document.createElement('div');
		document.body.appendChild(fixture);
		try {
			const surface = document.createElement('div');
			const title = document.createElement('div');
			title.textContent = 'Storyboard frame';
			const control = document.createElement('button');
			surface.append(title, control);
			fixture.appendChild(surface);

			configureBaseHalfNodeLocalSurfaceAccessibility(surface, title, baseHalfNodeTestId(1));
			control.focus();

			assert.strictEqual(document.activeElement, control);
			assert.strictEqual(surface.getAttribute('role'), 'dialog');
			assert.strictEqual(surface.getAttribute('aria-modal'), 'false');
			assert.strictEqual(surface.getAttribute('aria-labelledby'), title.id);
			assert.strictEqual(title.id, `basehalf-node-local-title-${baseHalfNodeTestId(1)}`);
			assert.strictEqual(surface.querySelector(`[id="${title.id}"]`), title);
		} finally {
			fixture.remove();
		}
	});

	test('requires an explicit successful resolution before a changed draft can close', async () => {
		let saves = 0;
		assert.strictEqual(await resolveBaseHalfNodeLocalDraftExit(false, async () => {
			throw new Error('No decision should be requested for an unchanged draft.');
		}, async () => {
			saves++;
			return true;
		}), true);
		assert.strictEqual(saves, 0);

		assert.strictEqual(await resolveBaseHalfNodeLocalDraftExit(true, async () => 'keep', async () => {
			saves++;
			return true;
		}), false);
		assert.strictEqual(saves, 0);
		assert.strictEqual(await resolveBaseHalfNodeLocalDraftExit(true, async () => 'discard', async () => {
			saves++;
			return true;
		}), true);
		assert.strictEqual(saves, 0);
		assert.strictEqual(await resolveBaseHalfNodeLocalDraftExit(true, async () => 'save', async () => {
			saves++;
			return false;
		}), false);
		assert.strictEqual(saves, 1);
		assert.strictEqual(await resolveBaseHalfNodeLocalDraftExit(true, async () => 'save', async () => {
			saves++;
			return true;
		}), true);
		assert.strictEqual(saves, 2);
	});

	test('shares one pending draft decision between view dismissal and shutdown', async () => {
		const coordinator = new BaseHalfNodeLocalDraftExitCoordinator();
		let decisions = 0;
		let resolveDecision: ((decision: 'keep') => void) | undefined;
		const decision = new Promise<'keep'>(resolve => resolveDecision = resolve);
		const operation = () => resolveBaseHalfNodeLocalDraftExit(true, async () => {
			decisions++;
			return decision;
		}, async () => true);

		const hiddenSurface = coordinator.request(operation);
		const shutdown = coordinator.request(operation);
		assert.strictEqual(hiddenSurface, shutdown);
		assert.strictEqual(coordinator.isPending, true);
		resolveDecision?.('keep');
		assert.strictEqual(await shutdown, false);
		assert.strictEqual(decisions, 1);
		assert.strictEqual(coordinator.isPending, false);

		assert.strictEqual(await coordinator.request(async () => true), true);
	});

	test('lets the focused native choice close before the node dialog', () => {
		const select = document.createElement('select');
		const option = document.createElement('option');
		select.appendChild(option);
		assert.strictEqual(baseHalfNodeLocalSurfaceTargetOwnsEscape(select), true);
		assert.strictEqual(baseHalfNodeLocalSurfaceTargetOwnsEscape(option), true);
		assert.strictEqual(baseHalfNodeLocalSurfaceTargetOwnsEscape(document.createElement('input')), false);
	});

	test('places the node surface on the roomiest adjacent side', () => {
		const toRight = resolveBaseHalfNodeLocalSurfacePlacement(
			{ left: 100, top: 300, right: 300, bottom: 500 },
			{ width: 1400, height: 900 }
		);
		assert.deepStrictEqual(toRight, {
			side: 'right',
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.HORIZONTAL,
			anchorPosition: AnchorPosition.BELOW
		});

		const toLeft = resolveBaseHalfNodeLocalSurfacePlacement(
			{ left: 1000, top: 300, right: 1200, bottom: 500 },
			{ width: 1400, height: 900 }
		);
		assert.strictEqual(toLeft.side, 'left');
		assert.strictEqual(toLeft.anchorAlignment, AnchorAlignment.RIGHT);
		assert.strictEqual(toLeft.anchorAxisAlignment, AnchorAxisAlignment.HORIZONTAL);

		const below = resolveBaseHalfNodeLocalSurfacePlacement(
			{ left: 430, top: 40, right: 630, bottom: 180 },
			{ width: 1060, height: 1200 }
		);
		assert.strictEqual(below.side, 'below');
		assert.strictEqual(below.anchorAxisAlignment, AnchorAxisAlignment.VERTICAL);
		assert.strictEqual(below.anchorPosition, AnchorPosition.BELOW);

		const above = resolveBaseHalfNodeLocalSurfacePlacement(
			{ left: 430, top: 1020, right: 630, bottom: 1160 },
			{ width: 1060, height: 1200 }
		);
		assert.strictEqual(above.side, 'above');
		assert.strictEqual(above.anchorPosition, AnchorPosition.ABOVE);
	});

	test('keeps Edit explicit when the primary action performs work', () => {
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'add', label: 'Add content' }), true);
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'configure', label: 'Configure' }), true);
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'run', label: 'Run' }), false);
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'runAgain', label: 'Run again' }), false);
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'cancel', label: 'Cancel' }), false);
	});

	test('rebases unsaved fields over independent external configuration changes', () => {
		const base = localConfigurationDraft();
		const local = { ...base, title: 'Local title' };
		const external = {
			...base,
			role: 'external-role',
			inputBindings: [{ sourcePath: 'reference.png', slot: 'reference', order: 0 }]
		};

		const merged = mergeBaseHalfNodeLocalConfigurationDraft(base, local, external);
		assert.deepStrictEqual(merged.conflicts, []);
		assert.strictEqual(merged.draft.title, 'Local title');
		assert.strictEqual(merged.draft.role, 'external-role');
		assert.deepStrictEqual(merged.draft.inputBindings, external.inputBindings);
	});

	test('reports overlapping external edits without replacing the local draft', () => {
		const base = localConfigurationDraft();
		const local = { ...base, title: 'Local title', modelId: 'local-model' };
		const external = { ...base, title: 'External title', modelId: 'external-model' };

		const merged = mergeBaseHalfNodeLocalConfigurationDraft(base, local, external);
		assert.deepStrictEqual(merged.conflicts, ['Title', 'Model ID']);
		assert.strictEqual(merged.draft.title, 'Local title');
		assert.strictEqual(merged.draft.modelId, 'local-model');
	});

	test('treats a recipe replacement and old-recipe parameter edit as one explicit conflict', () => {
		const base = localConfigurationDraft();
		const local = { ...base, parameters: { prompt: 'Local prompt' } };
		const external = { ...base, recipeId: 'pointa.recipe.other', parameters: { prompt: 'External default' } };

		const merged = mergeBaseHalfNodeLocalConfigurationDraft(base, local, external);
		assert.deepStrictEqual(merged.conflicts, ['Recipe']);
		assert.strictEqual(merged.draft.recipeId, base.recipeId);
		assert.deepStrictEqual(merged.draft.parameters, local.parameters);
	});

	test('accepts an external save that already matches the local draft', () => {
		const base = localConfigurationDraft();
		const local = { ...base, title: 'Shared title' };
		const external = { ...base, title: 'Shared title' };

		const merged = mergeBaseHalfNodeLocalConfigurationDraft(base, local, external);
		assert.deepStrictEqual(merged.conflicts, []);
		assert.strictEqual(merged.draft.title, 'Shared title');
	});

	test('keeps local direct-input choices when the same binding changed elsewhere', () => {
		const base = {
			...localConfigurationDraft(),
			inputBindings: [{ sourcePath: 'brief.md', slot: 'context', order: 0 }]
		};
		const local = {
			...base,
			inputBindings: [{ sourcePath: 'brief.md', slot: 'style', order: 0 }]
		};
		const external = {
			...base,
			inputBindings: [{ sourcePath: 'brief.md', slot: 'reference', order: 0 }]
		};

		const merged = mergeBaseHalfNodeLocalConfigurationDraft(base, local, external);
		assert.deepStrictEqual(merged.conflicts, ['Direct inputs']);
		assert.deepStrictEqual(merged.draft.inputBindings, local.inputBindings);
	});

	test('blocks opening historical outputs whose recorded bytes are no longer available', () => {
		assert.strictEqual(
			getBaseHalfNodeHistoricalArtifactOpenProblem('outputs/run/frame.png', 'available'),
			undefined
		);

		const missing = getBaseHalfNodeHistoricalArtifactOpenProblem('outputs/run/frame.png', 'missing');
		assert.match(missing ?? '', /historical output is missing/);
		assert.match(missing ?? '', /another version in History/);
		assert.match(missing ?? '', /run the node again/);

		const changed = getBaseHalfNodeHistoricalArtifactOpenProblem('outputs/run/frame.png', 'changed');
		assert.match(changed ?? '', /historical output changed on disk/);
		assert.match(changed ?? '', /another version in History/);
		assert.match(changed ?? '', /run the node again/);
	});

	test('describes Current integrity failures as Current recovery', () => {
		assert.strictEqual(
			getBaseHalfNodeHistoricalArtifactOpenProblem('outputs/current/frame.png', 'changed', 'current'),
			'Current changed on disk: \'outputs/current/frame.png\'. Choose a verified version in History or run the node again.'
		);
	});

	test('preserves an unavailable plugin recipe during identity-only edits', () => {
		const document = withRecipe(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Frame',
			role: 'storyboard-frame'
		}), {
			recipeId: 'pointa.missing.image',
			modelServiceId: 'studio.images',
			modelId: 'image-v2',
			parameters: { prompt: 'Keep this', count: 1 },
			inputBindings: [{ sourcePath: 'brief.md', slot: 'context', order: 0 }]
		});

		const preserved = resolveBaseHalfNodeRecipeDraft(
			document,
			'pointa.missing.image',
			undefined,
			undefined,
			undefined,
			undefined,
			[]
		);
		assert.deepStrictEqual(preserved, document.recipe);
		assert.strictEqual(resolveBaseHalfNodeRecipeDraft(document, '', undefined, undefined, undefined, undefined, []), undefined);
	});

	test('keeps model selection and cost visible in run history details', () => {
		const running = beginBaseHalfNodeRun(withRecipe(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Frame',
			role: 'storyboard-frame'
		}), {
			recipeId: recipe.id,
			modelServiceId: 'studio.images',
			modelId: 'image-v2',
			parameters: { prompt: 'A frame', count: 1, transparent: false, style: 'natural' },
			inputBindings: [{ sourcePath: 'brief.md', slot: 'context', order: 0 }]
		}), {
			id: 'run-1',
			createdAt: '2026-07-18T10:00:00Z',
			startedAt: '2026-07-18T10:00:00Z',
			model: {
				source: 'service',
				connection: 'resolved',
				serviceId: 'studio.images',
				serviceLabel: 'Studio Images',
				connectionIdentity: `sha256:${'A'.repeat(43)}`,
				capability: 'image',
				modelId: 'image-v2'
			},
			inputs: [{ sourcePath: 'brief.md', slot: 'context', order: 0, revision: 'sha256:brief-v1' }]
		});
		const completed = completeBaseHalfNodeRun(running, 'run-1', {
			completedAt: '2026-07-18T10:00:01Z',
			artifacts: [{ id: 'image', outputId: 'image', kind: 'image', path: 'outputs/frame.png', sha256: 'B'.repeat(43), size: 12 }],
			primaryArtifactId: 'image',
			cost: { currency: 'USD', amount: '0.04', kind: 'actual' }
		});
		assert.strictEqual(
			getBaseHalfNodeRunHistoryDetail(completed.runs[0], 'frame.png'),
			'frame.png · Studio Images / image-v2 · USD 0.04'
		);
		const disclosed = completeBaseHalfNodeRun(running, 'run-1', {
			completedAt: '2026-07-18T10:00:01Z',
			artifacts: [{ id: 'image', outputId: 'image', kind: 'image', path: 'outputs/frame.png', sha256: 'B'.repeat(43), size: 12 }],
			primaryArtifactId: 'image',
			providerRequestId: 'request-42',
			usage: { inputTokens: 12, images: 1 },
			cost: { currency: 'USD', amount: '0.04', kind: 'actual' }
		});
		const disclosure = getBaseHalfNodeRunDisclosureLines(disclosed.runs[0]);
		assert.ok(disclosure.includes('Status: Succeeded'));
		assert.ok(disclosure.includes('Run: run-1'));
		assert.ok(disclosure.includes(`Recipe: ${recipe.id}`));
		assert.ok(disclosure.includes('Parameter prompt: “A frame”'));
		assert.ok(disclosure.includes('Model service: Studio Images (studio.images)'));
		assert.ok(disclosure.includes('Model: image-v2'));
		assert.ok(disclosure.includes('Input 1: brief.md → context · revision sha256:brief-v1'));
		assert.ok(disclosure.some(line => line.startsWith('Output 1: outputs/frame.png · image · 12 bytes · SHA-256 ')));
		assert.ok(disclosure.includes('Created: 2026-07-18T10:00:00Z'));
		assert.ok(disclosure.includes('Completed: 2026-07-18T10:00:01Z'));
		assert.ok(disclosure.includes('Request: request-42'));
		assert.ok(disclosure.includes('Usage: input tokens: 12, images: 1'));
		assert.ok(disclosure.includes('Cost: USD 0.04'));
	});

	test('uses one primary action for each resting lifecycle state', () => {
		const empty = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Frame',
			role: 'storyboard-frame'
		});
		assert.deepStrictEqual(getBaseHalfNodeLocalState(empty).action, { kind: 'add', label: 'Add content' });
		assert.deepStrictEqual(getBaseHalfNodeLocalState(empty, { matchingRecipeCount: 0 }).action, { kind: 'add', label: 'Add content' });
		assert.match(getBaseHalfNodeLocalState(empty, { matchingRecipeCount: 0 }).message, /existing image content/);
		const imported = importBaseHalfNodeCurrent(empty, {
			id: 'import-1',
			source: 'imported',
			createdAt: '2026-07-18T09:00:00Z',
			artifacts: [{ id: 'image-1', outputId: 'imported', kind: 'image', path: 'assets/frame.png', sha256: 'A'.repeat(43), size: 12 }],
			primaryArtifactId: 'image-1'
		});
		assert.deepStrictEqual(getBaseHalfNodeLocalState(imported, { matchingRecipeCount: 0 }).action, { kind: 'add', label: 'Set up' });
		assert.strictEqual(getBaseHalfNodeLocalState(imported, { matchingRecipeCount: 3 }).status, 'Current');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(imported, { matchingRecipeCount: 3 }).action, { kind: 'add', label: 'Set up' });
		assert.deepStrictEqual(getBaseHalfNodeLocalState(imported, {
			matchingRecipeCount: 3,
			verificationPending: true
		}), {
			ready: false,
			status: 'Needs input',
			message: 'Checking Current before this node can be used.',
			action: { kind: 'wait', label: 'Checking' }
		});
		const missingImported = getBaseHalfNodeLocalState(imported, {
			matchingRecipeCount: 0,
			currentOutputIntegrity: 'missing'
		});
		assert.deepStrictEqual(missingImported.action, { kind: 'import', label: 'Replace image' });
		assert.match(missingImported.message, /selected image is missing/);
		assert.match(missingImported.message, /History keeps the original record/);

		const incomplete = withRecipe(empty, {
			recipeId: recipe.id,
			parameters: {},
			inputBindings: []
		});
		assert.deepStrictEqual(getBaseHalfNodeLocalState(incomplete, { recipe }).action, { kind: 'configure', label: 'Configure' });
		assert.strictEqual(getBaseHalfNodeLocalState(incomplete, { recipe }).status, 'Needs input');
		assert.match(getBaseHalfNodeLocalState(incomplete, { recipe }).message, /Prompt/);
		const whitespacePrompt = withRecipe(empty, {
			recipeId: recipe.id,
			parameters: { prompt: '   ', count: 1, transparent: false, style: 'natural' },
			inputBindings: []
		});
		const whitespaceState = getBaseHalfNodeLocalState(whitespacePrompt, { recipe });
		assert.deepStrictEqual(whitespaceState.action, { kind: 'configure', label: 'Configure' });
		assert.match(whitespaceState.message, /Prompt/);

		const ready = withRecipe(empty, {
			recipeId: recipe.id,
			modelServiceId: 'studio.images',
			parameters: { prompt: 'Quiet street', count: 1, transparent: false, style: 'natural' },
			inputBindings: [{ sourcePath: 'brief.md', slot: 'context', order: 0 }]
		});
		assert.deepStrictEqual(getBaseHalfNodeLocalState(ready, { recipe, modelServices: [configuredModel] }).action, { kind: 'run', label: 'Run' });
		assert.strictEqual(getBaseHalfNodeLocalState(ready, { recipe, modelServices: [configuredModel] }).status, 'Ready');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(ready, {
			recipe,
			modelServices: [configuredModel],
			verificationPending: true
		}), {
			ready: false,
			status: 'Needs input',
			message: 'Checking Current and direct inputs before this node can run.',
			action: { kind: 'wait', label: 'Checking' }
		});
		assert.deepStrictEqual(getBaseHalfNodeLocalState(ready, {
			recipe,
			modelServices: [configuredModel],
			execution: { phase: 'running', message: 'Generating' }
		}).action, { kind: 'cancel', label: 'Cancel' });
		assert.strictEqual(getBaseHalfNodeLocalState(ready, {
			recipe,
			modelServices: [configuredModel],
			execution: { phase: 'running' }
		}).status, 'Running');
		const cancelling = getBaseHalfNodeLocalState(ready, {
			recipe,
			modelServices: [configuredModel],
			execution: { phase: 'cancelling' }
		});
		assert.strictEqual(cancelling.status, 'Cancelling');
		assert.strictEqual(cancelling.ready, false);
		assert.deepStrictEqual(cancelling.action, { kind: 'cancel', label: 'Cancelling…' });

		const running = beginBaseHalfNodeRun(ready, {
			id: 'run-1',
			createdAt: '2026-07-18T10:00:00Z',
			startedAt: '2026-07-18T10:00:00Z',
			model: {
				source: 'service',
				connection: 'resolved',
				serviceId: configuredModel.id,
				serviceLabel: configuredModel.label,
				connectionIdentity: configuredModel.connectionIdentity,
				capability: 'image'
			},
			inputs: [{ sourcePath: 'brief.md', slot: 'context', order: 0, revision: 'one' }]
		});
		const persistedRunning = getBaseHalfNodeLocalState(running, { recipe, modelServices: [configuredModel] });
		assert.strictEqual(persistedRunning.status, 'Running');
		assert.strictEqual(persistedRunning.ready, false);
		assert.deepStrictEqual(persistedRunning.action, { kind: 'recover', label: 'Check status' });
		assert.match(persistedRunning.message, /status check/);
		const failed = failBaseHalfNodeRun(running, 'run-1', {
			completedAt: '2026-07-18T10:00:01Z',
			error: 'Request failed'
		});
		assert.deepStrictEqual(getBaseHalfNodeLocalState(failed, { recipe, modelServices: [configuredModel] }).action, { kind: 'retry', label: 'Retry' });
		assert.strictEqual(getBaseHalfNodeLocalState(failed, { recipe, modelServices: [configuredModel] }).status, 'Failed');

		const succeeded = completeBaseHalfNodeRun(running, 'run-1', {
			completedAt: '2026-07-18T10:00:01Z',
			artifacts: [{
				id: 'image-1',
				outputId: 'image',
				kind: 'image',
				path: 'outputs/frame/run-1/frame.png',
				sha256: 'A'.repeat(43),
				size: 12
			}],
			primaryArtifactId: 'image-1'
		});
		assert.deepStrictEqual(getBaseHalfNodeLocalState(succeeded, { recipe, modelServices: [configuredModel] }).action, { kind: 'runAgain', label: 'Run again' });
		assert.strictEqual(getBaseHalfNodeLocalState(succeeded, { recipe, modelServices: [configuredModel] }).status, 'Current');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(succeeded).action, { kind: 'configure', label: 'Configure' });
		assert.strictEqual(getBaseHalfNodeLocalState(succeeded).status, 'Current');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(succeeded, { recipe: { ...recipe, outputs: [{ ...recipe.outputs[0], kind: 'video' }] } }).action, { kind: 'configure', label: 'Configure' });
		assert.deepStrictEqual(getBaseHalfNodeLocalState(succeeded, {
			recipe,
			modelServices: [configuredModel],
			currentOutputIntegrity: 'missing'
		}).action, { kind: 'runAgain', label: 'Run again' });
		assert.match(getBaseHalfNodeLocalState(succeeded, {
			recipe,
			modelServices: [configuredModel],
			currentOutputIntegrity: 'missing'
		}).message, /History keeps the original record/);
		assert.strictEqual(getBaseHalfNodeLocalState(succeeded, {
			recipe,
			modelServices: [configuredModel],
			dirty: true
		}).ready, false);
		assert.match(getBaseHalfNodeLocalState(succeeded, {
			recipe,
			modelServices: [configuredModel],
			dirty: true
		}).message, /Save this node/);
		assert.match(getBaseHalfNodeLocalState(succeeded, {
			recipe,
			modelServices: [configuredModel],
			staleReason: 'inputs'
		}).message, /Direct inputs changed/);
		assert.strictEqual(getBaseHalfNodeLocalState(succeeded, {
			recipe,
			modelServices: [configuredModel],
			staleReason: 'inputs'
		}).status, 'Stale');

		const retrying = beginBaseHalfNodeRun(succeeded, {
			id: 'run-2',
			createdAt: '2026-07-18T10:01:00Z',
			startedAt: '2026-07-18T10:01:00Z',
			model: {
				source: 'service',
				connection: 'resolved',
				serviceId: configuredModel.id,
				serviceLabel: configuredModel.label,
				connectionIdentity: configuredModel.connectionIdentity,
				capability: 'image'
			},
			inputs: [{ sourcePath: 'brief.md', slot: 'context', order: 0, revision: 'two' }]
		});
		const failedRetry = failBaseHalfNodeRun(retrying, 'run-2', {
			completedAt: '2026-07-18T10:01:01Z',
			error: 'Provider unavailable.'
		});
		const failedStaleState = getBaseHalfNodeLocalState(failedRetry, {
			recipe,
			modelServices: [configuredModel],
			staleReason: 'inputs'
		});
		assert.strictEqual(failedStaleState.status, 'Failed');
		assert.deepStrictEqual(failedStaleState.action, { kind: 'retry', label: 'Retry' });
		assert.match(failedStaleState.message, /Provider unavailable/);
		assert.match(failedStaleState.message, /Current is unchanged/);
		const failedMissingState = getBaseHalfNodeLocalState(failedRetry, {
			recipe,
			modelServices: [configuredModel],
			currentOutputIntegrity: 'missing'
		});
		assert.strictEqual(failedMissingState.status, 'Failed');
		assert.match(failedMissingState.message, /Provider unavailable/);
		assert.match(failedMissingState.message, /previous Current output is missing/);
	});

	test('blocks another import before immutable imported History reaches its schema limit', () => {
		const full = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Frame',
			role: 'storyboard-frame',
			revisions: Array.from({ length: 1024 }, (_entry, index) => ({
				id: `import-${index}`,
				source: 'imported' as const,
				createdAt: '2026-07-18T09:00:00Z',
				artifacts: [{
					id: `image-${index}`,
					outputId: 'imported',
					kind: 'image' as const,
					path: `assets/frame-${index}.png`,
					sha256: 'A'.repeat(43),
					size: 12
				}],
				primaryArtifactId: `image-${index}`
			}))
		});
		assert.match(getBaseHalfNodeImportHistoryProblem(full) ?? '', /1024 versions/);
		const state = getBaseHalfNodeLocalState(full, { matchingRecipeCount: 0 });
		assert.strictEqual(state.ready, false);
		assert.deepStrictEqual(state.action, { kind: 'wait', label: 'History full' });
		assert.match(state.message, /Duplicate this node/);
	});

	test('shows blockers and recovery reasons on the card without coloring them as success', () => {
		const blocked = {
			ready: false,
			status: 'Needs input',
			message: 'Save this node before running it.',
			action: { kind: 'run', label: 'Run' }
		} as const;
		assert.strictEqual(getBaseHalfNodeCardStatusText(blocked), 'Needs input');
		assert.strictEqual(isBaseHalfNodeCardStatusPositive(blocked), false);

		const failed = {
			ready: true,
			status: 'Failed',
			message: 'The last run failed. Current is unchanged.',
			action: { kind: 'retry', label: 'Retry' }
		} as const;
		assert.strictEqual(getBaseHalfNodeCardStatusText(failed), 'Failed');
		assert.strictEqual(isBaseHalfNodeCardStatusPositive(failed), false);

		const current = {
			ready: true,
			status: 'Current',
			message: 'Ready to create another result.',
			action: { kind: 'runAgain', label: 'Run again' }
		} as const;
		assert.strictEqual(getBaseHalfNodeCardStatusText(current), 'Current');
		assert.strictEqual(isBaseHalfNodeCardStatusPositive(current), true);
	});

	test('projects frequent live progress into a stable card action without document work', () => {
		for (let progress = 0; progress < 100; progress++) {
			const state = getBaseHalfNodeLocalExecutionState({
				phase: 'running',
				message: `Rendering ${progress + 1}%`
			});
			assert.strictEqual(state.status, 'Running');
			assert.strictEqual(state.message, `Rendering ${progress + 1}%`);
			assert.deepStrictEqual(state.action, { kind: 'cancel', label: 'Cancel' });
		}

		const cancelling = getBaseHalfNodeLocalExecutionState({ phase: 'cancelling' });
		assert.strictEqual(cancelling.status, 'Cancelling');
		assert.deepStrictEqual(cancelling.action, { kind: 'cancel', label: 'Cancelling…' });
	});

	test('names direct import actions after the Current content they set', () => {
		assert.strictEqual(baseHalfNodeImportActionLabel('image'), 'Import image');
		assert.strictEqual(baseHalfNodeImportActionLabel('video'), 'Import video');
		assert.strictEqual(baseHalfNodeImportActionLabel('audio'), 'Import audio');
		assert.strictEqual(baseHalfNodeImportActionLabel('pdf'), 'Import PDF');
		assert.strictEqual(baseHalfNodeImportActionLabel('presentation'), 'Import presentation');
		assert.strictEqual(baseHalfNodeImportActionLabel('file', true), 'Replace file');
		assert.strictEqual(baseHalfNodeCanImportContentKind('file', 'text'), true);
		assert.strictEqual(baseHalfNodeCanImportContentKind('file', 'code'), true);
		assert.strictEqual(baseHalfNodeCanImportContentKind('file', 'image'), true);
		assert.strictEqual(baseHalfNodeCanImportContentKind('image', 'text'), false);
		assert.strictEqual(baseHalfNodeCanImportContentKind('image', 'image'), true);
	});

	test('previews verified readable File artifacts without treating the node document as editable text', () => {
		assert.strictEqual(baseHalfNodeArtifactUsesTextPreview('file', 'outputs/plan.md'), true);
		assert.strictEqual(baseHalfNodeArtifactUsesTextPreview('file', 'outputs/data.bin'), false);
		assert.strictEqual(decodeBaseHalfNodeTextPreview(VSBuffer.fromString('# Plan\n')), '# Plan\n');
		assert.strictEqual(decodeBaseHalfNodeTextPreview(VSBuffer.wrap(new Uint8Array([0x66, 0x00, 0x6f]))), undefined);
		assert.strictEqual(decodeBaseHalfNodeTextPreview(VSBuffer.wrap(new Uint8Array([0xc3, 0x28]))), undefined);
	});

	test('explains model and direct-input readiness without changing edge semantics', () => {
		const missingModel = node();
		const modelState = getBaseHalfNodeLocalState(missingModel, { recipe, modelServices: [] });
		assert.strictEqual(modelState.ready, false);
		assert.match(modelState.message, /model service in Settings/);

		const missingInput = withRecipe(missingModel, {
			...missingModel.recipe!,
			modelServiceId: 'studio.images'
		});
		const inputState = getBaseHalfNodeLocalState(missingInput, { recipe, modelServices: [configuredModel] });
		assert.strictEqual(inputState.ready, false);
		assert.match(inputState.message, /direct Context input/);

		const unassignedState = getBaseHalfNodeLocalState(missingInput, {
			recipe,
			modelServices: [configuredModel],
			inputKinds: new Map([['brief.md', 'text']]),
			directSourcePaths: ['brief.md']
		});
		assert.strictEqual(unassignedState.ready, false);
		assert.match(unassignedState.message, /Assign connected context 'brief.md'/);
		assert.strictEqual(unassignedState.action.label, 'Assign input');

		const wrongKind = withRecipe(missingInput, {
			...missingInput.recipe!,
			inputBindings: [{ sourcePath: 'reference.png', slot: 'context', order: 0 }]
		});
		const wrongKindState = getBaseHalfNodeLocalState(wrongKind, {
			recipe,
			modelServices: [configuredModel],
			inputKinds: new Map([['reference.png', 'image']])
		});
		assert.strictEqual(wrongKindState.ready, false);
		assert.match(wrongKindState.message, /does not accept image/);

		const rows = getBaseHalfNodeInputRows(recipe, [
			{ sourcePath: 'second.md', slot: 'context', order: 1 },
			{ sourcePath: 'first.md', slot: 'retired-slot', order: 0 }
		], undefined, new Map([
			['second.md', { source: 'run', id: 'run-2' }]
		]));
		assert.deepStrictEqual(rows.map(row => ({ path: row.sourcePath, slot: row.slotLabel, order: row.order, accepted: row.accepted })), [
			{ path: 'first.md', slot: 'retired-slot', order: 0, accepted: false },
			{ path: 'second.md', slot: 'Context', order: 1, accepted: true }
		]);
		assert.strictEqual(rows[0].currentVersion, undefined);
		assert.deepStrictEqual(rows[1].currentVersion, { source: 'run', id: 'run-2' });
		assert.strictEqual(getBaseHalfNodeInputCurrentVersionLabel(rows[1].currentVersion!), 'Current run · run-2');
		assert.strictEqual(
			getBaseHalfNodeInputCurrentVersionLabel({ source: 'imported', id: 'imported-version-123456789' }),
			'Current import · imported…6789'
		);
		assert.deepStrictEqual(getBaseHalfNodeAvailableInputSlots(recipe, [], 'brief.md', 'text').map(slot => slot.id), ['context']);
		assert.deepStrictEqual(getBaseHalfNodeAvailableInputSlots(recipe, [
			{ sourcePath: 'brief.md', slot: 'context', order: 0 }
		], 'brief.md', 'text'), []);
		assert.deepStrictEqual(getBaseHalfNodeAvailableInputSlots(recipe, [], 'reference.png', 'image'), []);
	});

	test('blocks Run on the first direct result source without a verified Current', () => {
		const mediaRecipe: IBaseHalfCanvasRecipeDescriptor = {
			...recipe,
			inputs: [{ id: 'context', label: 'Context', accepts: ['image'], minItems: 1, maxItems: 2 }]
		};
		const target = withRecipe(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(2),
			kind: 'image',
			title: 'Clip',
			role: 'result'
		}), {
			recipeId: mediaRecipe.id,
			modelServiceId: configuredModel.id,
			parameters: { prompt: 'Move slowly', count: 1, transparent: false, style: 'natural' },
			inputBindings: [
				{ sourcePath: 'second.bhnode', slot: 'context', order: 1 },
				{ sourcePath: 'first.bhnode', slot: 'context', order: 0 }
			]
		});
		const inputKinds = new Map<string, 'image'>([
			['first.bhnode', 'image'],
			['second.bhnode', 'image']
		]);
		const problems = new Map([
			['second.bhnode', 'second.bhnode changed.'],
			['first.bhnode', 'first.bhnode has no usable Current.']
		]);
		const blocked = getBaseHalfNodeLocalState(target, {
			recipe: mediaRecipe,
			modelServices: [configuredModel],
			inputKinds,
			directSourcePaths: ['first.bhnode', 'second.bhnode'],
			directSourceProblems: problems
		});

		assert.strictEqual(blocked.ready, false);
		assert.strictEqual(blocked.status, 'Needs input');
		assert.deepStrictEqual(blocked.action, { kind: 'wait', label: 'Run unavailable' });
		assert.match(blocked.message, /first\.bhnode.*no usable Current/);

		const ready = getBaseHalfNodeLocalState(target, {
			recipe: mediaRecipe,
			modelServices: [configuredModel],
			inputKinds,
			directSourcePaths: ['first.bhnode', 'second.bhnode'],
			directSourceProblems: new Map()
		});
		assert.strictEqual(ready.ready, true);
		assert.deepStrictEqual(ready.action, { kind: 'run', label: 'Run' });
	});

	test('keeps model identity explicit and bounded independently from the service connection', () => {
		assert.strictEqual(getBaseHalfNodeModelSelectionProblem('studio.images', 'image-v2'), undefined);
		assert.strictEqual(getBaseHalfNodeModelSelectionProblem('studio.other', 'image-v2'), undefined);
		assert.match(getBaseHalfNodeModelSelectionProblem(undefined, 'image-v2') ?? '', /Choose a model service/);
		assert.match(getBaseHalfNodeModelSelectionProblem('studio.images', 'image v2') ?? '', /unsupported characters/);
		assert.match(getBaseHalfNodeModelSelectionProblem('studio.images', `m${'a'.repeat(256)}`) ?? '', /256 characters/);
		assert.deepStrictEqual(createBaseHalfNodeModelSelection('studio.images', ' image-v2 '), {
			modelServiceId: 'studio.images',
			modelId: 'image-v2'
		});
		assert.deepStrictEqual(createBaseHalfNodeModelSelection('studio.other', 'image-v2'), {
			modelServiceId: 'studio.other',
			modelId: 'image-v2'
		});
	});

	test('keeps binding role choices structurally valid without making unassigned context an invalid draft', () => {
		const capacityRecipe: IBaseHalfCanvasRecipeDescriptor = {
			...recipe,
			inputs: [
				{ id: 'context', label: 'Context', accepts: ['text'], minItems: 1, maxItems: 2 },
				{ id: 'style', label: 'Style', accepts: ['text'], minItems: 0, maxItems: 1 }
			]
		};
		const bindings = [
			{ sourcePath: 'a.md', slot: 'context', order: 0 },
			{ sourcePath: 'b.md', slot: 'style', order: 1 },
			{ sourcePath: 'c.md', slot: 'context', order: 2 }
		];
		assert.deepStrictEqual(getBaseHalfNodeAssignableInputSlots(capacityRecipe, bindings, 'b.md', 'text').map(slot => slot.id), ['style']);
		assert.deepStrictEqual(getBaseHalfNodeAssignableInputSlots(capacityRecipe, bindings, 'a.md', 'text').map(slot => slot.id), ['context']);
		assert.deepStrictEqual(getBaseHalfNodeAssignableInputSlots(capacityRecipe, bindings, 'a.md', 'image'), []);
		assert.strictEqual(getBaseHalfNodeInputStructureProblem(capacityRecipe, [], new Map(), []), undefined);
		const overCapacity = bindings.map(binding => binding.sourcePath === 'b.md' ? { ...binding, slot: 'context' } : binding);
		assert.match(getBaseHalfNodeInputStructureProblem(capacityRecipe, overCapacity, new Map([
			['a.md', 'text'], ['b.md', 'text'], ['c.md', 'text']
		]), ['a.md', 'b.md', 'c.md']) ?? '', /Remove 1 direct Context input/);
		assert.strictEqual(getBaseHalfNodeInputStructureProblem(capacityRecipe, bindings.slice(0, 2), new Map([
			['a.md', 'text'], ['b.md', 'text'], ['c.md', 'text']
		]), ['a.md', 'b.md', 'c.md']), undefined);
	});

	test('round-trips schema-backed parameter drafts and rejects invalid values', () => {
		const draft = createBaseHalfNodeParameterDraft(recipe, {
			prompt: 'Rain',
			count: 2,
			transparent: true,
			style: 'graphic'
		});
		assert.deepStrictEqual(draft, {
			prompt: 'Rain',
			count: '2',
			transparent: true,
			style: 'graphic'
		});
		assert.deepStrictEqual(parseBaseHalfNodeParameterDraft(recipe, draft), {
			valid: true,
			parameters: {
				prompt: 'Rain',
				count: 2,
				transparent: true,
				style: 'graphic'
			}
		});
		assert.deepStrictEqual(parseBaseHalfNodeParameterDraft(recipe, { ...draft, count: '8' }), {
			valid: false,
			message: 'Parameter \'Count\' is invalid for \'Create image\'.'
		});
	});

	test('reorders inputs within one target-owned slot without changing their connection identity', () => {
		const bindings = [
			{ sourcePath: 'first.md', slot: 'context', order: 0 },
			{ sourcePath: 'style.md', slot: 'style', order: 1 },
			{ sourcePath: 'second.md', slot: 'context', order: 2 }
		];
		const moved = moveBaseHalfNodeInputBinding(bindings, 'second.md', -1);

		assert.deepStrictEqual(moved.map(binding => binding.sourcePath), ['second.md', 'style.md', 'first.md']);
		assert.deepStrictEqual(moved.map(binding => binding.order), [0, 1, 2]);
		assert.deepStrictEqual(new Set(moved.map(binding => `${binding.sourcePath}:${binding.slot}`)), new Set([
			'first.md:context', 'style.md:style', 'second.md:context'
		]));
	});

	test('resolves zero, one, multiple, and cancelled connection role choices before mutation', async () => {
		const first = recipe.inputs[0];
		const second = { ...first, id: 'reference', label: 'Reference' };
		let pickerCalls = 0;
		assert.deepStrictEqual(await chooseBaseHalfNodeConnectionSlot([], async () => {
			pickerCalls++;
			return undefined;
		}), { kind: 'reject' });
		assert.deepStrictEqual(await chooseBaseHalfNodeConnectionSlot([first], async () => {
			pickerCalls++;
			return undefined;
		}), { kind: 'bind', slot: first });
		assert.strictEqual(pickerCalls, 0);
		assert.deepStrictEqual(await chooseBaseHalfNodeConnectionSlot([first, second], async choices => {
			pickerCalls++;
			return choices[1];
		}), { kind: 'bind', slot: second });
		assert.deepStrictEqual(await chooseBaseHalfNodeConnectionSlot([first, second], async () => {
			pickerCalls++;
			return undefined;
		}), { kind: 'cancel' });
		assert.strictEqual(pickerCalls, 2);
	});

});

const recipe: IBaseHalfCanvasRecipeDescriptor = {
	id: 'pointa.canvas.image',
	extensionId: 'pointa.canvas',
	label: 'Create image',
	modelCapability: 'image',
	inputs: [{
		id: 'context',
		label: 'Context',
		accepts: ['text'],
		minItems: 1,
		maxItems: 2
	}],
	parameters: [
		{ id: 'prompt', label: 'Prompt', type: 'multiline', required: true, minLength: 1, maxLength: 2000 },
		{ id: 'count', label: 'Count', type: 'number', default: 1, minimum: 1, maximum: 4, step: 1 },
		{ id: 'transparent', label: 'Transparent', type: 'boolean', default: false },
		{
			id: 'style',
			label: 'Style',
			type: 'enum',
			default: 'natural',
			options: [
				{ value: 'natural', label: 'Natural' },
				{ value: 'graphic', label: 'Graphic' }
			]
		}
	],
	outputs: [{
		id: 'image',
		kind: 'image',
		extensions: ['.png'],
		minItems: 1,
		maxItems: 1,
		primary: true
	}]
};

const configuredModel: IBaseHalfModelServiceDescriptor = {
	id: 'studio.images',
	label: 'Studio Images',
	endpoint: 'https://models.example.test/v1',
	connectionIdentity: `sha256:${'A'.repeat(43)}`,
	capabilities: ['image'],
	authorization: 'bearer',
	configured: true
};

function localConfigurationDraft(): IBaseHalfNodeLocalConfigurationDraft {
	return {
		title: 'Frame',
		role: 'storyboard-frame',
		recipeId: recipe.id,
		parameters: { prompt: 'Quiet street' },
		modelServiceId: 'studio.images',
		modelId: 'image-v1',
		inputBindings: []
	};
}

function node(): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(1),
		kind: 'image',
		title: 'Frame',
		role: 'storyboard-frame',
		recipe: {
			recipeId: recipe.id,
			parameters: { prompt: 'Quiet street', count: 1, transparent: false, style: 'natural' },
			inputBindings: []
		}
	});
}

function withRecipe(document: IBaseHalfNodeDocument, recipeState: NonNullable<IBaseHalfNodeDocument['recipe']>): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({ ...document, recipe: recipeState });
}
