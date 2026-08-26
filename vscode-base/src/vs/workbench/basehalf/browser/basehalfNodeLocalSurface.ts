/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isHTMLElement } from '../../../base/browser/dom.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { AnchorAlignment, AnchorAxisAlignment, AnchorPosition } from '../../../base/common/layout.js';
import { equals as objectsEqual } from '../../../base/common/objects.js';
import {
	BaseHalfCanvasContentKind,
	baseHalfCanvasContentKindForPath,
	baseHalfCanvasRecipeMatchesNodeKind,
	IBaseHalfCanvasRecipeDescriptor,
	resolveBaseHalfCanvasRecipeParameters
} from '../common/basehalfCanvasRecipes.js';
import { IBaseHalfModelServiceDescriptor } from '../common/basehalfModelServices.js';
import {
	BaseHalfNodeArtifactKind,
	BaseHalfNodeJsonValue,
	BASEHALF_NODE_MAX_ATTEMPTS,
	IBaseHalfNodeDocument,
	IBaseHalfNodeInputBinding,
	IBaseHalfNodeRecipe,
	IBaseHalfNodeAttempt,
	IBaseHalfNodeResultArtifact
} from '../common/basehalfNodeDocument.js';
import {
	BaseHalfVideoComposerDirectManipulation,
	BaseHalfVideoComposerPlacement,
	IBaseHalfVideoComposerRect
} from '../common/basehalfVideoComposerPresentation.js';

export type BaseHalfNodeLocalPrimaryActionKind =
	| 'add'
	| 'import'
	| 'configure'
	| 'copy'
	| 'run'
	| 'retry'
	| 'cancel'
	| 'recover'
	| 'wait'
	| 'locate';

export interface IBaseHalfNodeLocalExecutionState {
	readonly phase: 'preparing' | 'running' | 'cancelling';
	readonly message?: string;
	readonly progress?: number;
}

export interface IBaseHalfNodeLocalPrimaryAction {
	readonly kind: BaseHalfNodeLocalPrimaryActionKind;
	readonly label: string;
}

export function baseHalfNodeLocalPrimaryActionOpensSurface(action: IBaseHalfNodeLocalPrimaryAction): boolean {
	return action.kind === 'add' || action.kind === 'configure';
}

export type BaseHalfNodeLocalStatus =
	| 'Draft'
	| 'Needs input'
	| 'Ready'
	| 'Preparing'
	| 'Waiting'
	| 'Generating'
	| 'Cancelling'
	| 'Result'
	| 'Failed'
	| 'Cancelled'
	| 'Interrupted'
	| 'Provider missing'
	| 'Output missing'
	| 'Output changed';

export interface IBaseHalfNodeLocalState {
	readonly ready: boolean;
	/** Stable, glanceable card state. */
	readonly status: BaseHalfNodeLocalStatus;
	readonly message: string;
	readonly action: IBaseHalfNodeLocalPrimaryAction;
}

const RETRY_CONFIGURATION_CHANGED_ERROR = 'Retry requires the unchanged frozen Recipe, inputs, and model connection.';

/** Stable class-name fragment for the compact lifecycle state rendered on a node. */
export function baseHalfNodeLocalStatusToken(status: BaseHalfNodeLocalStatus): string {
	return status.toLowerCase().replace(/\s+/g, '-');
}

export type BaseHalfNodeParameterDraftValue = string | boolean | undefined;
export type BaseHalfNodeParameterDraft = Readonly<Record<string, BaseHalfNodeParameterDraftValue>>;

export interface IBaseHalfNodeLocalConfigurationDraft {
	readonly title: string;
	readonly role: string;
	readonly prompt: string;
	readonly recipeId: string;
	readonly parameters: BaseHalfNodeParameterDraft;
	readonly modelServiceId?: string;
	readonly modelId?: string;
	readonly inputBindings: readonly IBaseHalfNodeInputBinding[];
}

export type BaseHalfNodeLocalConfigurationConflict =
	| 'Title'
	| 'Role'
	| 'Prompt'
	| 'Recipe'
	| 'Parameters'
	| 'Model service'
	| 'Model ID'
	| 'Direct inputs';

export interface IBaseHalfNodeLocalConfigurationMerge {
	readonly draft: IBaseHalfNodeLocalConfigurationDraft;
	readonly conflicts: readonly BaseHalfNodeLocalConfigurationConflict[];
}

export interface IBaseHalfNodeInputResultIdentity {
	readonly source: 'attempt' | 'imported';
	readonly id: string;
}

export interface IBaseHalfNodeLocalSurfacePlacement {
	readonly side: 'right' | 'left' | 'below' | 'above';
	readonly anchorAlignment: AnchorAlignment;
	readonly anchorAxisAlignment: AnchorAxisAlignment;
	readonly anchorPosition: AnchorPosition;
}

export type BaseHalfVideoComposerPopoverKind = 'models' | 'settings' | 'inputs' | 'attempts';
export type BaseHalfVideoComposerPopoverAlignment = 'trigger-leading' | 'composer-leading' | 'trigger-trailing';

export const BASEHALF_VIDEO_COMPOSER_POPOVER_GAP = 6;
export const BASEHALF_VIDEO_COMPOSER_POPOVER_VIEWPORT_MARGIN = 8;
/** This threshold chooses a side; it is never a minimum rendered height. */
export const BASEHALF_VIDEO_COMPOSER_POPOVER_PLACEMENT_VIABILITY_HEIGHT = 160;

export interface IBaseHalfVideoComposerPopoverPlacement {
	readonly placement: 'above' | 'below';
	/** Offset from the Composer's leading edge. */
	readonly left: number;
	/** Offset from the Composer's top edge. */
	readonly top: number;
	readonly width: number;
	readonly maxHeight: number;
}

export const BASEHALF_VIDEO_COMPOSER_POPOVER_WIDTHS: Readonly<Record<BaseHalfVideoComposerPopoverKind, number>> = Object.freeze({
	models: 224,
	settings: 256,
	inputs: 288,
	attempts: 320
});

export const BASEHALF_VIDEO_COMPOSER_POPOVER_MAX_HEIGHTS: Readonly<Record<BaseHalfVideoComposerPopoverKind, number>> = Object.freeze({
	models: 320,
	settings: 360,
	inputs: 360,
	attempts: 420
});

export interface IBaseHalfVideoComposerPopoverGeometryEvent {
	readonly anchorChanged: boolean;
	readonly viewportResized: boolean;
	readonly viewportInteraction: boolean;
	readonly manipulating?: BaseHalfVideoComposerDirectManipulation;
}

export type BaseHalfVideoComposerPopoverGeometryDismissReason =
	| BaseHalfVideoComposerDirectManipulation
	| 'viewport-interaction'
	| 'anchor-reflow'
	| 'viewport-resize';

