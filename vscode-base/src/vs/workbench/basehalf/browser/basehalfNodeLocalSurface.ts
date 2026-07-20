/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isHTMLElement } from '../../../base/browser/dom.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { AnchorAlignment, AnchorAxisAlignment, AnchorPosition } from '../../../base/common/layout.js';
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
	BASEHALF_NODE_MAX_REVISIONS,
	BASEHALF_NODE_MAX_RUNS,
	IBaseHalfNodeDocument,
	IBaseHalfNodeInputBinding,
	IBaseHalfNodeRecipe,
	IBaseHalfNodeRun
} from '../common/basehalfNodeDocument.js';

export type BaseHalfNodeLocalPrimaryActionKind =
	| 'add'
	| 'import'
	| 'configure'
	| 'run'
	| 'runAgain'
	| 'retry'
	| 'cancel'
	| 'recover'
	| 'wait'
	| 'locate';

export interface IBaseHalfNodeLocalExecutionState {
	readonly phase: 'preparing' | 'running' | 'cancelling';
	readonly message?: string;
}

export interface IBaseHalfNodeLocalPrimaryAction {
	readonly kind: BaseHalfNodeLocalPrimaryActionKind;
	readonly label: string;
}

export function baseHalfNodeLocalPrimaryActionOpensSurface(action: IBaseHalfNodeLocalPrimaryAction): boolean {
	return action.kind === 'add' || action.kind === 'configure';
}

export type BaseHalfNodeLocalStatus =
	| 'Empty'
	| 'Needs input'
	| 'Ready'
	| 'Running'
	| 'Cancelling'
	| 'Current'
	| 'Stale'
	| 'Failed'
	| 'Cancelled'
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

export type BaseHalfNodeParameterDraftValue = string | boolean | undefined;
export type BaseHalfNodeParameterDraft = Readonly<Record<string, BaseHalfNodeParameterDraftValue>>;

export interface IBaseHalfNodeLocalConfigurationDraft {
	readonly title: string;
	readonly role: string;
	readonly recipeId: string;
	readonly parameters: BaseHalfNodeParameterDraft;
	readonly modelServiceId?: string;
	readonly modelId?: string;
	readonly inputBindings: readonly IBaseHalfNodeInputBinding[];
}

export type BaseHalfNodeLocalConfigurationConflict =
	| 'Title'
	| 'Role'
	| 'Recipe'
	| 'Parameters'
	| 'Model service'
	| 'Model ID'
	| 'Direct inputs';

export interface IBaseHalfNodeLocalConfigurationMerge {
	readonly draft: IBaseHalfNodeLocalConfigurationDraft;
	readonly conflicts: readonly BaseHalfNodeLocalConfigurationConflict[];
}

export interface IBaseHalfNodeInputCurrentVersion {
	readonly source: 'run' | 'imported';
	readonly id: string;
}

