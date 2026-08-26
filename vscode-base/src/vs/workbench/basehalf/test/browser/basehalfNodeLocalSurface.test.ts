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
	baseHalfNodeAttemptHasCompleteRetrySnapshot,
	baseHalfNodeArtifactUsesTextPreview,
	baseHalfNodeCanImportContentKind,
	baseHalfNodeImportActionLabel,
	baseHalfNodeLocalStatusToken,
	baseHalfNodeLocalPrimaryActionOpensSurface,
	baseHalfNodeLocalSurfaceTargetOwnsEscape,
	BaseHalfNodeParameterDraft,
	chooseBaseHalfNodeConnectionSlot,
	configureBaseHalfNodeLocalSurfaceAccessibility,
	createBaseHalfNodeModelSelection,
	createBaseHalfNodeParameterDraft,
	decodeBaseHalfNodeTextPreview,
	getBaseHalfNodeAvailableInputSlots,
	getBaseHalfNodeAssignableInputSlots,
	getBaseHalfNodeAttemptDisclosureLines,
	getBaseHalfNodeAttemptSummary,
	getBaseHalfNodeCardStatusText,
	getBaseHalfNodeImportProblem,
	getBaseHalfNodeInputResultLabel,
	getBaseHalfNodeInputStructureProblem,
	getBaseHalfNodeInputRows,
	getBaseHalfNodeLocalExecutionState,
	getBaseHalfNodeLocalState,
	getBaseHalfNodeModelSelectionProblem,
	getBaseHalfNodeResultArtifactOpenProblem,
	isBaseHalfNodeCardStatusPositive,
	IBaseHalfNodeLocalConfigurationDraft,
	mergeBaseHalfNodeLocalConfigurationDraft,
	moveBaseHalfNodeInputBinding,
	parseBaseHalfNodeParameterDraft,
	resolveBaseHalfNodeLocalDraftExit,
	resolveBaseHalfNodeLocalSurfacePlacement,
	resolveBaseHalfVideoComposerPopoverGeometryDismissReason,
	resolveBaseHalfVideoComposerPopoverPlacement,
	resolveBaseHalfNodeImplicitVideoRecipe,
	resolveBaseHalfNodeRecipeDraft
} from '../../browser/basehalfNodeLocalSurface.js';
import { IBaseHalfCanvasRecipeDescriptor } from '../../common/basehalfCanvasRecipes.js';
import { IBaseHalfModelServiceDescriptor } from '../../common/basehalfModelServices.js';
import {
	beginBaseHalfNodeAttempt,
	cancelBaseHalfNodeAttempt,
	completeBaseHalfNodeAttempt,
	createBaseHalfNodeDocument,
	failBaseHalfNodeAttempt,
	IBaseHalfNodeDocument,
	importBaseHalfNodeResult,
	interruptBaseHalfNodeAttempt
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

	test('prefers a requested surface side only when it can contain the surface', () => {
		const preferredBelow = resolveBaseHalfNodeLocalSurfacePlacement(
			{ left: 300, top: 100, right: 500, bottom: 300 },
			{ width: 1400, height: 1100 },
			{ width: 400, height: 640 },
			16,
			'below'
		);
		assert.strictEqual(preferredBelow.side, 'below');
		assert.strictEqual(preferredBelow.anchorAxisAlignment, AnchorAxisAlignment.VERTICAL);
		assert.strictEqual(preferredBelow.anchorPosition, AnchorPosition.BELOW);

		const insufficientBelow = resolveBaseHalfNodeLocalSurfacePlacement(
			{ left: 300, top: 100, right: 500, bottom: 500 },
			{ width: 1400, height: 900 },
			{ width: 400, height: 640 },
			16,
			'below'
		);
		assert.strictEqual(insufficientBelow.side, 'right');
	});

	test('places canonical Composer popovers beside their live triggers and flips at the viewport edge', () => {
		const composer = { left: 244, top: 430, right: 756, bottom: 590 };
		const viewport = { left: 0, top: 0, right: 1000, bottom: 800 };
		const modelTrigger = { left: 254, top: 548, right: 390, bottom: 576 };
		const models = resolveBaseHalfVideoComposerPopoverPlacement({
			kind: 'models',
			composerPlacement: 'below',
			composer,
			trigger: modelTrigger,
			viewport,
			desiredHeight: 500,
			alignment: 'trigger-leading'
		});
		assert.deepStrictEqual(models, {
			placement: 'above',
			left: 10,
			top: -208,
			width: 224,
			maxHeight: 320
		});

		const topComposer = { left: 244, top: 12, right: 756, bottom: 172 };
		const settingsTrigger = { left: 390, top: 130, right: 650, bottom: 158 };
		const settings = resolveBaseHalfVideoComposerPopoverPlacement({
			kind: 'settings',
			composerPlacement: 'clamped-above',
			composer: topComposer,
			trigger: settingsTrigger,
			viewport,
			desiredHeight: 240,
			alignment: 'trigger-leading'
		});
		assert.strictEqual(settings.placement, 'below');
		assert.strictEqual(settings.width, 256);
		assert.strictEqual(settings.top, 152);
		assert.strictEqual(settings.maxHeight, 360);

		const narrow = resolveBaseHalfVideoComposerPopoverPlacement({
			kind: 'attempts',
			composerPlacement: 'below',
			composer: { left: 12, top: 240, right: 308, bottom: 400 },
			trigger: { left: 240, top: 358, right: 268, bottom: 386 },
			viewport: { left: 0, top: 0, right: 320, bottom: 480 },
			desiredHeight: 420,
			alignment: 'trigger-trailing'
		});
		assert.strictEqual(narrow.width, 304);
		assert.strictEqual(narrow.left, -4);
		assert.strictEqual(narrow.placement, 'above');
	});

	test('uses the 160-pixel threshold only to choose a popover side', () => {
		const composer = { left: 200, top: 173, right: 712, bottom: 333 };
		const viewport = { left: 0, top: 0, right: 1000, bottom: 500 };
		const atThreshold = resolveBaseHalfVideoComposerPopoverPlacement({
			kind: 'models',
			composerPlacement: 'below',
			composer,
			trigger: { left: 210, top: 174, right: 346, bottom: 202 },
			viewport,
			desiredHeight: 320,
			alignment: 'trigger-leading'
		});
		assert.strictEqual(atThreshold.placement, 'above');
		assert.strictEqual(atThreshold.maxHeight, 160);
		assert.strictEqual(atThreshold.width, 224);

		const belowThreshold = resolveBaseHalfVideoComposerPopoverPlacement({
			kind: 'models',
			composerPlacement: 'below',
			composer,
			trigger: { left: 210, top: 173, right: 346, bottom: 201 },
			viewport,
			desiredHeight: 320,
			alignment: 'trigger-leading'
		});
		assert.strictEqual(belowThreshold.placement, 'below');
		assert.strictEqual(belowThreshold.maxHeight, 285);

		const shortNaturalSurface = resolveBaseHalfVideoComposerPopoverPlacement({
			kind: 'models',
			composerPlacement: 'below',
			composer,
			trigger: { left: 210, top: 110, right: 346, bottom: 138 },
			viewport,
			desiredHeight: 96,
			alignment: 'trigger-leading'
		});
		assert.strictEqual(shortNaturalSurface.placement, 'above');
		assert.strictEqual(shortNaturalSurface.maxHeight, 96);
		assert.strictEqual(shortNaturalSurface.width, 224);
	});

	test('clamps popovers to a translated viewport without compressing canonical width', () => {
		const placement = resolveBaseHalfVideoComposerPopoverPlacement({
			kind: 'models',
			composerPlacement: 'below',
			composer: { left: 680, top: 430, right: 1192, bottom: 590 },
			trigger: { left: 1110, top: 548, right: 1182, bottom: 576 },
			viewport: { left: 100, top: 50, right: 1100, bottom: 850 },
			desiredHeight: 500,
			alignment: 'trigger-leading'
		});
		assert.deepStrictEqual(placement, {
			placement: 'above',
			left: 188,
			top: -208,
			width: 224,
			maxHeight: 320
		});
		assert.strictEqual(680 + placement.left, 1100 - 8 - 224);

		const panned = resolveBaseHalfVideoComposerPopoverPlacement({
			kind: 'models',
			composerPlacement: 'below',
			composer: { left: 717, top: 451, right: 1229, bottom: 611 },
			trigger: { left: 1147, top: 569, right: 1219, bottom: 597 },
			viewport: { left: 137, top: 71, right: 1137, bottom: 871 },
			desiredHeight: 500,
			alignment: 'trigger-leading'
		});
		assert.deepStrictEqual(panned, placement);
	});

	test('uses emergency popover width only when the viewport cannot hold canonical width and margins', () => {
		const resolve = (viewportWidth: number) => resolveBaseHalfVideoComposerPopoverPlacement({
			kind: 'models',
			composerPlacement: 'below',
			composer: { left: 8, top: 200, right: viewportWidth - 8, bottom: 360 },
			trigger: { left: 18, top: 318, right: 130, bottom: 346 },
			viewport: { left: 0, top: 0, right: viewportWidth, bottom: 600 },
			desiredHeight: 320,
			alignment: 'trigger-leading'
		});
		assert.strictEqual(resolve(241).width, 224);
		assert.strictEqual(resolve(240).width, 224);
		assert.strictEqual(resolve(239).width, 223);
		assert.strictEqual(resolve(200).width, 184);
	});

	test('shrinks popover height internally while preserving its width and viewport margin', () => {
		const placement = resolveBaseHalfVideoComposerPopoverPlacement({
			kind: 'models',
			composerPlacement: 'below',
			composer: { left: 244, top: 126, right: 756, bottom: 286 },
			trigger: { left: 254, top: 126, right: 390, bottom: 154 },
			viewport: { left: 0, top: 0, right: 1000, bottom: 248 },
			desiredHeight: 320,
			alignment: 'trigger-leading'
		});
		assert.strictEqual(placement.placement, 'above');
		assert.strictEqual(placement.top, -118);
		assert.strictEqual(placement.maxHeight, 112);
		assert.strictEqual(placement.width, 224);
		assert.strictEqual(126 + placement.top, 8);
	});

	test('classifies geometry notifications that close an open Composer child', () => {
		const stable = { anchorChanged: false, viewportResized: false, viewportInteraction: false };
		assert.strictEqual(resolveBaseHalfVideoComposerPopoverGeometryDismissReason(stable, true), undefined);
		assert.strictEqual(resolveBaseHalfVideoComposerPopoverGeometryDismissReason({ ...stable, manipulating: 'node-move' }, true), 'node-move');
		assert.strictEqual(resolveBaseHalfVideoComposerPopoverGeometryDismissReason({ ...stable, manipulating: 'node-resize' }, true), 'node-resize');
		assert.strictEqual(resolveBaseHalfVideoComposerPopoverGeometryDismissReason({ ...stable, viewportInteraction: true }, true), 'viewport-interaction');
		assert.strictEqual(resolveBaseHalfVideoComposerPopoverGeometryDismissReason({ ...stable, anchorChanged: true }, true), 'anchor-reflow');
		assert.strictEqual(resolveBaseHalfVideoComposerPopoverGeometryDismissReason({ ...stable, anchorChanged: true, viewportResized: true }, true), undefined);
		assert.strictEqual(resolveBaseHalfVideoComposerPopoverGeometryDismissReason({ ...stable, viewportResized: true }, false), 'viewport-resize');
	});

	test('projects lifecycle labels to stable CSS tokens', () => {
		assert.strictEqual(baseHalfNodeLocalStatusToken('Draft'), 'draft');
		assert.strictEqual(baseHalfNodeLocalStatusToken('Needs input'), 'needs-input');
		assert.strictEqual(baseHalfNodeLocalStatusToken('Output changed'), 'output-changed');
	});

	test('keeps Edit explicit when the primary action performs work', () => {
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'add', label: 'Add content' }), true);
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'configure', label: 'Configure' }), true);
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'run', label: 'Generate' }), false);
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'retry', label: 'Retry' }), false);
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'copy', label: 'Copy settings' }), false);
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'locate', label: 'Locate file' }), false);
		assert.strictEqual(baseHalfNodeLocalPrimaryActionOpensSurface({ kind: 'cancel', label: 'Cancel' }), false);
	});

	test('rebases unsaved fields over independent external configuration changes', () => {
		const base = localConfigurationDraft();
		const local = { ...base, title: 'Local title' };
		const external = {
			...base,
			role: 'external-role',
			prompt: 'External prompt',
			inputBindings: [{ sourcePath: 'reference.png', slot: 'reference', order: 0 }]
		};

		const merged = mergeBaseHalfNodeLocalConfigurationDraft(base, local, external);
		assert.deepStrictEqual(merged.conflicts, []);
		assert.strictEqual(merged.draft.title, 'Local title');
		assert.strictEqual(merged.draft.role, 'external-role');
		assert.strictEqual(merged.draft.prompt, 'External prompt');
		assert.deepStrictEqual(merged.draft.inputBindings, external.inputBindings);
	});

	test('reports overlapping external edits without replacing the local draft', () => {
		const base = localConfigurationDraft();
		const local = { ...base, title: 'Local title', prompt: 'Local prompt', modelId: 'local-model' };
		const external = { ...base, title: 'External title', prompt: 'External prompt', modelId: 'external-model' };

		const merged = mergeBaseHalfNodeLocalConfigurationDraft(base, local, external);
		assert.deepStrictEqual(merged.conflicts, ['Title', 'Prompt', 'Model ID']);
		assert.strictEqual(merged.draft.title, 'Local title');
		assert.strictEqual(merged.draft.prompt, 'Local prompt');
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

	test('treats separately parsed canonical parameter objects as the same draft value', () => {
		const parameters = {
			generationMode: 'first-last-frame-to-video',
			modelSnapshot: { revision: 'reviewed-1', inputs: { 'first-frame': 1, 'last-frame': 1 } }
		} as unknown as BaseHalfNodeParameterDraft;
		const base = {
			...localConfigurationDraft(),
			parameters
		};
		const local = {
			...base,
			parameters: JSON.parse(JSON.stringify(base.parameters))
		};
		const external = {
			...base,
			parameters: JSON.parse(JSON.stringify(base.parameters)),
			inputBindings: [{ sourcePath: 'end.png', slot: 'last-frame', order: 0 }]
		};

		const merged = mergeBaseHalfNodeLocalConfigurationDraft(base, local, external);
		assert.deepStrictEqual(merged.conflicts, []);
		assert.deepStrictEqual(merged.draft.parameters, external.parameters);
		assert.deepStrictEqual(merged.draft.inputBindings, external.inputBindings);
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

	test('explains sealed Result integrity failures without offering replacement', () => {
		assert.strictEqual(
			getBaseHalfNodeResultArtifactOpenProblem('outputs/attempt/frame.png', 'available'),
			undefined
		);

		const missing = getBaseHalfNodeResultArtifactOpenProblem('outputs/attempt/frame.png', 'missing');
		assert.match(missing ?? '', /sealed Result file is missing/);
		assert.match(missing ?? '', /new Draft/);

		const changed = getBaseHalfNodeResultArtifactOpenProblem('outputs/attempt/frame.png', 'changed');
		assert.match(changed ?? '', /sealed Result file changed on disk/);
		assert.match(changed ?? '', /new Draft/);
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

	test('removes legacy model selection when an installed local video recipe is saved', () => {
		const document = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'video',
			title: 'Local clip',
			role: 'video-clip',
			recipe: {
				recipeId: localVideoRecipe.id,
				modelServiceId: 'legacy.video',
				modelId: 'free-form-model-id',
				parameters: { fps: 24 },
				inputBindings: []
			}
		});

		assert.deepStrictEqual(resolveBaseHalfNodeRecipeDraft(
			document,
			localVideoRecipe.id,
			localVideoRecipe,
			{ fps: 30 },
			'legacy.video',
			'free-form-model-id',
			[]
		), {
			recipeId: localVideoRecipe.id,
			parameters: { fps: 30 },
			inputBindings: []
		});
	});

	test('keeps a unique installed video generator in an empty Draft composer session', () => {
		const emptyVideoDraft = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'video',
			title: 'Video',
			role: 'video-clip'
		});
		assert.strictEqual(resolveBaseHalfNodeImplicitVideoRecipe(emptyVideoDraft, [recipe, videoRecipe]), videoRecipe);
		assert.strictEqual(resolveBaseHalfNodeImplicitVideoRecipe(emptyVideoDraft, [recipe]), undefined);
		assert.strictEqual(resolveBaseHalfNodeImplicitVideoRecipe(emptyVideoDraft, [
			videoRecipe,
			{ ...videoRecipe, id: 'pointa.canvas.video-alternate' }
		]), undefined);

		const configuredVideoDraft = withRecipe(emptyVideoDraft, {
			recipeId: videoRecipe.id,
			parameters: {},
			inputBindings: []
		});
		assert.strictEqual(resolveBaseHalfNodeImplicitVideoRecipe(configuredVideoDraft, [videoRecipe]), undefined);
		assert.strictEqual(resolveBaseHalfNodeImplicitVideoRecipe(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(2),
			kind: 'image',
			title: 'Image',
			role: 'storyboard-frame'
		}), [videoRecipe]), undefined);
	});

	test('keeps immutable model, input, cost, and Result provenance visible in attempt details', () => {
		const running = beginBaseHalfNodeAttempt(withRecipe(createBaseHalfNodeDocument({
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
			id: 'attempt-1',
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
		const completed = completeBaseHalfNodeAttempt(running, 'attempt-1', {
			completedAt: '2026-07-18T10:00:01Z',
			artifact: { id: 'image', outputId: 'image', kind: 'image', path: 'outputs/frame.png', sha256: 'B'.repeat(43), size: 12 },
			cost: { currency: 'USD', amount: '0.04', kind: 'actual' }
		});
		assert.strictEqual(
			getBaseHalfNodeAttemptSummary(completed.attempts[0], 'frame.png'),
			'frame.png · Studio Images / image-v2 · USD 0.04'
		);
		const disclosed = completeBaseHalfNodeAttempt(running, 'attempt-1', {
			completedAt: '2026-07-18T10:00:01Z',
			artifact: { id: 'image', outputId: 'image', kind: 'image', path: 'outputs/frame.png', sha256: 'B'.repeat(43), size: 12 },
			providerRequestId: 'request-42',
			usage: { inputTokens: 12, images: 1 },
			cost: { currency: 'USD', amount: '0.04', kind: 'actual' }
		});
		const disclosure = getBaseHalfNodeAttemptDisclosureLines(disclosed.attempts[0], disclosed.result?.artifact);
		assert.ok(disclosure.includes('Status: Succeeded'));
		assert.ok(disclosure.includes('Attempt: attempt-1'));
		assert.ok(disclosure.includes(`Recipe: ${recipe.id}`));
		assert.ok(disclosure.includes('Parameter prompt: “A frame”'));
		assert.ok(disclosure.includes('Model service: Studio Images (studio.images)'));
		assert.ok(disclosure.includes('Model: image-v2'));
		assert.ok(disclosure.includes('Input 1: brief.md → context · revision sha256:brief-v1'));
		assert.ok(disclosure.some(line => line.startsWith('Result: outputs/frame.png · image · 12 bytes · SHA-256 ')));
		assert.ok(disclosure.includes('Created: 2026-07-18T10:00:00Z'));
		assert.ok(disclosure.includes('Completed: 2026-07-18T10:00:01Z'));
		assert.ok(disclosure.includes('Request: request-42'));
		assert.ok(disclosure.includes('Usage: input tokens: 12, images: 1'));
		assert.ok(disclosure.includes('Cost: USD 0.04'));
	});

	test('projects Draft, Attempt, and sealed Result into one honest primary action', () => {
		const empty = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Frame',
			role: 'storyboard-frame'
		});
		assert.deepStrictEqual(getBaseHalfNodeLocalState(empty).action, { kind: 'add', label: 'Add content' });
		assert.strictEqual(getBaseHalfNodeLocalState(empty).status, 'Draft');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(empty, { matchingRecipeCount: 0 }).action, { kind: 'add', label: 'Add content' });
		assert.match(getBaseHalfNodeLocalState(empty, { matchingRecipeCount: 0 }).message, /existing image/);
		const imported = importBaseHalfNodeResult(empty, {
			id: 'image-1',
			outputId: 'imported',
			kind: 'image',
			path: 'assets/frame.png',
			sha256: 'A'.repeat(43),
			size: 12
		});
		assert.strictEqual(getBaseHalfNodeLocalState(imported).status, 'Result');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(imported).action, { kind: 'locate', label: 'Locate file' });
		assert.deepStrictEqual(getBaseHalfNodeLocalState(imported, {
			verificationPending: true
		}), {
			ready: false,
			status: 'Waiting',
			message: 'Checking the sealed result file.',
			action: { kind: 'wait', label: 'Checking' }
		});
		const missingImported = getBaseHalfNodeLocalState(imported, {
			resultIntegrity: 'missing'
		});
		assert.strictEqual(missingImported.status, 'Output missing');
		assert.deepStrictEqual(missingImported.action, { kind: 'locate', label: 'Locate file' });
		assert.match(missingImported.message, /sealed result file is missing/);

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
		assert.deepStrictEqual(getBaseHalfNodeLocalState(ready, { recipe, modelServices: [configuredModel] }).action, { kind: 'run', label: 'Generate' });
		assert.strictEqual(getBaseHalfNodeLocalState(ready, { recipe, modelServices: [configuredModel] }).status, 'Ready');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(ready, {
			recipe,
			modelServices: [configuredModel],
			verificationPending: true
		}), {
			ready: false,
			status: 'Waiting',
			message: 'Checking direct inputs before this Draft can generate.',
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
		}).status, 'Waiting');
		const cancelling = getBaseHalfNodeLocalState(ready, {
			recipe,
			modelServices: [configuredModel],
			execution: { phase: 'cancelling' }
		});
		assert.strictEqual(cancelling.status, 'Cancelling');
		assert.strictEqual(cancelling.ready, false);
		assert.deepStrictEqual(cancelling.action, { kind: 'cancel', label: 'Cancelling…' });

		const running = beginBaseHalfNodeAttempt(ready, {
			id: 'attempt-1',
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
		assert.strictEqual(persistedRunning.status, 'Waiting');
		assert.strictEqual(persistedRunning.ready, false);
		assert.deepStrictEqual(persistedRunning.action, { kind: 'recover', label: 'Check status' });
		assert.match(persistedRunning.message, /status check/);
		const failed = failBaseHalfNodeAttempt(running, 'attempt-1', {
			completedAt: '2026-07-18T10:00:01Z',
			error: 'Request failed'
		});
		assert.deepStrictEqual(getBaseHalfNodeLocalState(failed, { recipe, modelServices: [configuredModel] }).action, { kind: 'retry', label: 'Retry' });
		assert.strictEqual(getBaseHalfNodeLocalState(failed, { recipe, modelServices: [configuredModel] }).status, 'Failed');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(failed).action, { kind: 'wait', label: 'Retry unavailable' });
		assert.match(getBaseHalfNodeLocalState(failed).message, /exact recipe/);
		const changedFrozenConfiguration = failBaseHalfNodeAttempt(running, 'attempt-1', {
			completedAt: '2026-07-18T10:00:01Z',
			error: 'Retry requires the unchanged frozen Recipe, inputs, and model connection. Copy settings to a new Draft.'
		});
		const changedFrozenConfigurationState = getBaseHalfNodeLocalState(changedFrozenConfiguration, {
			recipe,
			modelServices: [configuredModel]
		});
		assert.strictEqual(changedFrozenConfigurationState.status, 'Failed');
		assert.deepStrictEqual(changedFrozenConfigurationState.action, { kind: 'copy', label: 'Copy settings' });
		assert.match(changedFrozenConfigurationState.message, /cannot be retried safely/);

		const succeeded = completeBaseHalfNodeAttempt(running, 'attempt-1', {
			completedAt: '2026-07-18T10:00:01Z',
			artifact: {
				id: 'image-1',
				outputId: 'image',
				kind: 'image',
				path: 'outputs/frame/attempt-1/frame.png',
				sha256: 'A'.repeat(43),
				size: 12
			}
		});
		assert.deepStrictEqual(getBaseHalfNodeLocalState(succeeded, { recipe, modelServices: [configuredModel] }).action, { kind: 'locate', label: 'Locate file' });
		assert.strictEqual(getBaseHalfNodeLocalState(succeeded, { recipe, modelServices: [configuredModel] }).status, 'Result');
		assert.strictEqual(getBaseHalfNodeLocalState(succeeded).status, 'Result');
		assert.strictEqual(getBaseHalfNodeLocalState(succeeded, { recipe: { ...recipe, outputs: [{ ...recipe.outputs[0], kind: 'video' }] } }).status, 'Result');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(succeeded, {
			recipe,
			modelServices: [configuredModel],
			resultIntegrity: 'missing'
		}).action, { kind: 'locate', label: 'Locate file' });
		assert.match(getBaseHalfNodeLocalState(succeeded, {
			recipe,
			modelServices: [configuredModel],
			resultIntegrity: 'missing'
		}).message, /sealed result file is missing/);
	});

	test('requires catalog validation instead of applying static recipe parameters to video settings', () => {
		const video = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(9),
			kind: 'video',
			title: 'Clip',
			role: 'generated-video',
			prompt: 'A quiet street at dusk',
			recipe: {
				recipeId: videoRecipe.id,
				modelServiceId: configuredVideoModel.id,
				modelId: 'video-v1',
				parameters: {
					generationMode: 'text-to-video',
					durationSeconds: 5,
					videoModelSnapshot: {
						schemaVersion: 1,
						catalogId: 'pointa.canvas.models',
						providerId: 'example',
						deploymentId: 'global',
						region: 'global',
						modelId: 'video-v1',
						revision: '2026-08-01',
						mode: 'text-to-video',
						inputs: { 'text-prompt': 1 }
					}
				},
				inputBindings: []
			}
		});

		const unverified = getBaseHalfNodeLocalState(video, {
			recipe: videoRecipe,
			modelServices: [configuredVideoModel]
		});
		assert.strictEqual(unverified.ready, false);
		assert.match(unverified.message, /not been verified/);

		const invalid = getBaseHalfNodeLocalState(video, {
			recipe: videoRecipe,
			modelServices: [configuredVideoModel],
			videoConfiguration: { valid: false, problem: 'The reviewed model revision is stale.' }
		});
		assert.strictEqual(invalid.ready, false);
		assert.strictEqual(invalid.message, 'The reviewed model revision is stale.');

		const ready = getBaseHalfNodeLocalState(video, {
			recipe: videoRecipe,
			modelServices: [configuredVideoModel],
			videoConfiguration: { valid: true }
		});
		assert.strictEqual(ready.status, 'Ready');
		assert.deepStrictEqual(ready.action, { kind: 'run', label: 'Generate' });
	});

	test('keeps cancelled and interrupted Attempts with complete snapshots distinct and Retry-only', () => {
		const ready = readyNode();
		const running = beginBaseHalfNodeAttempt(ready, attemptOptions('attempt-1'));
		const cancelled = cancelBaseHalfNodeAttempt(running, 'attempt-1', {
			completedAt: '2026-07-18T10:00:01Z'
		});
		assert.strictEqual(getBaseHalfNodeLocalState(cancelled, { recipe, modelServices: [configuredModel] }).status, 'Cancelled');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(cancelled, { recipe, modelServices: [configuredModel] }).action, { kind: 'retry', label: 'Retry' });
		const frozenProvider = getBaseHalfNodeLocalState(cancelled, { recipe, modelServices: [] });
		assert.strictEqual(frozenProvider.status, 'Provider missing');
		assert.deepStrictEqual(frozenProvider.action, { kind: 'wait', label: 'Retry unavailable' });
		assert.match(frozenProvider.message, /frozen settings/);
		const frozenDirty = getBaseHalfNodeLocalState(cancelled, { recipe, modelServices: [configuredModel], dirty: true });
		assert.deepStrictEqual(frozenDirty.action, { kind: 'wait', label: 'Retry unavailable' });
		assert.match(frozenDirty.message, /settings are frozen/i);

		const interrupted = interruptBaseHalfNodeAttempt(running, 'attempt-1', { error: 'Host restarted.' });
		assert.strictEqual(getBaseHalfNodeLocalState(interrupted, { recipe, modelServices: [configuredModel] }).status, 'Interrupted');
		assert.deepStrictEqual(getBaseHalfNodeLocalState(interrupted, { recipe, modelServices: [configuredModel] }).action, { kind: 'retry', label: 'Retry' });
		assert.match(getBaseHalfNodeLocalState(interrupted, { recipe, modelServices: [configuredModel] }).message, /Host restarted/);
	});

	test('offers Copy settings instead of a dead Retry when cancellation or interruption left an incomplete snapshot', () => {
		const ready = readyNode();
		const incompleteRunning = beginBaseHalfNodeAttempt(ready, {
			id: 'attempt-1',
			createdAt: '2026-07-18T10:00:00Z',
			startedAt: '2026-07-18T10:00:00Z',
			model: {
				source: 'service',
				connection: 'unavailable',
				serviceId: configuredModel.id,
				capability: 'image'
			},
			inputs: []
		});
		const cancelled = cancelBaseHalfNodeAttempt(incompleteRunning, 'attempt-1', {
			completedAt: '2026-07-18T10:00:01Z'
		});
		const interrupted = interruptBaseHalfNodeAttempt(incompleteRunning, 'attempt-1', { error: 'Host restarted.' });

		assert.strictEqual(baseHalfNodeAttemptHasCompleteRetrySnapshot(cancelled.attempts[0]), false);
		for (const [document, expectedStatus] of [[cancelled, 'Cancelled'], [interrupted, 'Interrupted']] as const) {
			const state = getBaseHalfNodeLocalState(document, { recipe, modelServices: [configuredModel] });
			assert.deepStrictEqual({
				status: state.status,
				ready: state.ready,
				action: state.action,
				messageHasProofBoundary: /cannot prove that a Retry/.test(state.message),
				messageOffersNewDraft: /Copy settings into a new Draft/.test(state.message)
			}, {
				status: expectedStatus,
				ready: true,
				action: { kind: 'copy', label: 'Copy settings' },
				messageHasProofBoundary: true,
				messageOffersNewDraft: true
			});
		}
	});

	test('allows import only on a completely empty Draft', () => {
		const empty = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Frame',
			role: 'storyboard-frame'
		});
		assert.strictEqual(getBaseHalfNodeImportProblem(empty), undefined);
		assert.match(getBaseHalfNodeImportProblem(readyNode()) ?? '', /empty Draft/);
		const failed = failBaseHalfNodeAttempt(
			beginBaseHalfNodeAttempt(readyNode(), attemptOptions('attempt-1')),
			'attempt-1',
			{ completedAt: '2026-07-18T10:00:01Z', error: 'Failed.' }
		);
		assert.match(getBaseHalfNodeImportProblem(failed) ?? '', /no recipe or attempts/);
		const imported = importBaseHalfNodeResult(empty, {
			id: 'image-1', outputId: 'imported', kind: 'image', path: 'assets/frame.png', sha256: 'A'.repeat(43), size: 12
		});
		assert.match(getBaseHalfNodeImportProblem(imported) ?? '', /sealed Result cannot be replaced/);
	});

	test('stops Retry at the immutable Attempt limit', () => {
		const configured = readyNode();
		const full = createBaseHalfNodeDocument({
			...configured,
			attempts: Array.from({ length: 1024 }, (_entry, index) => ({
				id: `attempt-${index}`,
				status: 'interrupted' as const,
				createdAt: '2026-07-18T10:00:00Z',
				startedAt: '2026-07-18T10:00:00Z',
				prompt: configured.prompt,
				recipe: configured.recipe!,
				model: {
					source: 'service' as const,
					connection: 'resolved' as const,
					serviceId: configuredModel.id,
					serviceLabel: configuredModel.label,
					connectionIdentity: configuredModel.connectionIdentity,
					capability: 'image' as const
				},
				inputs: [{ sourcePath: 'brief.md', slot: 'context', order: 0, revision: `brief-${index}` }]
			}))
		});
		const state = getBaseHalfNodeLocalState(full, { recipe, modelServices: [configuredModel] });
		assert.strictEqual(state.ready, true);
		assert.strictEqual(state.status, 'Needs input');
		assert.deepStrictEqual(state.action, { kind: 'copy', label: 'Copy settings' });
		assert.match(state.message, /1024 attempts/);
		assert.match(state.message, /new Draft/);
	});

	test('shows blockers and recovery reasons on the card without coloring them as success', () => {
		const blocked = {
			ready: false,
			status: 'Needs input',
			message: 'Save this Draft before generating.',
			action: { kind: 'configure', label: 'Configure' }
		} as const;
		assert.strictEqual(getBaseHalfNodeCardStatusText(blocked), 'Needs input');
		assert.strictEqual(isBaseHalfNodeCardStatusPositive(blocked), false);

		const failed = {
			ready: true,
			status: 'Failed',
			message: 'The attempt failed. Settings are frozen.',
			action: { kind: 'retry', label: 'Retry' }
		} as const;
		assert.strictEqual(getBaseHalfNodeCardStatusText(failed), 'Failed');
		assert.strictEqual(isBaseHalfNodeCardStatusPositive(failed), false);

		const result = {
			ready: true,
			status: 'Result',
			message: 'Generated image is sealed and available.',
			action: { kind: 'locate', label: 'Locate file' }
		} as const;
		assert.strictEqual(getBaseHalfNodeCardStatusText(result), 'Result');
		assert.strictEqual(isBaseHalfNodeCardStatusPositive(result), true);
	});

	test('projects preparing, waiting, generating, and cancelling without document work', () => {
		const preparing = getBaseHalfNodeLocalExecutionState({ phase: 'preparing' });
		assert.strictEqual(preparing.status, 'Preparing');
		assert.deepStrictEqual(preparing.action, { kind: 'cancel', label: 'Cancel' });

		const waiting = getBaseHalfNodeLocalExecutionState({ phase: 'running' });
		assert.strictEqual(waiting.status, 'Waiting');
		assert.match(waiting.message, /provider/);

		for (let progress = 0; progress < 100; progress++) {
			const state = getBaseHalfNodeLocalExecutionState({
				phase: 'running',
				progress: progress + 1
			});
			assert.strictEqual(state.status, 'Generating');
			assert.strictEqual(state.message, `Generating ${progress + 1}%.`);
			assert.deepStrictEqual(state.action, { kind: 'cancel', label: 'Cancel' });
		}
		assert.strictEqual(getBaseHalfNodeLocalExecutionState({ phase: 'running', message: 'Rendering frames' }).status, 'Generating');

		const cancelling = getBaseHalfNodeLocalExecutionState({ phase: 'cancelling' });
		assert.strictEqual(cancelling.status, 'Cancelling');
		assert.deepStrictEqual(cancelling.action, { kind: 'cancel', label: 'Cancelling…' });
	});

	test('names one-time direct import actions after the sealed content they create', () => {
		assert.strictEqual(baseHalfNodeImportActionLabel('image'), 'Import image');
		assert.strictEqual(baseHalfNodeImportActionLabel('video'), 'Import video');
		assert.strictEqual(baseHalfNodeImportActionLabel('audio'), 'Import audio');
		assert.strictEqual(baseHalfNodeImportActionLabel('pdf'), 'Import PDF');
		assert.strictEqual(baseHalfNodeImportActionLabel('presentation'), 'Import presentation');
		assert.strictEqual(baseHalfNodeImportActionLabel('file'), 'Import file');
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
			['second.md', { source: 'attempt', id: 'attempt-2' }]
		]));
		assert.deepStrictEqual(rows.map(row => ({ path: row.sourcePath, slot: row.slotLabel, order: row.order, accepted: row.accepted })), [
			{ path: 'first.md', slot: 'retired-slot', order: 0, accepted: false },
			{ path: 'second.md', slot: 'Context', order: 1, accepted: true }
		]);
		assert.strictEqual(rows[0].resultIdentity, undefined);
		assert.deepStrictEqual(rows[1].resultIdentity, { source: 'attempt', id: 'attempt-2' });
		assert.strictEqual(getBaseHalfNodeInputResultLabel(rows[1].resultIdentity!), 'Generated Result · attempt-2');
		assert.strictEqual(
			getBaseHalfNodeInputResultLabel({ source: 'imported', id: 'imported-result-123456789' }),
			'Imported Result · imported…6789'
		);
		assert.deepStrictEqual(getBaseHalfNodeAvailableInputSlots(recipe, [], 'brief.md', 'text').map(slot => slot.id), ['context']);
		assert.deepStrictEqual(getBaseHalfNodeAvailableInputSlots(recipe, [
			{ sourcePath: 'brief.md', slot: 'context', order: 0 }
		], 'brief.md', 'text'), []);
		assert.deepStrictEqual(getBaseHalfNodeAvailableInputSlots(recipe, [], 'reference.png', 'image'), []);
	});

	test('blocks Generate on the first direct source without a verified Result', () => {
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
			['first.bhnode', 'first.bhnode has no usable Result.']
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
		assert.deepStrictEqual(blocked.action, { kind: 'wait', label: 'Generate unavailable' });
		assert.match(blocked.message, /first\.bhnode.*no usable Result/);

		const ready = getBaseHalfNodeLocalState(target, {
			recipe: mediaRecipe,
			modelServices: [configuredModel],
			inputKinds,
			directSourcePaths: ['first.bhnode', 'second.bhnode'],
			directSourceProblems: new Map()
		});
		assert.strictEqual(ready.ready, true);
		assert.deepStrictEqual(ready.action, { kind: 'run', label: 'Generate' });
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
	specId: 'pointa.images.studio',
	label: 'Studio Images',
	endpoint: 'https://models.example.test/v1',
	providerId: 'example',
	deploymentId: 'global',
	region: 'global',
	connectionIdentity: `sha256:${'A'.repeat(43)}`,
	capabilities: ['image'],
	authorization: 'bearer',
	publicValues: {},
	configured: true
};

const videoRecipe: IBaseHalfCanvasRecipeDescriptor = {
	id: 'pointa.canvas.video',
	extensionId: 'pointa.canvas',
	label: 'Generate video',
	modelCapability: 'video',
	videoModelCatalogId: 'pointa.canvas.models',
	inputs: [],
	parameters: [],
	outputs: [{
		id: 'video',
		kind: 'video',
		extensions: ['.mp4'],
		minItems: 1,
		maxItems: 1,
		primary: true
	}]
};

const localVideoRecipe: IBaseHalfCanvasRecipeDescriptor = {
	id: 'pointa.canvas.local-video',
	extensionId: 'pointa.canvas',
	label: 'Render local video',
	inputs: [],
	parameters: [{ id: 'fps', label: 'FPS', type: 'number', default: 24, minimum: 1, maximum: 60, step: 1 }],
	outputs: [{
		id: 'video',
		kind: 'video',
		extensions: ['.mp4'],
		minItems: 1,
		maxItems: 1,
		primary: true
	}]
};

const configuredVideoModel: IBaseHalfModelServiceDescriptor = {
	id: 'studio.video',
	specId: 'pointa.video.studio',
	label: 'Studio Video',
	endpoint: 'https://video.example.test/v1',
	providerId: 'example',
	deploymentId: 'global',
	region: 'global',
	connectionIdentity: `sha256:${'B'.repeat(43)}`,
	capabilities: ['video'],
	authorization: 'bearer',
	publicValues: {},
	configured: true
};

function localConfigurationDraft(): IBaseHalfNodeLocalConfigurationDraft {
	return {
		title: 'Frame',
		role: 'storyboard-frame',
		prompt: 'Quiet street',
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

function readyNode(): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(2),
		kind: 'image',
		title: 'Frame',
		role: 'storyboard-frame',
		recipe: {
			recipeId: recipe.id,
			modelServiceId: configuredModel.id,
			parameters: { prompt: 'Quiet street', count: 1, transparent: false, style: 'natural' },
			inputBindings: [{ sourcePath: 'brief.md', slot: 'context', order: 0 }]
		}
	});
}

function attemptOptions(id: string): Parameters<typeof beginBaseHalfNodeAttempt>[1] {
	return {
		id,
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
		inputs: [{ sourcePath: 'brief.md', slot: 'context', order: 0, revision: 'sha256:brief-v1' }]
	};
}

function withRecipe(document: IBaseHalfNodeDocument, recipeState: NonNullable<IBaseHalfNodeDocument['recipe']>): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({ ...document, recipe: recipeState });
}