/**
 * Resolves the earliest geometry notification that consumes an open child.
 * Callers close for a returned reason before applying the new anchor geometry.
 * A fitting viewport-only resize may keep and remeasure the child.
 */
export function resolveBaseHalfVideoComposerPopoverGeometryDismissReason(
	event: IBaseHalfVideoComposerPopoverGeometryEvent,
	popoverFits: boolean
): BaseHalfVideoComposerPopoverGeometryDismissReason | undefined {
	if (event.manipulating) {
		return event.manipulating;
	}
	if (event.viewportInteraction) {
		return 'viewport-interaction';
	}
	if (event.anchorChanged && !event.viewportResized) {
		return 'anchor-reflow';
	}
	if (event.viewportResized && !popoverFits) {
		return 'viewport-resize';
	}
	return undefined;
}

/**
 * Resolves one Composer child surface in screen space. The returned offsets are
 * relative to the stable Composer so the popover never participates in its
 * height or moves the canvas.
 */
export function resolveBaseHalfVideoComposerPopoverPlacement(options: {
	readonly kind: BaseHalfVideoComposerPopoverKind;
	readonly composerPlacement: BaseHalfVideoComposerPlacement;
	readonly composer: IBaseHalfVideoComposerRect;
	readonly trigger: IBaseHalfVideoComposerRect;
	readonly viewport: IBaseHalfVideoComposerRect;
	readonly desiredHeight: number;
	readonly alignment: BaseHalfVideoComposerPopoverAlignment;
}): IBaseHalfVideoComposerPopoverPlacement {
	const viewportMargin = BASEHALF_VIDEO_COMPOSER_POPOVER_VIEWPORT_MARGIN;
	const gap = BASEHALF_VIDEO_COMPOSER_POPOVER_GAP;
	const canonicalWidth = BASEHALF_VIDEO_COMPOSER_POPOVER_WIDTHS[options.kind];
	const maximumHeight = BASEHALF_VIDEO_COMPOSER_POPOVER_MAX_HEIGHTS[options.kind];
	const viewportWidth = Math.max(0, options.viewport.right - options.viewport.left);
	const width = Math.min(canonicalWidth, Math.max(0, viewportWidth - viewportMargin * 2));
	const desiredHeight = Math.min(maximumHeight, Math.max(0, Number.isFinite(options.desiredHeight) ? options.desiredHeight : 0));
	const availableAbove = Math.max(0, options.trigger.top - gap - options.viewport.top - viewportMargin);
	const availableBelow = Math.max(0, options.viewport.bottom - viewportMargin - options.trigger.bottom - gap);
	const prefersBelow = options.composerPlacement === 'above' || options.composerPlacement === 'clamped-above';
	const preferredRoom = prefersBelow ? availableBelow : availableAbove;
	const alternateRoom = prefersBelow ? availableAbove : availableBelow;
	const flips = preferredRoom < Math.min(desiredHeight, BASEHALF_VIDEO_COMPOSER_POPOVER_PLACEMENT_VIABILITY_HEIGHT)
		&& alternateRoom > preferredRoom;
	const placement: IBaseHalfVideoComposerPopoverPlacement['placement'] = prefersBelow !== flips ? 'below' : 'above';
	const availableHeight = placement === 'below' ? availableBelow : availableAbove;
	const maxHeight = Math.max(0, Math.min(maximumHeight, availableHeight));
	const height = Math.min(desiredHeight, maxHeight);
	const desiredLeft = options.alignment === 'composer-leading'
		? options.composer.left + 10
		: options.alignment === 'trigger-trailing'
			? options.trigger.right - width
			: options.trigger.left;
	const absoluteLeft = Math.min(
		options.viewport.right - viewportMargin - width,
		Math.max(options.viewport.left + viewportMargin, desiredLeft)
	);
	const desiredTop = placement === 'below'
		? options.trigger.bottom + gap
		: options.trigger.top - gap - height;
	const absoluteTop = Math.min(
		options.viewport.bottom - viewportMargin - height,
		Math.max(options.viewport.top + viewportMargin, desiredTop)
	);
	return Object.freeze({
		placement,
		left: absoluteLeft - options.composer.left,
		top: absoluteTop - options.composer.top,
		width,
		maxHeight
	});
}

/**
 * Chooses the node-adjacent side with the most usable room. The shared context
 * view still performs the final viewport clamp and flip after measuring the
 * rendered surface.
 */
export function resolveBaseHalfNodeLocalSurfacePlacement(
	anchor: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
	viewport: { readonly width: number; readonly height: number },
	surface = { width: 400, height: 640 },
	margin = 16,
	preferredSide?: IBaseHalfNodeLocalSurfacePlacement['side']
): IBaseHalfNodeLocalSurfacePlacement {
	const usable = {
		right: Math.max(0, viewport.width - anchor.right - margin) / Math.max(1, surface.width),
		left: Math.max(0, anchor.left - margin) / Math.max(1, surface.width),
		below: Math.max(0, viewport.height - anchor.bottom - margin) / Math.max(1, surface.height),
		above: Math.max(0, anchor.top - margin) / Math.max(1, surface.height)
	};
	const side = preferredSide && usable[preferredSide] >= 1
		? preferredSide
		: (Object.entries(usable) as Array<[IBaseHalfNodeLocalSurfacePlacement['side'], number]>)
			.sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'right';
	if (side === 'right' || side === 'left') {
		return Object.freeze({
			side,
			anchorAlignment: side === 'right' ? AnchorAlignment.LEFT : AnchorAlignment.RIGHT,
			anchorAxisAlignment: AnchorAxisAlignment.HORIZONTAL,
			anchorPosition: AnchorPosition.BELOW
		});
	}
	const alignLeft = anchor.left + surface.width <= viewport.width - margin;
	return Object.freeze({
		side,
		anchorAlignment: alignLeft ? AnchorAlignment.LEFT : AnchorAlignment.RIGHT,
		anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
		anchorPosition: side === 'below' ? AnchorPosition.BELOW : AnchorPosition.ABOVE
	});
}

export function configureBaseHalfNodeLocalSurfaceAccessibility(
	surface: HTMLElement,
	title: HTMLElement,
	documentId: string
): void {
	const titleId = `basehalf-node-local-title-${documentId}`;
	title.id = titleId;
	surface.setAttribute('role', 'dialog');
	surface.setAttribute('aria-modal', 'false');
	surface.setAttribute('aria-labelledby', titleId);
}

export function baseHalfNodeLocalSurfaceTargetOwnsEscape(target: EventTarget | null): boolean {
	return isHTMLElement(target) && target.closest('select') !== null;
}

export type BaseHalfNodeLocalDraftExitDecision = 'save' | 'discard' | 'keep';

/**
 * Resolves one attempt to leave a node's local editor. A failed save keeps the
 * draft open just like an explicit request to keep editing.
 */