export interface IBaseHalfNodeLocalSurfacePlacement {
	readonly side: 'right' | 'left' | 'below' | 'above';
	readonly anchorAlignment: AnchorAlignment;
	readonly anchorAxisAlignment: AnchorAxisAlignment;
	readonly anchorPosition: AnchorPosition;
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
	margin = 16
): IBaseHalfNodeLocalSurfacePlacement {
	const usable = {
		right: Math.max(0, viewport.width - anchor.right - margin) / Math.max(1, surface.width),
		left: Math.max(0, anchor.left - margin) / Math.max(1, surface.width),
		below: Math.max(0, viewport.height - anchor.bottom - margin) / Math.max(1, surface.height),
		above: Math.max(0, anchor.top - margin) / Math.max(1, surface.height)
	};
	const side = (Object.entries(usable) as Array<[IBaseHalfNodeLocalSurfacePlacement['side'], number]>)
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
	readonly modelServices?: readonly IBaseHalfModelServiceDescriptor[];
	readonly execution?: IBaseHalfNodeLocalExecutionState;
	readonly currentOutputIntegrity?: 'missing' | 'changed';
	readonly dirty?: boolean;
	readonly graphProblem?: string;
	readonly directSourcePaths?: readonly string[];
	/** Actionable Current/integrity failures keyed by direct result-node path. */
	readonly directSourceProblems?: ReadonlyMap<string, string>;
	readonly staleReason?: 'recipe' | 'inputs';
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
	if (options.verificationPending && document.current.source !== 'empty') {
		return state('Needs input', false, 'Checking Current before this node can be used.', 'wait', 'Checking');
	}

	if (!document.recipe) {
		if (document.current.source !== 'empty') {
			if (options.currentOutputIntegrity === 'missing' || options.currentOutputIntegrity === 'changed') {
				const importProblem = getBaseHalfNodeImportHistoryProblem(document);
				if (importProblem) {
					return state('Needs input', false, importProblem, 'wait', 'History full');
				}
				return state(
					options.currentOutputIntegrity === 'missing' ? 'Output missing' : 'Output changed',
					true,
					`The selected ${baseHalfNodeImportObjectLabel(document.kind)} is ${options.currentOutputIntegrity}. Replace it to select a new Current; History keeps the original record.`,
					'import',
					baseHalfNodeImportActionLabel(document.kind, true)
				);
			}
			return state('Current', true, `Current ${baseHalfNodeImportObjectLabel(document.kind)} is available. Add or change content, or choose a recipe.`, 'add', 'Set up');
		}
		const importProblem = getBaseHalfNodeImportHistoryProblem(document);
		if (importProblem) {
			return state('Needs input', false, importProblem, 'wait', 'History full');
		}
		return state(
			'Empty',
			true,
			options.matchingRecipeCount === 0
				? `Add existing ${baseHalfNodeImportObjectLabel(document.kind)} content. A recipe can be installed later.`
				: `Add existing ${baseHalfNodeImportObjectLabel(document.kind)} content or choose a recipe.`,
			'add',
			'Add content'
		);
	}

	const recipe = options.recipe;
	if (!recipe || recipe.id !== document.recipe.recipeId.toLowerCase()) {
		if (document.current.source !== 'empty' && !options.currentOutputIntegrity) {
			return state('Current', true, `Current ${baseHalfNodeImportObjectLabel(document.kind)} remains available. Recipe '${document.recipe.recipeId}' is not installed, so choose an available recipe to run again.`, 'configure', 'Configure');
		}
		return state('Needs input', false, `Recipe '${document.recipe.recipeId}' is not installed. Choose an available recipe.`, 'configure', 'Configure');
	}
	if (!baseHalfCanvasRecipeMatchesNodeKind(recipe, document.kind)) {
		if (document.current.source !== 'empty' && !options.currentOutputIntegrity) {
			return state('Current', true, `Current ${baseHalfNodeImportObjectLabel(document.kind)} remains available. Recipe '${recipe.label}' no longer matches this node, so choose a matching recipe to run again.`, 'configure', 'Configure');
		}
		return state('Needs input', false, `Recipe '${recipe.label}' does not produce ${document.kind} content. Choose a matching recipe.`, 'configure', 'Configure');
	}

	const nextAction = restingRunAction(document);
	const latest = document.runs.at(-1);
	if (latest?.status === 'running') {
		return state(
			'Running',
			false,
			'This saved run needs a status check. If another window is still working, nothing changes; an abandoned run can be marked interrupted.',
			'recover',
			'Check status'
		);
	}
	if (document.runs.length >= BASEHALF_NODE_MAX_RUNS) {
		return state('Needs input', false, `History has reached ${BASEHALF_NODE_MAX_RUNS} runs. Duplicate this node to begin a new history; this node and all local outputs stay unchanged.`, 'wait', 'History full');
	}
	if (options.dirty) {
		return state('Needs input', false, 'Save this node before running it.', nextAction.kind, nextAction.label);
	}

	const parameterProblem = getParameterReadinessProblem(recipe, document.recipe.parameters);
	if (parameterProblem) {
		return state('Needs input', false, parameterProblem, 'configure', 'Configure');
	}

	if (recipe.modelCapability) {
		const modelCapability = recipe.modelCapability;
		const configured = (options.modelServices ?? [])
			.filter(service => service.configured && service.capabilities.includes(modelCapability));
		if (!document.recipe.modelServiceId) {
			return state('Provider missing', false, configured.length > 0
				? `Choose a configured ${modelCapability} model service.`
				: `Add a configured ${modelCapability} model service in Settings.`, 'configure', 'Configure');
		}
		const modelServiceId = document.recipe.modelServiceId.toLowerCase();
		if (!configured.some(service => service.id === modelServiceId)) {
			return state('Provider missing', false, `Model service '${document.recipe.modelServiceId}' is unavailable or needs a key.`, 'configure', 'Configure');
		}
	}

	if (options.graphProblem) {
		return state('Needs input', false, options.graphProblem, 'configure', 'Configure');
	}
	if (options.verificationPending) {
		return state('Needs input', false, 'Checking Current and direct inputs before this node can run.', 'wait', 'Checking');
	}

	const inputProblem = getInputReadinessProblem(recipe, document.recipe.inputBindings, options.inputKinds, options.directSourcePaths);
	if (inputProblem) {
		return state(
			'Needs input',
			false,
			inputProblem,
			'configure',
			inputProblem.startsWith('Assign connected context ') ? 'Assign input' : 'Configure'
		);
	}
	const directSourceProblem = getDirectSourceReadinessProblem(
		document.recipe.inputBindings,
		options.directSourcePaths,
		options.directSourceProblems
	);
	if (directSourceProblem) {
		return state('Needs input', false, directSourceProblem, 'wait', 'Run unavailable');
	}

	const previousCurrentProblem = options.currentOutputIntegrity === 'missing'
		? ' The previous Current output is missing.'
		: options.currentOutputIntegrity === 'changed'
			? ' The previous Current output changed outside BaseHalf.'
			: '';
	if (latest?.status === 'failed') {
		const error = boundedStatus(latest.error);
		return state('Failed', true, `${error ? `The last run failed: ${error}` : 'The last run failed.'} Current is unchanged.${previousCurrentProblem}`, 'retry', 'Retry');
	}
	if (latest?.status === 'cancelled') {
		return state('Cancelled', true, `The last run was cancelled. Current is unchanged.${previousCurrentProblem}`, 'run', 'Run');
	}
	if (latest?.status === 'interrupted') {
		return state('Failed', true, `The last run was interrupted. Current is unchanged.${previousCurrentProblem}`, 'retry', 'Retry');
	}

	if (options.currentOutputIntegrity === 'missing') {
		return state('Output missing', true, 'Output missing. Run again to create a new result; History keeps the original record.', 'runAgain', 'Run again');
	}
	if (options.currentOutputIntegrity === 'changed') {
		return state('Output changed', true, 'Output changed outside BaseHalf. Run again to create a verified result.', 'runAgain', 'Run again');
	}
	if (options.staleReason === 'recipe') {
		return state('Stale', true, 'Recipe changed since Current was created. Run again to update it.', 'runAgain', 'Run again');
	}
	if (options.staleReason === 'inputs') {
		return state('Stale', true, 'Direct inputs changed since Current was created. Run again to update it.', 'runAgain', 'Run again');
	}

	if (document.current.source === 'run' || document.runs.some(run => run.status === 'succeeded')) {
		return state('Current', true, 'Ready to create another result.', 'runAgain', 'Run again');
	}
	return state('Ready', true, 'Ready to run.', 'run', 'Run');
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
	const message = execution.phase === 'preparing'
		? 'Preparing this run.'
		: boundedStatus(execution.message) ?? 'Running this node.';
	return state('Running', false, message, 'cancel', 'Cancel');
}

