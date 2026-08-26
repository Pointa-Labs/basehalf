/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfCanvasCardPreviewCanRetainElement, baseHalfCanvasCardPreviewRenderKey, baseHalfCanvasPendingSelectionIsReady, baseHalfCanvasPostCreateOwnerIsCurrent, baseHalfCanvasProvisionalVideoDraftDocument, baseHalfCanvasRetainedCardChromeIsStale, baseHalfCanvasSetVideoInputPickActive, baseHalfCanvasVideoCanonicalAdjustmentState, baseHalfCanvasVideoConnectionBindingRequiresRebind, baseHalfCanvasVideoInputReadinessMessage, baseHalfCanvasVideoMethodControlState, baseHalfCanvasVideoModelCapabilitySummary, baseHalfCanvasVideoModelIsTypeaheadKey, baseHalfCanvasVideoModelNavigationIndex, baseHalfCanvasVideoModelProblemAction, baseHalfCanvasVideoModelTypeaheadIndex, baseHalfCanvasVideoOverlayNextFocusTarget, baseHalfCanvasVideoPickCandidateBatches, baseHalfCanvasVideoPickCandidatePaths, baseHalfCanvasVideoPickCheckpointCanContinue, baseHalfCanvasVideoPickHasCandidateChange, baseHalfCanvasVideoPickMountedCandidatePaths, baseHalfCanvasVideoPickRevisionDependencyPaths, baseHalfCanvasVideoRangeAccessibleNames, baseHalfCanvasWarningDisplayMessage, baseHalfCanvasZoomFromPercentInput, disposeBaseHalfCanvasVideoPickStore, formatBaseHalfCanvasZoomPercent } from '../../browser/basehalfCanvasWorkbench.contribution.js';
import { createBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../../common/basehalfNodeDocument.js';
import { acquireBaseHalfVideoInputTransaction, baseHalfVideoInputTransactionIsCurrent, beginBaseHalfVideoCanvasPick, cancelBaseHalfVideoCanvasPick, createBaseHalfVideoCanvasPickState, createBaseHalfVideoInputTransactionOwnerState, failBaseHalfVideoCanvasPick, getBaseHalfVideoCanvasPickInteraction, markBaseHalfVideoCanvasPickReady, releaseBaseHalfVideoInputTransaction } from '../../common/basehalfVideoInputs.js';
import { createBaseHalfVideoMessagePrecedencePresentation } from '../../common/basehalfVideoModelSettingsPresentation.js';

suite('BaseHalfCanvasWorkbench', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('invalidates retained Note chrome only when its visual key changed', () => {
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'original'), false);
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'updated'), true);
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'original'), false);
	});

	test('compares refreshed result-node previews by rendered Map content', () => {
		const first = {
			kind: 'node',
			document: { id: 'video' },
			inputKinds: new Map([['prompt.md', 'text'], ['image.png', 'image']]),
			directSourceProblems: new Map([['missing.md', 'missing']])
		};
		const equivalent = {
			...first,
			inputKinds: new Map([['image.png', 'image'], ['prompt.md', 'text']]),
			directSourceProblems: new Map([['missing.md', 'missing']])
		};
		const changed = {
			...equivalent,
			directSourceProblems: new Map([['missing.md', 'changed']])
		};

		assert.strictEqual(baseHalfCanvasCardPreviewRenderKey(first as never), baseHalfCanvasCardPreviewRenderKey(equivalent as never));
		assert.notStrictEqual(baseHalfCanvasCardPreviewRenderKey(first as never), baseHalfCanvasCardPreviewRenderKey(changed as never));
		assert.strictEqual(baseHalfCanvasCardPreviewCanRetainElement(true, first as never, equivalent as never), true);
		assert.strictEqual(baseHalfCanvasCardPreviewCanRetainElement(true, first as never, changed as never), false);
		assert.strictEqual(baseHalfCanvasCardPreviewCanRetainElement(false, first as never, equivalent as never), false);
	});

	test('collapses detailed corrupt canvas errors into one display warning', () => {
		assert.strictEqual(baseHalfCanvasWarningDisplayMessage('Corrupt canvas.yaml'), 'Corrupt canvas.yaml');
		assert.strictEqual(
			baseHalfCanvasWarningDisplayMessage('Corrupt canvas.yaml at file:///tmp/work/.bh/mirror/canvas.yaml: card \'note.md\' width must be positive'),
			'Corrupt canvas.yaml'
		);
		assert.strictEqual(baseHalfCanvasWarningDisplayMessage('Unable to read canvas.yaml'), 'Unable to read canvas.yaml');
	});

	test('retains a post-create selection until every created card is visible in the model', () => {
		assert.strictEqual(baseHalfCanvasPendingSelectionIsReady(['new-note.md'], new Set()), false);
		assert.strictEqual(baseHalfCanvasPendingSelectionIsReady(['new-note.md'], new Set(['existing.md'])), false);
		assert.strictEqual(baseHalfCanvasPendingSelectionIsReady(['new-note.md'], new Set(['existing.md', 'new-note.md'])), true);
		assert.strictEqual(baseHalfCanvasPendingSelectionIsReady(['a.md', 'b.md'], new Set(['a.md'])), false);
		assert.strictEqual(baseHalfCanvasPendingSelectionIsReady(['a.md', 'b.md'], new Set(['a.md', 'b.md'])), true);
	});

	test('derives Video pick candidates from the complete canvas model', () => {
		assert.deepStrictEqual(baseHalfCanvasVideoPickCandidatePaths([
			'shots/offscreen-start.png',
			'shots/video.bhnode',
			'shots/offscreen-end.png'
		], 'shots/video.bhnode'), [
			'shots/offscreen-start.png',
			'shots/offscreen-end.png'
		]);

		const largeModel = [
			...Array.from({ length: 129 }, (_, index) => `shots/source-${index}.png`),
			'shots/video.bhnode'
		];
		const batches = baseHalfCanvasVideoPickCandidateBatches(largeModel, 'shots/video.bhnode', 16);
		assert.strictEqual(batches.length, 9);
		assert.strictEqual(batches.every(batch => batch.length <= 16), true);
		assert.deepStrictEqual(batches.flat(), largeModel.slice(0, -1));
		assert.strictEqual(Object.isFrozen(batches), true);
		assert.throws(() => baseHalfCanvasVideoPickCandidateBatches(largeModel, 'shots/video.bhnode', 0));
		assert.deepStrictEqual(baseHalfCanvasVideoPickMountedCandidatePaths([
			'shots/unrelated.md',
			'shots/source-128.png',
			'shots/source-0.png'
		], new Set(batches.flat())), [
			'shots/source-128.png',
			'shots/source-0.png'
		]);
	});

	test('ends a deferred pick checkpoint when its surface lifetime is disposed', async () => {
		const cards = document.createElement('div');
		const surface = document.createElement('div');
		cards.appendChild(surface);
		document.body.appendChild(cards);
		let owner = createBaseHalfVideoInputTransactionOwnerState();
		const acquisition = acquireBaseHalfVideoInputTransaction(owner);
		owner = acquisition.state;
		const transactionId = acquisition.transactionId!;
		let state = beginBaseHalfVideoCanvasPick(createBaseHalfVideoCanvasPickState(), {
			sceneKey: 'scene',
			targetNodePath: 'shots/video.bhnode',
			targetNodeId: 'video',
			expectedDraftRevision: 'etag-1',
			recipeId: 'video.recipe',
			requestedRole: 'first-frame',
			returnFocusKey: 'video:input:first-frame'
		});
		const epoch = state.epoch;
		let lifetimeIsCurrent = true;
		let resolveCheckpoint!: () => void;
		const checkpoint = new Promise<void>(resolve => resolveCheckpoint = resolve);
		let bannerCreated = false;
		let commitStarted = false;

		baseHalfCanvasSetVideoInputPickActive(cards, surface, 'shots/video.bhnode', true);
		assert.strictEqual(cards.dataset.videoInputPickActive, 'shots/video.bhnode');
		assert.strictEqual(surface.classList.contains('input-pick-active'), true);
		assert.deepStrictEqual(getBaseHalfVideoCanvasPickInteraction(state), {
			acceptsSelection: false,
			cancelAllowed: true,
			viewportNavigationAllowed: true,
			nodeGeometryGesturesDisabled: true
		});

		const continuation = checkpoint.then(() => {
			if (baseHalfCanvasVideoPickCheckpointCanContinue(
				state,
				epoch,
				baseHalfVideoInputTransactionIsCurrent(owner, transactionId),
				lifetimeIsCurrent,
				surface.isConnected
			)) {
				bannerCreated = true;
				commitStarted = true;
			}
		});

		// A normal form rerender keeps the persistent pick lifetime and surface.
		surface.replaceChildren();
		assert.strictEqual(baseHalfCanvasVideoPickCheckpointCanContinue(
			state,
			epoch,
			baseHalfVideoInputTransactionIsCurrent(owner, transactionId),
			lifetimeIsCurrent,
			surface.isConnected
		), true);

		lifetimeIsCurrent = false;
		state = failBaseHalfVideoCanvasPick(state, epoch);
		owner = releaseBaseHalfVideoInputTransaction(owner, transactionId);
		baseHalfCanvasSetVideoInputPickActive(cards, surface, 'shots/video.bhnode', false);
		surface.remove();
		resolveCheckpoint();
		await continuation;

		assert.strictEqual(bannerCreated, false);
		assert.strictEqual(commitStarted, false);
		assert.strictEqual(owner.activeTransactionId, undefined);
		assert.strictEqual(cards.dataset.videoInputPickActive, undefined);
		assert.strictEqual(surface.classList.contains('input-pick-active'), false);
		cards.remove();
	});

	test('does not let an old rejected pick dispose a re-entered request', async () => {
		const activeStore = new MutableDisposable<DisposableStore>();
		const cards = document.createElement('div');
		const surface = document.createElement('div');
		cards.appendChild(surface);
		document.body.appendChild(cards);
		let newStoreDisposed = false;
		try {
			let owner = createBaseHalfVideoInputTransactionOwnerState();
			const oldAcquisition = acquireBaseHalfVideoInputTransaction(owner);
			owner = oldAcquisition.state;
			const oldTransactionId = oldAcquisition.transactionId!;
			let state = beginBaseHalfVideoCanvasPick(createBaseHalfVideoCanvasPickState(), {
				sceneKey: 'scene',
				targetNodePath: 'shots/video.bhnode',
				targetNodeId: 'video',
				expectedDraftRevision: 'etag-1',
				recipeId: 'video.recipe',
				requestedRole: 'first-frame',
				returnFocusKey: 'video:input:first-frame'
			});
			const oldEpoch = state.epoch;
			const oldStore = new DisposableStore();
			activeStore.value = oldStore;
			let rejectOldPreflight!: (error: Error) => void;
			const oldPreflight = new Promise<void>((_resolve, reject) => rejectOldPreflight = reject);
			const oldContinuation = oldPreflight.catch(() => {
				if (disposeBaseHalfCanvasVideoPickStore(activeStore, oldStore)) {
					state = failBaseHalfVideoCanvasPick(state, oldEpoch);
				}
			});

			state = cancelBaseHalfVideoCanvasPick(state, oldEpoch);
			activeStore.clear();
			owner = releaseBaseHalfVideoInputTransaction(owner, oldTransactionId);
			const nextAcquisition = acquireBaseHalfVideoInputTransaction(owner);
			owner = nextAcquisition.state;
			const nextTransactionId = nextAcquisition.transactionId!;
			state = beginBaseHalfVideoCanvasPick(state, {
				sceneKey: 'scene',
				targetNodePath: 'shots/video.bhnode',
				targetNodeId: 'video',
				expectedDraftRevision: 'etag-2',
				recipeId: 'video.recipe',
				requestedRole: 'last-frame',
				returnFocusKey: 'video:input:last-frame'
			});
			const nextEpoch = state.epoch;
			const nextStore = new DisposableStore();
			nextStore.add(toDisposable(() => newStoreDisposed = true));
			activeStore.value = nextStore;
			baseHalfCanvasSetVideoInputPickActive(cards, surface, 'shots/video.bhnode', true);

			rejectOldPreflight(new Error('old preflight failed'));
			await oldContinuation;

			assert.strictEqual(activeStore.value, nextStore);
			assert.strictEqual(newStoreDisposed, false);
			assert.strictEqual(baseHalfVideoInputTransactionIsCurrent(owner, nextTransactionId), true);
			assert.strictEqual(state.epoch, nextEpoch);
			assert.strictEqual(state.phase, 'preflighting');
			assert.strictEqual(cards.dataset.videoInputPickActive, 'shots/video.bhnode');
		} finally {
			activeStore.dispose();
			cards.remove();
		}
	});

	test('cancels a slow checkpoint before opening a child popover', async () => {
		const cards = document.createElement('div');
		const surface = document.createElement('div');
		cards.appendChild(surface);
		document.body.appendChild(cards);
		let owner = createBaseHalfVideoInputTransactionOwnerState();
		const acquisition = acquireBaseHalfVideoInputTransaction(owner);
		owner = acquisition.state;
		const transactionId = acquisition.transactionId!;
		let state = beginBaseHalfVideoCanvasPick(createBaseHalfVideoCanvasPickState(), {
			sceneKey: 'scene',
			targetNodePath: 'shots/video.bhnode',
			targetNodeId: 'video',
			expectedDraftRevision: 'etag-1',
			recipeId: 'video.recipe',
			requestedRole: 'first-frame',
			returnFocusKey: 'video:input:first-frame'
		});
		const epoch = state.epoch;
		let resolveCheckpoint!: () => void;
		const checkpoint = new Promise<void>(resolve => resolveCheckpoint = resolve);
		let overlay: 'inputs' | 'models' = 'inputs';
		let bannerCreated = false;
		const continuation = checkpoint.then(() => {
			bannerCreated = baseHalfCanvasVideoPickCheckpointCanContinue(
				state,
				epoch,
				baseHalfVideoInputTransactionIsCurrent(owner, transactionId),
				true,
				surface.isConnected
			);
		});

		baseHalfCanvasSetVideoInputPickActive(cards, surface, 'shots/video.bhnode', true);
		state = cancelBaseHalfVideoCanvasPick(state, epoch);
		owner = releaseBaseHalfVideoInputTransaction(owner, transactionId);
		baseHalfCanvasSetVideoInputPickActive(cards, surface, 'shots/video.bhnode', false);
		overlay = 'models';
		resolveCheckpoint();
		await continuation;

		assert.strictEqual(overlay, 'models');
		assert.strictEqual(bannerCreated, false);
		assert.strictEqual(owner.activeTransactionId, undefined);
		assert.strictEqual(cards.dataset.videoInputPickActive, undefined);
		cards.remove();
	});

	test('cancels a ready pick when an unbound candidate changes', () => {
		const cards = document.createElement('div');
		const surface = document.createElement('div');
		cards.appendChild(surface);
		document.body.appendChild(cards);
		let owner = createBaseHalfVideoInputTransactionOwnerState();
		const acquisition = acquireBaseHalfVideoInputTransaction(owner);
		owner = acquisition.state;
		const transactionId = acquisition.transactionId!;
		let state = beginBaseHalfVideoCanvasPick(createBaseHalfVideoCanvasPickState(), {
			sceneKey: 'scene',
			targetNodePath: 'shots/video.bhnode',
			targetNodeId: 'video',
			expectedDraftRevision: 'etag-1',
			recipeId: 'video.recipe',
			requestedRole: 'last-frame',
			returnFocusKey: 'video:input:last-frame'
		});
		const epoch = state.epoch;
		state = markBaseHalfVideoCanvasPickReady(state, epoch, 'etag-1');
		baseHalfCanvasSetVideoInputPickActive(cards, surface, 'shots/video.bhnode', true);

		const changed = baseHalfCanvasVideoPickHasCandidateChange(
			['shots/offscreen-start.png', 'shots/offscreen-end.png'],
			sourcePath => sourcePath === 'shots/offscreen-end.png'
		);
		if (changed) {
			state = cancelBaseHalfVideoCanvasPick(state, epoch);
			owner = releaseBaseHalfVideoInputTransaction(owner, transactionId);
			baseHalfCanvasSetVideoInputPickActive(cards, surface, 'shots/video.bhnode', false);
		}

		assert.strictEqual(changed, true);
		assert.strictEqual(state.phase, 'idle');
		assert.strictEqual(owner.activeTransactionId, undefined);
		assert.strictEqual(cards.dataset.videoInputPickActive, undefined);
		cards.remove();
	});

	test('cancels a ready node-source pick when only its Result artifact changes', () => {
		const cards = document.createElement('div');
		const surface = document.createElement('div');
		cards.appendChild(surface);
		document.body.appendChild(cards);
		let owner = createBaseHalfVideoInputTransactionOwnerState();
		const acquisition = acquireBaseHalfVideoInputTransaction(owner);
		owner = acquisition.state;
		const transactionId = acquisition.transactionId!;
		let state = beginBaseHalfVideoCanvasPick(createBaseHalfVideoCanvasPickState(), {
			sceneKey: 'scene',
			targetNodePath: 'shots/video.bhnode',
			targetNodeId: 'video',
			expectedDraftRevision: 'etag-1',
			recipeId: 'video.recipe',
			requestedRole: 'first-frame',
			returnFocusKey: 'video:input:first-frame'
		});
		const epoch = state.epoch;
		state = markBaseHalfVideoCanvasPickReady(state, epoch, 'etag-1');
		baseHalfCanvasSetVideoInputPickActive(cards, surface, 'shots/video.bhnode', true);
		const dependencies = new Set(baseHalfCanvasVideoPickRevisionDependencyPaths(
			'shots/source.bhnode',
			'shots/results/source-frame.png'
		));

		assert.deepStrictEqual([...dependencies], [
			'shots/source.bhnode',
			'shots/results/source-frame.png'
		]);
		const artifactChanged = baseHalfCanvasVideoPickHasCandidateChange(
			dependencies,
			dependencyPath => dependencyPath === 'shots/results/source-frame.png'
		);
		if (artifactChanged) {
			state = cancelBaseHalfVideoCanvasPick(state, epoch);
			owner = releaseBaseHalfVideoInputTransaction(owner, transactionId);
			baseHalfCanvasSetVideoInputPickActive(cards, surface, 'shots/video.bhnode', false);
		}

		assert.strictEqual(artifactChanged, true);
		assert.strictEqual(state.phase, 'idle');
		assert.strictEqual(owner.activeTransactionId, undefined);
		assert.strictEqual(cards.dataset.videoInputPickActive, undefined);
		cards.remove();
	});

	test('keeps input readiness kind, action, and diagnostic ahead of settings adjustment', () => {
		const missingStart = baseHalfCanvasVideoInputReadinessMessage({
			kind: 'missing-start-frame',
			input: 'first-frame'
		});
		const readiness = baseHalfCanvasVideoInputReadinessMessage({
			kind: 'source-missing',
			input: 'first-frame',
			sourcePath: 'shots/missing-start.png'
		});
		const presentation = createBaseHalfVideoMessagePrecedencePresentation([
			{ kind: 'settings-adjustment', message: 'A scalar setting changed.' },
			readiness
		]);
		assert.strictEqual(missingStart.kind, 'input-readiness-problem');
		assert.strictEqual(missingStart.message, 'Add Start Frame.');
		assert.strictEqual(missingStart.action?.id, 'review-inputs');
		assert.strictEqual(missingStart.action?.label, 'Add Start Frame.');
		assert.strictEqual(readiness.kind, 'input-readiness-problem');
		assert.strictEqual(readiness.action?.id, 'review-inputs');
		assert.strictEqual(readiness.message.includes('shots/missing-start.png'), true);
		assert.deepStrictEqual(presentation.primaryMessage, readiness);
		assert.strictEqual(presentation.primaryAction?.id, 'review-inputs');
	});

	test('projects model blockers into concrete user actions', () => {
		const base = {
			hasProblem: true,
			hasSelectedModel: true,
			hasConnection: true,
			connectionConfigured: true,
			connectionTransportSupported: true,
			connectionSetupAvailable: true,
			replacementConnectionAvailable: false,
			hasPromptProblem: false
		} as const;
		assert.deepStrictEqual(baseHalfCanvasVideoModelProblemAction({
			...base,
			hasSelectedModel: false
		}), { id: 'choose-model', label: 'Choose a model' });
		assert.deepStrictEqual(baseHalfCanvasVideoModelProblemAction({
			...base,
			hasConnection: false
		}), { id: 'connect-model', label: 'Connect' });
		assert.deepStrictEqual(baseHalfCanvasVideoModelProblemAction({
			...base,
			hasConnection: false,
			connectionSetupAvailable: false
		}), { id: 'choose-model', label: 'Choose another model' });
		assert.deepStrictEqual(baseHalfCanvasVideoModelProblemAction({
			...base,
			hasConnection: false,
			replacementConnectionAvailable: true
		}), { id: 'choose-model', label: 'Use available connection' });
		assert.deepStrictEqual(baseHalfCanvasVideoModelProblemAction({
			...base,
			connectionConfigured: false
		}), { id: 'reconnect-model', label: 'Reconnect' });
		assert.deepStrictEqual(baseHalfCanvasVideoModelProblemAction({
			...base,
			capabilityStatus: 'unavailable'
		}), { id: 'choose-model', label: 'Choose another model' });
		assert.deepStrictEqual(baseHalfCanvasVideoModelProblemAction({
			...base,
			capabilityStatus: 'supported',
			settingsStatus: 'unavailable'
		}), { id: 'adjust-settings', label: 'Adjust available settings' });
		assert.deepStrictEqual(baseHalfCanvasVideoModelProblemAction({
			...base,
			capabilityStatus: 'supported',
			settingsStatus: 'ready',
			hasPromptProblem: true
		}), { id: 'edit-prompt', label: 'Edit prompt' });
		assert.deepStrictEqual(baseHalfCanvasVideoModelProblemAction({
			...base,
			capabilityStatus: 'supported',
			settingsStatus: 'ready'
		}), { id: 'apply-settings', label: 'Apply current settings' });
		assert.strictEqual(baseHalfCanvasVideoModelProblemAction({
			...base,
			hasProblem: false
		}), undefined);
	});

	test('rebinds an exact selected model whenever no saved service is currently resolvable', () => {
		assert.strictEqual(baseHalfCanvasVideoConnectionBindingRequiresRebind(true, false, true), true);
		assert.strictEqual(baseHalfCanvasVideoConnectionBindingRequiresRebind(true, true, true), false);
		assert.strictEqual(baseHalfCanvasVideoConnectionBindingRequiresRebind(true, false, false), false);
		assert.strictEqual(baseHalfCanvasVideoConnectionBindingRequiresRebind(false, false, true), false);
	});

	test('checkpoints prompt-first Video Drafts before locked model setup without persisting incomplete model state', () => {
		const draft = createBaseHalfNodeDocument({
			id: '4ab3f61b-08bf-40d7-870d-f98f3673c966',
			kind: 'video',
			title: 'Video',
			role: 'Generated video'
		});
		const checkpoint = baseHalfCanvasProvisionalVideoDraftDocument(
			draft,
			'  Product reveal  ',
			'  Generated video  ',
			'A brushed-metal speaker rotates slowly in warm studio light.'
		);

		assert.ok(checkpoint);
		assert.strictEqual(checkpoint.id, draft.id);
		assert.strictEqual(checkpoint.title, 'Product reveal');
		assert.strictEqual(checkpoint.role, 'Generated video');
		assert.strictEqual(checkpoint.prompt, 'A brushed-metal speaker rotates slowly in warm studio light.');
		assert.strictEqual(checkpoint.recipe, undefined);
		assert.deepStrictEqual(checkpoint.attempts, []);
		const persisted = JSON.parse(serializeBaseHalfNodeDocument(checkpoint));
		assert.strictEqual(persisted.id, draft.id);
		assert.strictEqual(persisted.prompt, checkpoint.prompt);
		assert.strictEqual(persisted.recipe, undefined);

		const configured = createBaseHalfNodeDocument({
			id: '19fc2d97-feb4-4762-bf7e-660a80d45bce',
			kind: 'video',
			title: 'Existing video',
			role: 'Generated video',
			recipe: {
				recipeId: 'studio.video',
				modelServiceId: 'official.connection',
				modelId: 'reviewed-model',
				parameters: { duration: 5 },
				inputBindings: []
			}
		});
		const configuredCheckpoint = baseHalfCanvasProvisionalVideoDraftDocument(configured, configured.title, configured.role, 'Updated prompt');
		assert.ok(configuredCheckpoint);
		assert.strictEqual(configuredCheckpoint.recipe, configured.recipe);
		assert.strictEqual(configuredCheckpoint.prompt, 'Updated prompt');
		assert.strictEqual(baseHalfCanvasProvisionalVideoDraftDocument({ ...draft, attempts: [{} as never] }, draft.title, draft.role, 'Blocked'), undefined);
	});

	test('invalidates post-create presentation when interaction or navigation ownership changes', () => {
		const navigationA = {} as never;
		const navigationB = {} as never;
		const owner = { interactionEpoch: 7, navigationEpoch: 11, navigationState: navigationA };

		assert.strictEqual(baseHalfCanvasPostCreateOwnerIsCurrent(owner, 7, 11, navigationA), true);
		assert.strictEqual(baseHalfCanvasPostCreateOwnerIsCurrent(owner, 8, 11, navigationA), false);
		assert.strictEqual(baseHalfCanvasPostCreateOwnerIsCurrent(owner, 7, 12, navigationA), false);
		assert.strictEqual(baseHalfCanvasPostCreateOwnerIsCurrent(owner, 7, 11, navigationB), false);
	});

	test('prioritizes an explicit semantic model focus target before exact restoration', () => {
		const host = document.createElement('div');
		const stale = document.createElement('button');
		const current = document.createElement('button');
		host.append(stale, current);
		document.body.appendChild(host);
		try {
			stale.focus();
			assert.strictEqual(document.activeElement, stale);
			baseHalfCanvasVideoOverlayNextFocusTarget(current, stale, undefined, undefined)?.focus();
			assert.strictEqual(document.activeElement, current);
		} finally {
			host.remove();
		}
	});

	test('uses the preferred model row on a fresh picker open without a restoration target', () => {
		const preferred = document.createElement('button');
		assert.strictEqual(
			baseHalfCanvasVideoOverlayNextFocusTarget(undefined, undefined, undefined, preferred),
			preferred
		);
	});

	test('keeps model arrow navigation at list edges and supports Home and End', () => {
		assert.strictEqual(baseHalfCanvasVideoModelNavigationIndex(4, 0, 'ArrowUp'), 0);
		assert.strictEqual(baseHalfCanvasVideoModelNavigationIndex(4, 3, 'ArrowDown'), 3);
		assert.strictEqual(baseHalfCanvasVideoModelNavigationIndex(4, 2, 'Home'), 0);
		assert.strictEqual(baseHalfCanvasVideoModelNavigationIndex(4, 1, 'End'), 3);
		assert.strictEqual(baseHalfCanvasVideoModelNavigationIndex(0, 0, 'Home'), undefined);
	});

	test('finds model rows by normalized prefix without filtering their order', () => {
		const rows = [
			{ typeaheadText: 'alpha cloud' },
			{ typeaheadText: 'beta studio' },
			{ typeaheadText: 'gamma' }
		];
		assert.strictEqual(baseHalfCanvasVideoModelTypeaheadIndex(rows, -1, 'BE'), 1);
		assert.strictEqual(baseHalfCanvasVideoModelTypeaheadIndex(rows, 1, 'alpha'), 0);
		assert.strictEqual(baseHalfCanvasVideoModelTypeaheadIndex(rows, 0, '  gamma  '), 2);
		assert.strictEqual(baseHalfCanvasVideoModelTypeaheadIndex(rows, 0, 'missing'), undefined);
		assert.deepStrictEqual(rows.map(row => row.typeaheadText), ['alpha cloud', 'beta studio', 'gamma']);
	});

	test('reserves Space for standard model button activation instead of typeahead', () => {
		assert.strictEqual(baseHalfCanvasVideoModelIsTypeaheadKey(' ', false, false, false, false), false);
		assert.strictEqual(baseHalfCanvasVideoModelIsTypeaheadKey('\t', false, false, false, false), false);
		assert.strictEqual(baseHalfCanvasVideoModelIsTypeaheadKey('m', false, false, false, false), true);
		assert.strictEqual(baseHalfCanvasVideoModelIsTypeaheadKey('m', false, false, true, false), false);
	});

	test('prioritizes compact model capabilities without truncating accessible details', () => {
		const summary = baseHalfCanvasVideoModelCapabilitySummary([
			{ kind: 'method', label: 'Text to video' },
			{ kind: 'audio', label: 'Native audio' },
			{ kind: 'resolution', label: 'Up to 1080p' },
			{ kind: 'duration', label: '1–15s' },
			{ kind: 'aspect-ratio', label: '16:9' }
		], 'Cloud / Global');
		assert.strictEqual(summary.visible, 'Cloud / Global · Up to 1080p · 1–15s');
		assert.strictEqual(summary.accessible, 'Cloud / Global · Text to video · Native audio · Up to 1080p · 1–15s · 16:9');
	});

	test('keeps unavailable generation methods visible but disabled with their reason', () => {
		assert.deepStrictEqual(baseHalfCanvasVideoMethodControlState({
			enabled: false,
			disabledReason: 'Requires an image input.'
		}, true), {
			disabled: true,
			disabledReason: 'Requires an image input.'
		});
		assert.deepStrictEqual(baseHalfCanvasVideoMethodControlState({ enabled: true }, false), { disabled: true });
		assert.deepStrictEqual(baseHalfCanvasVideoMethodControlState({ enabled: true }, true), { disabled: false });
	});

	test('retains every canonical adjustment when Settings opens after catalog constraints change', () => {
		const openingParameters = [{
			parameterId: 'resolution',
			label: 'Resolution',
			control: 'fixed' as const,
			enabled: true,
			value: '720p'
		}];
		const state = baseHalfCanvasVideoCanonicalAdjustmentState([{
			parameterId: 'durationSeconds',
			kind: 'constrained',
			reason: 'Previous catalog constraint.',
			previousValue: 12,
			value: 8
		}], [{
			parameterId: 'resolution',
			kind: 'constrained',
			reason: 'Current catalog constraint.',
			previousValue: '1080p',
			value: '720p'
		}], [], openingParameters);
		assert.deepStrictEqual(state.adjustments.map(adjustment => adjustment.parameterId), ['durationSeconds', 'resolution']);
		assert.strictEqual(state.previousParameters, openingParameters);
	});

	test('gives the Settings slider and exact number input distinct accessible names', () => {
		assert.deepStrictEqual(baseHalfCanvasVideoRangeAccessibleNames('Duration'), {
			slider: 'Duration slider',
			exactValue: 'Duration exact value'
		});
	});

	test('accepts bounded canvas zoom percentages without turning invalid input into reset', () => {
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('20'), 0.2);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput(' 37.5% '), 0.375);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('400'), 4);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('19.9'), undefined);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('401%'), undefined);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput(''), undefined);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('fit'), undefined);
		assert.strictEqual(formatBaseHalfCanvasZoomPercent(0.375), '37.5');
		assert.strictEqual(formatBaseHalfCanvasZoomPercent(1), '100');
		assert.strictEqual(formatBaseHalfCanvasZoomPercent(4), '400');
	});
});