export async function resolveBaseHalfNodeLocalDraftExit(
	hasDraftChanges: boolean,
	choose: () => Promise<BaseHalfNodeLocalDraftExitDecision>,
	save: () => Promise<boolean>
): Promise<boolean> {
	if (!hasDraftChanges) {
		return true;
	}
	const decision = await choose();
	if (decision === 'keep') {
		return false;
	}
	return decision === 'discard' || await save();
}

/**
 * Shares a single in-flight exit between pointer dismissal, surface switching,
 * and workbench shutdown so only one decision can consume the draft.
 */
export class BaseHalfNodeLocalDraftExitCoordinator {
	private pending: Promise<boolean> | undefined;

	get isPending(): boolean {
		return this.pending !== undefined;
	}

	request(operation: () => Promise<boolean>): Promise<boolean> {
		if (this.pending) {
			return this.pending;
		}
		const pending = Promise.resolve().then(operation);
		this.pending = pending;
		pending.then(
			() => this.clear(pending),
			() => this.clear(pending)
		);
		return pending;
	}

	private clear(pending: Promise<boolean>): void {
		if (this.pending === pending) {
			this.pending = undefined;
		}
	}
}

/**
 * Rebases an unsaved local draft over the latest saved configuration. Changes
 * made on only one side merge automatically; an overlapping change remains in
 * the local draft and is reported so the user must choose which side to keep.
 */
export function mergeBaseHalfNodeLocalConfigurationDraft(
	base: IBaseHalfNodeLocalConfigurationDraft,
	local: IBaseHalfNodeLocalConfigurationDraft,
	external: IBaseHalfNodeLocalConfigurationDraft
): IBaseHalfNodeLocalConfigurationMerge {
	const conflicts: BaseHalfNodeLocalConfigurationConflict[] = [];
	const title = mergeConfigurationField(base.title, local.title, external.title, 'Title', conflicts);
	const role = mergeConfigurationField(base.role, local.role, external.role, 'Role', conflicts);
	const prompt = mergeConfigurationField(base.prompt, local.prompt, external.prompt, 'Prompt', conflicts);
	const baseRecipe = recipeConfiguration(base);
	const localRecipe = recipeConfiguration(local);
	const externalRecipe = recipeConfiguration(external);
	const localRecipeChanged = !sameRecipeConfiguration(localRecipe, baseRecipe);
	const externalRecipeChanged = !sameRecipeConfiguration(externalRecipe, baseRecipe);

	let recipeId: string;
	let parameters: BaseHalfNodeParameterDraft;
	let modelServiceId: string | undefined;
	let modelId: string | undefined;
	let inputBindings: readonly IBaseHalfNodeInputBinding[];
	if (localRecipeChanged
		&& externalRecipeChanged
		&& local.recipeId !== external.recipeId
		&& !sameRecipeConfiguration(localRecipe, externalRecipe)) {
		conflicts.push('Recipe');
		({ recipeId, parameters, modelServiceId, modelId, inputBindings } = localRecipe);
	} else {
		recipeId = mergeConfigurationField(base.recipeId, local.recipeId, external.recipeId, 'Recipe', conflicts);
		parameters = mergeConfigurationField(base.parameters, local.parameters, external.parameters, 'Parameters', conflicts, sameParameterDraft);
		modelServiceId = mergeConfigurationField(base.modelServiceId, local.modelServiceId, external.modelServiceId, 'Model service', conflicts);
		modelId = mergeConfigurationField(base.modelId, local.modelId, external.modelId, 'Model ID', conflicts);
		inputBindings = mergeConfigurationField(base.inputBindings, local.inputBindings, external.inputBindings, 'Direct inputs', conflicts, sameInputBindings);
	}

	return Object.freeze({
		draft: Object.freeze({
			title,
			role,
			prompt,
			recipeId,
			parameters: Object.freeze({ ...parameters }),
			...(modelServiceId === undefined ? {} : { modelServiceId }),
			...(modelId === undefined ? {} : { modelId }),
			inputBindings: Object.freeze(inputBindings.map(binding => Object.freeze({ ...binding })))
		}),
		conflicts: Object.freeze([...new Set(conflicts)])
	});
}

export type BaseHalfNodeParameterDraftResult =
	| { readonly valid: true; readonly parameters: Readonly<Record<string, BaseHalfNodeJsonValue>> }
	| { readonly valid: false; readonly message: string };

export interface IBaseHalfNodeLocalStateOptions {
	readonly recipe?: IBaseHalfCanvasRecipeDescriptor;
	/**
	 * Video parameters are contributed by the reviewed model catalog rather
	 * than by the static recipe manifest. Callers must prove that the exact
	 * persisted model snapshot and its dynamic settings were revalidated.
	 */
	readonly videoConfiguration?:
		| { readonly valid: true }
		| { readonly valid: false; readonly problem: string };
	readonly modelServices?: readonly IBaseHalfModelServiceDescriptor[];
	readonly execution?: IBaseHalfNodeLocalExecutionState;
	readonly resultIntegrity?: 'missing' | 'changed';
	readonly dirty?: boolean;
	readonly graphProblem?: string;
	readonly directSourcePaths?: readonly string[];
	/** Actionable sealed-result integrity failures keyed by direct result-node path. */
	readonly directSourceProblems?: ReadonlyMap<string, string>;
	/** Expensive local artifact and direct-input checks are still running. */
	readonly verificationPending?: boolean;
	/** Number of installed recipes whose primary output matches this stable node kind. */
	readonly matchingRecipeCount?: number;
	/** Direct incoming source kinds resolved by the host for the local editor. */
	readonly inputKinds?: ReadonlyMap<string, BaseHalfCanvasContentKind>;
}