export function getBaseHalfNodeImportHistoryProblem(document: IBaseHalfNodeDocument): string | undefined {
	return document.revisions.length >= BASEHALF_NODE_MAX_REVISIONS
		? `Imported History has reached ${BASEHALF_NODE_MAX_REVISIONS} versions. Duplicate this node to begin a new history; this node and all local files stay unchanged.`
		: undefined;
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
	return state.status === 'Ready' || state.status === 'Current';
}

export function baseHalfNodeImportActionLabel(kind: IBaseHalfNodeDocument['kind'], replacing = false): string {
	return `${replacing ? 'Replace' : 'Import'} ${baseHalfNodeImportObjectLabel(kind)}`;
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
			...createBaseHalfNodeModelSelection(modelServiceId, modelId),
			parameters,
			inputBindings
		};
	}
	if (selectedRecipeId && document.recipe?.recipeId.toLowerCase() === selectedRecipeId.toLowerCase()) {
		return document.recipe;
	}
	return undefined;
}

export function getBaseHalfNodeHistoricalArtifactOpenProblem(
	path: string,
	integrity: 'available' | 'missing' | 'changed',
	origin: 'current' | 'history' = 'history'
): string | undefined {
	if (integrity === 'available') {
		return undefined;
	}
	if (integrity === 'missing') {
		return origin === 'current'
			? `Current is missing: '${path}'. Choose a verified version in History or run the node again.`
			: `This historical output is missing: '${path}'. Choose another version in History or run the node again.`;
	}
	return origin === 'current'
		? `Current changed on disk: '${path}'. Choose a verified version in History or run the node again.`
		: `This historical output changed on disk: '${path}'. Choose another version in History or run the node again.`;
}