export function getBaseHalfNodeLocalState(
	document: IBaseHalfNodeDocument,
	options: IBaseHalfNodeLocalStateOptions = {}
): IBaseHalfNodeLocalState {
	if (options.execution) {
		return getBaseHalfNodeLocalExecutionState(options.execution);
	}
	if (document.result) {
		if (options.verificationPending) {
			return state('Waiting', false, 'Checking the sealed result file.', 'wait', 'Checking');
		}
		if (options.resultIntegrity === 'missing') {
			return state(
				'Output missing',
				true,
				'The sealed result file is missing. Locate its project path to restore the original file, or copy the settings into a new Draft.',
				'locate',
				'Locate file'
			);
		}
		if (options.resultIntegrity === 'changed') {
			return state(
				'Output changed',
				true,
				'The sealed result file changed outside BaseHalf. Restore the original bytes or copy the settings into a new Draft; this Result cannot be replaced.',
				'locate',
				'Locate file'
			);
		}
		const source = document.result.source === 'imported' ? 'Imported' : 'Generated';
		return state('Result', true, `${source} ${baseHalfNodeImportObjectLabel(document.kind)} is sealed and available.`, 'locate', 'Locate file');
	}

	const latest = document.attempts.at(-1);
	if (latest?.status === 'running') {
		return state(
			'Waiting',
			false,
			'This saved attempt needs a status check. If another host still owns it, generation continues; an abandoned attempt can be marked interrupted.',
			'recover',
			'Check status'
		);
	}
	if (latest && !baseHalfNodeAttemptHasCompleteRetrySnapshot(latest)) {
		const status = latest.status === 'cancelled' ? 'Cancelled' : latest.status === 'interrupted' ? 'Interrupted' : 'Failed';
		const reason = latest.status === 'cancelled'
			? 'The attempt was cancelled before its complete execution snapshot was frozen.'
			: latest.status === 'interrupted'
				? 'The attempt was interrupted before its complete execution snapshot was frozen.'
				: 'The attempt stopped before its complete execution snapshot was frozen.';
		return state(
			status,
			true,
			`${reason} BaseHalf cannot prove that a Retry would use the same model and inputs. Copy settings into a new Draft instead.`,
			'copy',
			'Copy settings'
		);
	}
	if (document.attempts.length >= BASEHALF_NODE_MAX_ATTEMPTS) {
		return state(
			'Needs input',
			true,
			`This Draft has reached ${BASEHALF_NODE_MAX_ATTEMPTS} attempts. Copy its settings into a new Draft; every existing attempt stays unchanged.`,
			'copy',
			'Copy settings'
		);
	}
	if (latest?.status === 'failed' && latest.error?.startsWith(RETRY_CONFIGURATION_CHANGED_ERROR) === true) {
		return state(
			'Failed',
			true,
			'The frozen Recipe, inputs, or model connection changed. This Attempt cannot be retried safely; copy its settings into a new Draft.',
			'copy',
			'Copy settings'
		);
	}

	if (!document.recipe) {
		const videoDraftMessage = options.matchingRecipeCount === 0
			? 'Write the prompt now. Choose a video generator before submitting, or import an existing video.'
			: 'Choose a video generator or import an existing video.';
		return state(
			'Draft',
			true,
			document.kind === 'video'
				? videoDraftMessage
				: options.matchingRecipeCount === 0
				? `Import an existing ${baseHalfNodeImportObjectLabel(document.kind)}. A generation recipe can be installed later.`
				: `Import an existing ${baseHalfNodeImportObjectLabel(document.kind)} or choose a generation recipe.`,
			'add',
			'Add content'
		);
	}

	const isFrozen = document.attempts.length > 0;
	const blockedAction: IBaseHalfNodeLocalPrimaryAction = isFrozen
		? Object.freeze({ kind: 'wait', label: 'Retry unavailable' })
		: Object.freeze({ kind: 'configure', label: 'Configure' });
	const recipe = options.recipe;
	if (!recipe || recipe.id !== document.recipe.recipeId.toLowerCase()) {
		return state(
			'Needs input',
			false,
			isFrozen
				? `Recipe '${document.recipe.recipeId}' is not installed. Restore that exact recipe to Retry; attempted settings are frozen.`
				: `Recipe '${document.recipe.recipeId}' is not installed. Choose an available recipe.`,
			blockedAction.kind,
			blockedAction.label
		);
	}
	if (!baseHalfCanvasRecipeMatchesNodeKind(recipe, document.kind)) {
		return state(
			'Needs input',
			false,
			isFrozen
				? `Recipe '${recipe.label}' no longer produces ${document.kind} content. Restore the compatible recipe to Retry; attempted settings are frozen.`
				: `Recipe '${recipe.label}' does not produce ${document.kind} content. Choose a matching recipe.`,
			blockedAction.kind,
			blockedAction.label
		);
	}
	if (options.dirty) {
		return state(
			'Needs input',
			false,
			isFrozen ? 'Attempted settings are frozen. Discard local changes before Retry.' : 'Save this Draft before generating.',
			isFrozen ? 'wait' : 'configure',
			isFrozen ? 'Retry unavailable' : 'Configure'
		);
	}

	const parameterProblem = recipe.modelCapability === 'video'
		? options.videoConfiguration?.valid === true
			? undefined
			: options.videoConfiguration?.problem ?? 'Video model settings have not been verified against the reviewed catalog.'
		: getParameterReadinessProblem(recipe, document.recipe.parameters);
	if (parameterProblem) {
		return state('Needs input', false, parameterProblem, blockedAction.kind, blockedAction.label);
	}

	if (recipe.modelCapability) {
		const modelCapability = recipe.modelCapability;
		const configured = (options.modelServices ?? [])
			.filter(service => service.configured && service.capabilities.includes(modelCapability));
		if (!document.recipe.modelServiceId) {
			return state(
				'Provider missing',
				false,
				configured.length > 0
					? `Choose a configured ${modelCapability} model service.`
					: `Add a configured ${modelCapability} model service in Settings.`,
				blockedAction.kind,
				blockedAction.label
			);
		}
		const modelServiceId = document.recipe.modelServiceId.toLowerCase();
		if (!configured.some(service => service.id === modelServiceId)) {
			return state(
				'Provider missing',
				false,
				isFrozen
					? `Model service '${document.recipe.modelServiceId}' is unavailable. Restore it to Retry the frozen settings.`
					: `Model service '${document.recipe.modelServiceId}' is unavailable or needs a key.`,
				blockedAction.kind,
				blockedAction.label
			);
		}
	}

	if (options.graphProblem) {
		return state('Needs input', false, options.graphProblem, blockedAction.kind, blockedAction.label);
	}
	if (options.verificationPending) {
		return state('Waiting', false, 'Checking direct inputs before this Draft can generate.', 'wait', 'Checking');
	}

	const inputProblem = getBaseHalfNodeInputReadinessProblem(recipe, document.recipe.inputBindings, options.inputKinds, options.directSourcePaths);
	if (inputProblem) {
		return state(
			'Needs input',
			false,
			inputProblem,
			isFrozen ? 'wait' : 'configure',
			isFrozen ? 'Retry unavailable' : inputProblem.startsWith('Assign connected context ') ? 'Assign input' : 'Configure'
		);
	}
	const directSourceProblem = getDirectSourceReadinessProblem(
		document.recipe.inputBindings,
		options.directSourcePaths,
		options.directSourceProblems
	);
	if (directSourceProblem) {
		return state('Needs input', false, directSourceProblem, 'wait', isFrozen ? 'Retry unavailable' : 'Generate unavailable');
	}

	if (latest?.status === 'failed') {
		const error = boundedStatus(latest.error);
		return state('Failed', true, `${error ? `Attempt failed: ${error}` : 'The attempt failed.'} Settings are frozen; Retry uses the same recipe and inputs.`, 'retry', 'Retry');
	}
	if (latest?.status === 'cancelled') {
		return state('Cancelled', true, 'The attempt was cancelled. Settings are frozen; Retry uses the same recipe and inputs.', 'retry', 'Retry');
	}
	if (latest?.status === 'interrupted') {
		const error = boundedStatus(latest.error);
		return state('Interrupted', true, `${error ? `The attempt was interrupted: ${error}` : 'The attempt was interrupted.'} Settings are frozen; Retry uses the same recipe and inputs.`, 'retry', 'Retry');
	}

	return state('Ready', true, 'Ready to generate.', 'run', 'Generate');
}

/** Whether a terminal Attempt contains every immutable identity needed for an exact Retry. */
export function baseHalfNodeAttemptHasCompleteRetrySnapshot(attempt: IBaseHalfNodeAttempt): boolean {
	if (attempt.inputs.length !== attempt.recipe.inputBindings.length) {
		return false;
	}
	if (attempt.recipe.modelServiceId === undefined) {
		return attempt.model.source === 'local';
	}
	return attempt.model.source === 'service'
		&& attempt.model.connection === 'resolved'
		&& attempt.model.serviceId === attempt.recipe.modelServiceId.toLowerCase()
		&& attempt.model.modelId === attempt.recipe.modelId;
}

/**
 * Projects the live host-owned execution state into the same compact state
 * shown by a fully rendered card. Keeping this projection independent from the
 * document lets frequent progress updates patch one card without rereading the
 * project or rebuilding the canvas.
 */
export function getBaseHalfNodeLocalExecutionState(execution: IBaseHalfNodeLocalExecutionState): IBaseHalfNodeLocalState {
	if (execution.phase === 'cancelling') {
		return state('Cancelling', false, boundedStatus(execution.message) ?? 'Cancellation requested. Late results will not be accepted.', 'cancel', 'Cancelling…');
	}
	if (execution.phase === 'preparing') {
		return state('Preparing', false, boundedStatus(execution.message) ?? 'Preparing this attempt.', 'cancel', 'Cancel');
	}
	const message = boundedStatus(execution.message);
	if (message || execution.progress !== undefined) {
		const progress = execution.progress === undefined
			? undefined
			: Math.max(0, Math.min(100, Math.round(execution.progress)));
		return state('Generating', false, message ?? `Generating ${progress}%.`, 'cancel', 'Cancel');
	}
	return state('Waiting', false, 'Waiting for the generation provider.', 'cancel', 'Cancel');
}

export function getBaseHalfNodeImportProblem(document: IBaseHalfNodeDocument): string | undefined {
	if (document.result) {
		return 'A sealed Result cannot be replaced. Import into a new empty Draft.';
	}
	if (document.recipe || document.attempts.length > 0) {
		return 'Import requires an empty Draft with no recipe or attempts.';
	}
	return undefined;
}

/**
 * Resting cards carry one concise state label. The actionable explanation is
 * exposed by the primary action and accessibility metadata instead of turning
 * every card in a large canvas into an error paragraph.
 */
export function getBaseHalfNodeCardStatusText(state: Pick<IBaseHalfNodeLocalState, 'status' | 'message'>): string {
	return state.status;
}

export function isBaseHalfNodeCardStatusPositive(state: Pick<IBaseHalfNodeLocalState, 'status'>): boolean {
	return state.status === 'Ready' || state.status === 'Result';
}

export function baseHalfNodeImportActionLabel(kind: IBaseHalfNodeDocument['kind']): string {
	return `Import ${baseHalfNodeImportObjectLabel(kind)}`;
}

export function getBaseHalfNodeModelSelectionProblem(modelServiceId: string | undefined, modelId: string | undefined): string | undefined {
	const value = modelId?.trim();
	if (!value) {
		return undefined;
	}
	if (!modelServiceId) {
		return 'Choose a model service or clear the model ID.';
	}
	if (value.length > 256) {
		return 'Model ID must be 256 characters or fewer.';
	}
	if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]*$/.test(value)) {
		return 'Model ID contains unsupported characters.';
	}
	return undefined;
}

export function createBaseHalfNodeModelSelection(
	modelServiceId: string | undefined,
	modelId: string | undefined
): Pick<IBaseHalfNodeRecipe, 'modelServiceId' | 'modelId'> {
	if (!modelServiceId) {
		return Object.freeze({});
	}
	const normalizedModelId = modelId?.trim();
	return Object.freeze({
		modelServiceId,
		...(normalizedModelId ? { modelId: normalizedModelId } : {})
	});
}

/** Resolves the only installed video generator for an unconfigured Video Draft.
 * Zero or multiple candidates remain unresolved so the composer never guesses. */
export function resolveBaseHalfNodeImplicitVideoRecipe(
	document: Pick<IBaseHalfNodeDocument, 'kind' | 'recipe'>,
	recipes: readonly IBaseHalfCanvasRecipeDescriptor[]
): IBaseHalfCanvasRecipeDescriptor | undefined {
	if (document.kind !== 'video' || document.recipe) {
		return undefined;
	}
	const candidates = recipes.filter(recipe => recipe.modelCapability === 'video'
		&& baseHalfCanvasRecipeMatchesNodeKind(recipe, document.kind));
	return candidates.length === 1 ? candidates[0] : undefined;
}

/** Keeps a temporarily unavailable plugin recipe intact until the user
 * explicitly chooses the no-recipe option. */
export function resolveBaseHalfNodeRecipeDraft(
	document: IBaseHalfNodeDocument,
	selectedRecipeId: string,
	selectedRecipe: IBaseHalfCanvasRecipeDescriptor | undefined,
	parameters: Readonly<Record<string, BaseHalfNodeJsonValue>> | undefined,
	modelServiceId: string | undefined,
	modelId: string | undefined,
	inputBindings: readonly IBaseHalfNodeInputBinding[]
): IBaseHalfNodeRecipe | undefined {
	if (selectedRecipe && parameters) {
		return {
			recipeId: selectedRecipe.id,
			...(selectedRecipe.modelCapability === undefined ? {} : createBaseHalfNodeModelSelection(modelServiceId, modelId)),
			parameters,
			inputBindings
		};
	}
	if (selectedRecipeId && document.recipe?.recipeId.toLowerCase() === selectedRecipeId.toLowerCase()) {
		return document.recipe;
	}
	return undefined;
}

export function getBaseHalfNodeResultArtifactOpenProblem(
	path: string,
	integrity: 'available' | 'missing' | 'changed'
): string | undefined {
	if (integrity === 'available') {
		return undefined;
	}
	if (integrity === 'missing') {
		return `The sealed Result file is missing: '${path}'. Restore the original file or copy the settings into a new Draft.`;
	}
	return `The sealed Result file changed on disk: '${path}'. Restore the original bytes or copy the settings into a new Draft.`;
}