export function getBaseHalfNodeRunHistoryDetail(run: IBaseHalfNodeRun, primaryLabel?: string): string {
	const result = run.error ?? primaryLabel ?? run.recipe.recipeId;
	const model = run.model.source === 'local'
		? 'Local'
		: run.model.connection === 'resolved'
			? `${run.model.serviceLabel}${run.model.modelId ? ` / ${run.model.modelId}` : ''}`
			: `${run.model.serviceId ?? 'Model service'} unavailable${run.model.modelId ? ` / ${run.model.modelId}` : ''}`;
	const cost = run.cost
		? `${run.cost.currency} ${run.cost.amount}${run.cost.kind === 'estimated' ? ' estimated' : ''}`
		: undefined;
	return [result, model, cost].filter((value): value is string => !!value).join(' · ');
}

export function getBaseHalfNodeRunDisclosureLines(run: IBaseHalfNodeRun): readonly string[] {
	const lines: string[] = [
		`Status: ${run.status.charAt(0).toUpperCase()}${run.status.slice(1)}`,
		`Run: ${run.id}`,
		`Recipe: ${run.recipe.recipeId}`
	];
	for (const [name, value] of Object.entries(run.recipe.parameters).sort(([left], [right]) => left.localeCompare(right))) {
		lines.push(`Parameter ${name}: ${formatNodeRunDisclosureValue(value)}`);
	}
	if (run.model.source === 'local') {
		lines.push('Model service: Local');
	} else if (run.model.connection === 'resolved') {
		lines.push(`Model service: ${run.model.serviceLabel} (${run.model.serviceId})`);
		if (run.model.modelId) {
			lines.push(`Model: ${run.model.modelId}`);
		}
		lines.push(`Connection: ${run.model.connectionIdentity}`);
	} else {
		lines.push(`Model service: Unavailable${run.model.serviceId ? ` (${run.model.serviceId})` : ''}`);
		if (run.model.modelId) {
			lines.push(`Model: ${run.model.modelId}`);
		}
	}
	for (const input of [...run.inputs].sort((left, right) => left.order - right.order)) {
		lines.push(`Input ${input.order + 1}: ${input.sourcePath} → ${input.slot} · revision ${input.revision}`);
	}
	for (const [index, artifact] of run.artifacts.entries()) {
		const primary = artifact.id === run.primaryArtifactId ? ' · Current candidate' : '';
		lines.push(`Output ${index + 1}: ${artifact.path} · ${artifact.kind} · ${artifact.size} bytes · SHA-256 ${artifact.sha256}${primary}`);
	}
	lines.push(`Created: ${run.createdAt}`);
	if (run.startedAt) {
		lines.push(`Started: ${run.startedAt}`);
	}
	if (run.completedAt) {
		lines.push(`Completed: ${run.completedAt}`);
	}
	if (run.error) {
		lines.push(`Error: ${run.error}`);
	}
	if (run.providerRequestId) {
		lines.push(`Request: ${run.providerRequestId}`);
	}
	if (run.usage) {
		const usage = Object.entries(run.usage)
			.filter((entry): entry is [string, number] => typeof entry[1] === 'number')
			.map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${value}`)
			.join(', ');
		if (usage) {
			lines.push(`Usage: ${usage}`);
		}
	}
	if (run.cost) {
		lines.push(`Cost: ${run.cost.currency} ${run.cost.amount}${run.cost.kind === 'estimated' ? ' (estimated)' : ''}`);
	}
	return Object.freeze(lines);
}

function formatNodeRunDisclosureValue(value: BaseHalfNodeJsonValue, depth = 0): string {
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
		const shown = value.slice(0, 8).map(entry => formatNodeRunDisclosureValue(entry, depth + 1));
		return `${value.length} values: ${shown.join('; ')}${value.length > shown.length ? '; …' : ''}`;
	}
	const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
	const shown = entries.slice(0, 8).map(([name, entry]) => `${name} = ${formatNodeRunDisclosureValue(entry, depth + 1)}`);
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
	currentVersions?: ReadonlyMap<string, IBaseHalfNodeInputCurrentVersion>
): readonly {
	readonly sourcePath: string;
	readonly slot: string;
	readonly slotLabel: string;
	readonly order: number;
	readonly accepted: boolean;
	readonly currentVersion?: IBaseHalfNodeInputCurrentVersion;
}[] {
	return bindings.map(binding => {
		const slot = recipe.inputs.find(candidate => candidate.id === binding.slot);
		const currentVersion = currentVersions?.get(binding.sourcePath);
		return Object.freeze({
			sourcePath: binding.sourcePath,
			slot: binding.slot,
			slotLabel: slot?.label ?? binding.slot,
			order: binding.order,
			accepted: !!slot && (inputKinds === undefined || (inputKinds.has(binding.sourcePath) && slot.accepts.includes(inputKinds.get(binding.sourcePath)!))),
			...(currentVersion === undefined ? {} : { currentVersion })
		});
	}).sort((left, right) => left.order - right.order);
}

export function getBaseHalfNodeInputCurrentVersionLabel(version: IBaseHalfNodeInputCurrentVersion): string {
	const compactId = version.id.length <= 16
		? version.id
		: `${version.id.slice(0, 8)}…${version.id.slice(-4)}`;
	return `Current ${version.source === 'run' ? 'run' : 'import'} · ${compactId}`;
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
		&& leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
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

function getInputReadinessProblem(
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

function restingRunAction(document: IBaseHalfNodeDocument): IBaseHalfNodeLocalPrimaryAction {
	const latest = document.runs.at(-1);
	if (latest?.status === 'failed' || latest?.status === 'interrupted') {
		return Object.freeze({ kind: 'retry', label: 'Retry' });
	}
	if (document.current.source === 'run' || document.runs.some(run => run.status === 'succeeded')) {
		return Object.freeze({ kind: 'runAgain', label: 'Run again' });
	}
	return Object.freeze({ kind: 'run', label: 'Run' });
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