export function getBaseHalfNodeAttemptSummary(attempt: IBaseHalfNodeAttempt, resultLabel?: string): string {
	const result = attempt.error ?? resultLabel ?? attempt.recipe.recipeId;
	const model = attempt.model.source === 'local'
		? 'Local'
		: attempt.model.connection === 'resolved'
			? `${attempt.model.serviceLabel}${attempt.model.modelId ? ` / ${attempt.model.modelId}` : ''}`
			: `${attempt.model.serviceId ?? 'Model service'} unavailable${attempt.model.modelId ? ` / ${attempt.model.modelId}` : ''}`;
	const cost = attempt.cost
		? `${attempt.cost.currency} ${attempt.cost.amount}${attempt.cost.kind === 'estimated' ? ' estimated' : ''}`
		: undefined;
	return [result, model, cost].filter((value): value is string => !!value).join(' · ');
}

export function getBaseHalfNodeAttemptDisclosureLines(
	attempt: IBaseHalfNodeAttempt,
	resultArtifact?: IBaseHalfNodeResultArtifact
): readonly string[] {
	const lines: string[] = [
		`Status: ${attempt.status.charAt(0).toUpperCase()}${attempt.status.slice(1)}`,
		`Attempt: ${attempt.id}`,
		`Recipe: ${attempt.recipe.recipeId}`
	];
	for (const [name, value] of Object.entries(attempt.recipe.parameters).sort(([left], [right]) => left.localeCompare(right))) {
		lines.push(`Parameter ${name}: ${formatNodeAttemptDisclosureValue(value)}`);
	}
	if (attempt.model.source === 'local') {
		lines.push('Model service: Local');
	} else if (attempt.model.connection === 'resolved') {
		lines.push(`Model service: ${attempt.model.serviceLabel} (${attempt.model.serviceId})`);
		if (attempt.model.modelId) {
			lines.push(`Model: ${attempt.model.modelId}`);
		}
		lines.push(`Connection: ${attempt.model.connectionIdentity}`);
	} else {
		lines.push(`Model service: Unavailable${attempt.model.serviceId ? ` (${attempt.model.serviceId})` : ''}`);
		if (attempt.model.modelId) {
			lines.push(`Model: ${attempt.model.modelId}`);
		}
	}
	for (const input of [...attempt.inputs].sort((left, right) => left.order - right.order)) {
		lines.push(`Input ${input.order + 1}: ${input.sourcePath} → ${input.slot} · revision ${input.revision}`);
	}
	if (resultArtifact) {
		lines.push(`Result: ${resultArtifact.path} · ${resultArtifact.kind} · ${resultArtifact.size} bytes · SHA-256 ${resultArtifact.sha256}`);
	}
	lines.push(`Created: ${attempt.createdAt}`);
	if (attempt.startedAt) {
		lines.push(`Started: ${attempt.startedAt}`);
	}
	if (attempt.completedAt) {
		lines.push(`Completed: ${attempt.completedAt}`);
	}
	if (attempt.error) {
		lines.push(`Error: ${attempt.error}`);
	}
	if (attempt.providerRequestId) {
		lines.push(`Request: ${attempt.providerRequestId}`);
	}
	if (attempt.usage) {
		const usage = Object.entries(attempt.usage)
			.filter((entry): entry is [string, number] => typeof entry[1] === 'number')
			.map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${value}`)
			.join(', ');
		if (usage) {
			lines.push(`Usage: ${usage}`);
		}
	}
	if (attempt.cost) {
		lines.push(`Cost: ${attempt.cost.currency} ${attempt.cost.amount}${attempt.cost.kind === 'estimated' ? ' (estimated)' : ''}`);
	}
	return Object.freeze(lines);
}

function formatNodeAttemptDisclosureValue(value: BaseHalfNodeJsonValue, depth = 0): string {
	if (value === null) {
		return 'None';
	}
	if (typeof value === 'boolean') {
		return value ? 'Yes' : 'No';
	}
	if (typeof value === 'number') {
		return String(value);
	}
	if (typeof value === 'string') {
		const compact = value.replace(/\s+/g, ' ').trim();
		const bounded = compact.length > 500 ? `${compact.slice(0, 497)}…` : compact;
		return `“${bounded}”`;
	}
	if (depth >= 2) {
		return Array.isArray(value) ? `${value.length} values` : `${Object.keys(value).length} fields`;
	}
	if (Array.isArray(value)) {
		const shown = value.slice(0, 8).map(entry => formatNodeAttemptDisclosureValue(entry, depth + 1));
		return `${value.length} values: ${shown.join('; ')}${value.length > shown.length ? '; …' : ''}`;
	}
	const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
	const shown = entries.slice(0, 8).map(([name, entry]) => `${name} = ${formatNodeAttemptDisclosureValue(entry, depth + 1)}`);
	return `${entries.length} fields: ${shown.join('; ')}${entries.length > shown.length ? '; …' : ''}`;
}

export function baseHalfNodeCanImportContentKind(
	nodeKind: IBaseHalfNodeDocument['kind'],
	contentKind: BaseHalfCanvasContentKind
): boolean {
	return nodeKind === 'file' ? contentKind !== 'folder' : nodeKind === contentKind;
}

export function baseHalfNodeArtifactUsesTextPreview(kind: BaseHalfNodeArtifactKind, path: string): boolean {
	if (kind !== 'file') {
		return false;
	}
	const contentKind = baseHalfCanvasContentKindForPath(path, false);
	return contentKind === 'text' || contentKind === 'code';
}

export function decodeBaseHalfNodeTextPreview(contents: VSBuffer): string | undefined {
	try {
		const raw = new TextDecoder('utf-8', { fatal: true }).decode(contents.buffer);
		return raw.includes('\u0000') ? undefined : raw;
	} catch {
		return undefined;
	}
}

export function baseHalfNodeImportObjectLabel(kind: IBaseHalfNodeDocument['kind']): string {
	switch (kind) {
		case 'image': return 'image';
		case 'video': return 'video';
		case 'audio': return 'audio';
		case 'pdf': return 'PDF';
		case 'presentation': return 'presentation';
		case 'file': return 'file';
	}
}

export function createBaseHalfNodeParameterDraft(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	parameters: Readonly<Record<string, BaseHalfNodeJsonValue>>
): BaseHalfNodeParameterDraft {
	const draft: Record<string, BaseHalfNodeParameterDraftValue> = {};
	for (const parameter of recipe.parameters) {
		const value = Object.prototype.hasOwnProperty.call(parameters, parameter.id)
			? parameters[parameter.id]
			: parameter.default;
		switch (parameter.type) {
			case 'boolean':
				draft[parameter.id] = typeof value === 'boolean' ? value : undefined;
				break;
			case 'number':
				draft[parameter.id] = typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
				break;
			case 'string':
			case 'multiline':
			case 'enum':
				draft[parameter.id] = typeof value === 'string' ? value : undefined;
				break;
		}
	}
	return Object.freeze(draft);
}

export function parseBaseHalfNodeParameterDraft(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	draft: BaseHalfNodeParameterDraft
): BaseHalfNodeParameterDraftResult {
	const parameters: Record<string, BaseHalfNodeJsonValue> = {};
	for (const parameter of recipe.parameters) {
		const raw = draft[parameter.id];
		if (raw === undefined) {
			continue;
		}
		let value: BaseHalfNodeJsonValue;
		if (parameter.type === 'number') {
			if (typeof raw !== 'string' || !raw.trim()) {
				continue;
			}
			value = Number(raw);
		} else if (parameter.type === 'boolean') {
			if (typeof raw !== 'boolean') {
				return invalidParameter(parameter.label);
			}
			value = raw;
		} else {
			if (typeof raw !== 'string') {
				return invalidParameter(parameter.label);
			}
			value = raw;
		}
		parameters[parameter.id] = value;
	}
	try {
		return {
			valid: true,
			parameters: resolveBaseHalfCanvasRecipeParameters(recipe, parameters) as Readonly<Record<string, BaseHalfNodeJsonValue>>
		};
	} catch (error) {
		return { valid: false, message: errorMessage(error) };
	}
}

export function getBaseHalfNodeInputRows(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	bindings: readonly IBaseHalfNodeInputBinding[],
	inputKinds?: ReadonlyMap<string, BaseHalfCanvasContentKind>,
	resultIdentities?: ReadonlyMap<string, IBaseHalfNodeInputResultIdentity>
): readonly {
	readonly sourcePath: string;
	readonly slot: string;
	readonly slotLabel: string;
	readonly order: number;
	readonly accepted: boolean;
	readonly resultIdentity?: IBaseHalfNodeInputResultIdentity;
}[] {
	return bindings.map(binding => {
		const slot = recipe.inputs.find(candidate => candidate.id === binding.slot);
		const resultIdentity = resultIdentities?.get(binding.sourcePath);
		return Object.freeze({
			sourcePath: binding.sourcePath,
			slot: binding.slot,
			slotLabel: slot?.label ?? binding.slot,
			order: binding.order,
			accepted: !!slot && (inputKinds === undefined || (inputKinds.has(binding.sourcePath) && slot.accepts.includes(inputKinds.get(binding.sourcePath)!))),
			...(resultIdentity === undefined ? {} : { resultIdentity })
		});
	}).sort((left, right) => left.order - right.order);
}

export function getBaseHalfNodeInputResultLabel(result: IBaseHalfNodeInputResultIdentity): string {
	const compactId = result.id.length <= 16
		? result.id
		: `${result.id.slice(0, 8)}…${result.id.slice(-4)}`;
	return `${result.source === 'attempt' ? 'Generated' : 'Imported'} Result · ${compactId}`;
}

export function getBaseHalfNodeAvailableInputSlots(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	bindings: readonly IBaseHalfNodeInputBinding[],
	sourcePath: string,
	kind: BaseHalfCanvasContentKind
): ReadonlyArray<IBaseHalfCanvasRecipeDescriptor['inputs'][number]> {
	return Object.freeze(recipe.inputs.filter(input => input.accepts.includes(kind)
		&& !bindings.some(binding => binding.sourcePath === sourcePath)
		&& bindings.filter(binding => binding.slot === input.id).length < input.maxItems));
}

/** Roles that can accept one existing row after subtracting that row from capacity. */
export function getBaseHalfNodeAssignableInputSlots(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	bindings: readonly IBaseHalfNodeInputBinding[],
	sourcePath: string,
	kind: BaseHalfCanvasContentKind
): ReadonlyArray<IBaseHalfCanvasRecipeDescriptor['inputs'][number]> {
	return Object.freeze(recipe.inputs.filter(input => input.accepts.includes(kind)
		&& bindings.filter(binding => binding.sourcePath !== sourcePath && binding.slot === input.id).length < input.maxItems));
}

/** Structural errors cannot be saved; missing minimum inputs remain a valid incomplete draft. */
export function getBaseHalfNodeInputStructureProblem(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	bindings: readonly IBaseHalfNodeInputBinding[],
	inputKinds: ReadonlyMap<string, BaseHalfCanvasContentKind>,
	directSourcePaths: readonly string[]
): string | undefined {
	const direct = new Set(directSourcePaths);
	const seen = new Set<string>();
	for (const binding of bindings) {
		if (seen.has(binding.sourcePath)) {
			return `Direct input '${binding.sourcePath}' is assigned more than once.`;
		}
		seen.add(binding.sourcePath);
		if (!direct.has(binding.sourcePath)) {
			return `Direct input '${binding.sourcePath}' is missing or is no longer connected.`;
		}
		const slot = recipe.inputs.find(input => input.id === binding.slot);
		if (!slot) {
			return `Recipe '${recipe.label}' no longer declares input '${binding.slot}'.`;
		}
		const kind = inputKinds.get(binding.sourcePath);
		if (!kind) {
			return `Direct input '${binding.sourcePath}' is missing or is no longer connected.`;
		}
		if (!slot.accepts.includes(kind)) {
			return `${slot.label} does not accept ${kind} content from '${binding.sourcePath}'.`;
		}
	}
	for (const input of recipe.inputs) {
		const count = bindings.filter(binding => binding.slot === input.id).length;
		if (count > input.maxItems) {
			return `Remove ${count - input.maxItems} direct ${input.label} input${count - input.maxItems === 1 ? '' : 's'}.`;
		}
	}
	return undefined;
}

export type BaseHalfNodeConnectionSlotDecision =
	| { readonly kind: 'reject' }
	| { readonly kind: 'cancel' }
	| { readonly kind: 'bind'; readonly slot: IBaseHalfCanvasRecipeDescriptor['inputs'][number] };

/** Resolves an input role before any graph or node mutation begins. */
export async function chooseBaseHalfNodeConnectionSlot(
	candidates: ReadonlyArray<IBaseHalfCanvasRecipeDescriptor['inputs'][number]>,
	choose: (choices: ReadonlyArray<IBaseHalfCanvasRecipeDescriptor['inputs'][number]>) => Promise<IBaseHalfCanvasRecipeDescriptor['inputs'][number] | undefined>
): Promise<BaseHalfNodeConnectionSlotDecision> {
	if (candidates.length === 0) {
		return { kind: 'reject' };
	}
	if (candidates.length === 1) {
		return { kind: 'bind', slot: candidates[0] };
	}
	const selected = await choose(candidates);
	return selected ? { kind: 'bind', slot: selected } : { kind: 'cancel' };
}

export function moveBaseHalfNodeInputBinding(
	bindings: readonly IBaseHalfNodeInputBinding[],
	sourcePath: string,
	direction: -1 | 1
): readonly IBaseHalfNodeInputBinding[] {
	const ordered = bindings.slice().sort((left, right) => left.order - right.order);
	const currentIndex = ordered.findIndex(binding => binding.sourcePath === sourcePath);
	if (currentIndex < 0) {
		return Object.freeze(ordered.map(binding => Object.freeze({ ...binding })));
	}
	const current = ordered[currentIndex];
	const sameSlot = ordered.filter(binding => binding.slot === current.slot);
	const slotIndex = sameSlot.findIndex(binding => binding.sourcePath === sourcePath);
	const neighbor = sameSlot[slotIndex + direction];
	if (!neighbor) {
		return Object.freeze(ordered.map(binding => Object.freeze({ ...binding })));
	}
	const next = ordered.map(binding => binding.sourcePath === current.sourcePath
		? { ...binding, order: neighbor.order }
		: binding.sourcePath === neighbor.sourcePath
			? { ...binding, order: current.order }
			: { ...binding });
	return Object.freeze(next.sort((left, right) => left.order - right.order)
		.map((binding, order) => Object.freeze({ ...binding, order })));
}

type BaseHalfNodeLocalRecipeConfiguration = Pick<
	IBaseHalfNodeLocalConfigurationDraft,
	'recipeId' | 'parameters' | 'modelServiceId' | 'modelId' | 'inputBindings'
>;

function recipeConfiguration(draft: IBaseHalfNodeLocalConfigurationDraft): BaseHalfNodeLocalRecipeConfiguration {
	return {
		recipeId: draft.recipeId,
		parameters: draft.parameters,
		modelServiceId: draft.modelServiceId,
		modelId: draft.modelId,
		inputBindings: draft.inputBindings
	};
}

function sameRecipeConfiguration(left: BaseHalfNodeLocalRecipeConfiguration, right: BaseHalfNodeLocalRecipeConfiguration): boolean {
	return left.recipeId === right.recipeId
		&& sameParameterDraft(left.parameters, right.parameters)
		&& left.modelServiceId === right.modelServiceId
		&& left.modelId === right.modelId
		&& sameInputBindings(left.inputBindings, right.inputBindings);
}

function sameParameterDraft(left: BaseHalfNodeParameterDraft, right: BaseHalfNodeParameterDraft): boolean {
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	return leftKeys.length === rightKeys.length
		&& leftKeys.every((key, index) => key === rightKeys[index] && objectsEqual(left[key], right[key]));
}

function sameInputBindings(left: readonly IBaseHalfNodeInputBinding[], right: readonly IBaseHalfNodeInputBinding[]): boolean {
	return left.length === right.length && left.every((binding, index) => {
		const candidate = right[index];
		return candidate !== undefined
			&& binding.sourcePath === candidate.sourcePath
			&& binding.slot === candidate.slot
			&& binding.order === candidate.order;
	});
}

function mergeConfigurationField<T>(
	base: T,
	local: T,
	external: T,
	label: BaseHalfNodeLocalConfigurationConflict,
	conflicts: BaseHalfNodeLocalConfigurationConflict[],
	equals: (left: T, right: T) => boolean = Object.is
): T {
	const localChanged = !equals(local, base);
	const externalChanged = !equals(external, base);
	if (!localChanged) {
		return external;
	}
	if (externalChanged && !equals(local, external)) {
		conflicts.push(label);
	}
	return local;
}

function getParameterReadinessProblem(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	parameters: Readonly<Record<string, BaseHalfNodeJsonValue>>
): string | undefined {
	try {
		resolveBaseHalfCanvasRecipeParameters(recipe, parameters);
		return undefined;
	} catch (error) {
		return errorMessage(error);
	}
}

export function getBaseHalfNodeInputReadinessProblem(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	bindings: readonly IBaseHalfNodeInputBinding[],
	inputKinds?: ReadonlyMap<string, BaseHalfCanvasContentKind>,
	directSourcePaths?: readonly string[]
): string | undefined {
	if (directSourcePaths && inputKinds) {
		const structuralProblem = getBaseHalfNodeInputStructureProblem(recipe, bindings, inputKinds, directSourcePaths);
		if (structuralProblem) {
			return structuralProblem;
		}
		const assigned = new Set(bindings.map(binding => binding.sourcePath));
		const unassigned = directSourcePaths.find(sourcePath => !assigned.has(sourcePath));
		if (unassigned) {
			return `Assign connected context '${unassigned}' to an input role.`;
		}
	} else {
		const unknown = bindings.find(binding => !recipe.inputs.some(input => input.id === binding.slot));
		if (unknown) {
			return `Recipe '${recipe.label}' no longer declares input '${unknown.slot}'.`;
		}
		if (inputKinds) {
			for (const binding of bindings) {
				const kind = inputKinds.get(binding.sourcePath);
				if (!kind) {
					return `Direct input '${binding.sourcePath}' is missing or is no longer connected.`;
				}
				const slot = recipe.inputs.find(input => input.id === binding.slot)!;
				if (!slot.accepts.includes(kind)) {
					return `${slot.label} does not accept ${kind} content from '${binding.sourcePath}'.`;
				}
			}
		}
	}
	for (const input of recipe.inputs) {
		const count = bindings.filter(binding => binding.slot === input.id).length;
		if (count < input.minItems) {
			const missing = input.minItems - count;
			return `Add ${missing} direct ${input.label} input${missing === 1 ? '' : 's'}.`;
		}
		if ((!directSourcePaths || !inputKinds) && count > input.maxItems) {
			return `Remove ${count - input.maxItems} direct ${input.label} input${count - input.maxItems === 1 ? '' : 's'}.`;
		}
	}
	return undefined;
}

function getDirectSourceReadinessProblem(
	bindings: readonly IBaseHalfNodeInputBinding[],
	directSourcePaths?: readonly string[],
	problems?: ReadonlyMap<string, string>
): string | undefined {
	if (!problems?.size) {
		return undefined;
	}
	const orderedPaths = [
		...bindings.slice().sort((left, right) => left.order - right.order).map(binding => binding.sourcePath),
		...(directSourcePaths ?? [])
	];
	const visited = new Set<string>();
	for (const path of orderedPaths) {
		if (visited.has(path)) {
			continue;
		}
		visited.add(path);
		const problem = problems.get(path)?.trim();
		if (problem) {
			return problem;
		}
	}
	return undefined;
}

function state(
	status: BaseHalfNodeLocalStatus,
	ready: boolean,
	message: string,
	kind: BaseHalfNodeLocalPrimaryActionKind,
	label: string
): IBaseHalfNodeLocalState {
	return Object.freeze({ ready, status, message, action: Object.freeze({ kind, label }) });
}

function invalidParameter(label: string): BaseHalfNodeParameterDraftResult {
	return { valid: false, message: `Fix '${label}' before saving.` };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function boundedStatus(value: string | undefined): string | undefined {
	const message = value?.trim();
	if (!message) {
		return undefined;
	}
	return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}
