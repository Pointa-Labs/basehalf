/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider-neutral Video Draft input presentation and mutation planning.
 *
 * The selected reviewed capability determines active roles. This module never
 * selects a model or method from attached inputs, and mutation plans describe
 * host-owned graph/document work without performing I/O themselves.
 */

import type { BaseHalfCanvasContentKind, IBaseHalfCanvasRecipeInputDefinition } from './basehalfCanvasRecipes.js';
import { baseHalfProjectPathKey, baseHalfProjectPathProblem } from './basehalfNodeDocument.js';
import type { IBaseHalfNodeDocument, IBaseHalfNodeInputBinding } from './basehalfNodeDocument.js';
import type {
	BaseHalfVideoGenerationMode,
	BaseHalfVideoInputKind,
	IBaseHalfVideoInputEvaluation,
	IBaseHalfVideoModeCapability
} from './basehalfVideoModels.js';

export const BASEHALF_VIDEO_FRAME_ROLES = ['first-frame', 'last-frame'] as const;

export type BaseHalfVideoFrameRole = typeof BASEHALF_VIDEO_FRAME_ROLES[number];

export type BaseHalfVideoInputBindingStatus =
	| 'active'
	| 'unused'
	| 'incompatible'
	| 'over-capacity'
	| 'source-missing'
	| 'source-changed'
	| 'source-unverified';

export type BaseHalfVideoInputPresentationProblemKind =
	| 'missing-start-frame'
	| 'missing-end-frame'
	| 'too-few'
	| 'too-many'
	| 'unsupported-input'
	| 'unused-role'
	| 'incompatible-role'
	| 'over-capacity'
	| 'source-missing'
	| 'source-changed'
	| 'source-unverified';

export type BaseHalfVideoInputAction =
	| 'pick'
	| 'replace'
	| 'remove'
	| 'swap'
	| 'change-role'
	| 'change-method'
	| 'inspect-source'
	| 'move-earlier'
	| 'move-later';

export type BaseHalfVideoInputSourceIntegrity = 'available' | 'missing' | 'changed' | 'unverified';
export type BaseHalfVideoDirectEdgeState = 'absent' | 'present' | 'inconsistent';

export interface IBaseHalfVideoInputSourceState {
	readonly sourcePath: string;
	readonly sourceId?: string;
	readonly title: string;
	readonly kind?: BaseHalfCanvasContentKind;
	readonly saved: boolean;
	readonly integrity: BaseHalfVideoInputSourceIntegrity;
	readonly revision?: string;
}

export interface IBaseHalfVideoInputPresentationProblem {
	readonly kind: BaseHalfVideoInputPresentationProblemKind;
	readonly input?: BaseHalfVideoInputKind;
	readonly sourcePath?: string;
	readonly actualCount?: number;
	readonly minimum?: number;
	readonly maximum?: number;
}

export interface IBaseHalfVideoInputBindingPresentation {
	readonly binding: IBaseHalfNodeInputBinding;
	readonly source?: IBaseHalfVideoInputSourceState;
	readonly status: BaseHalfVideoInputBindingStatus;
	readonly blocking: boolean;
	readonly problem?: IBaseHalfVideoInputPresentationProblem;
	readonly actions: readonly BaseHalfVideoInputAction[];
	readonly assignableRoles: readonly BaseHalfVideoInputKind[];
}

export interface IBaseHalfVideoFrameSlotPresentation {
	readonly role: BaseHalfVideoFrameRole;
	readonly labelKey: 'start' | 'end';
	readonly required: true;
	readonly binding?: IBaseHalfNodeInputBinding;
	readonly source?: IBaseHalfVideoInputSourceState;
	readonly problem?: IBaseHalfVideoInputPresentationProblem;
	readonly actions: readonly Extract<BaseHalfVideoInputAction, 'pick' | 'replace' | 'remove'>[];
}

export interface IBaseHalfVideoInputsPresentation {
	readonly mode: BaseHalfVideoGenerationMode;
	readonly frameSlots: readonly IBaseHalfVideoFrameSlotPresentation[];
	/** Every durable binding, exactly once and in deterministic order. */
	readonly bindings: readonly IBaseHalfVideoInputBindingPresentation[];
	/** All accepted bindings, including bindings represented by named frame slots. */
	readonly activeBindings: readonly IBaseHalfVideoInputBindingPresentation[];
	/** Accepted non-temporal bindings rendered as ordinary Composer chips. */
	readonly ordinaryChips: readonly IBaseHalfVideoInputBindingPresentation[];
	readonly needsReview: readonly IBaseHalfVideoInputBindingPresentation[];
	readonly canSwapFrames: boolean;
	readonly readinessProblems: readonly IBaseHalfVideoInputPresentationProblem[];
}

export interface IBaseHalfVideoInputsPresentationRequest {
	readonly capability: IBaseHalfVideoModeCapability;
	readonly recipeInputs: readonly IBaseHalfCanvasRecipeInputDefinition[];
	readonly bindings: readonly IBaseHalfNodeInputBinding[];
	readonly sources: readonly IBaseHalfVideoInputSourceState[];
	readonly inputEvaluation: IBaseHalfVideoInputEvaluation;
}

export interface IBaseHalfVideoInputMutationContext {
	readonly capability: IBaseHalfVideoModeCapability;
	readonly recipeInputs: readonly IBaseHalfCanvasRecipeInputDefinition[];
	readonly bindings: readonly IBaseHalfNodeInputBinding[];
	readonly sources: readonly IBaseHalfVideoInputSourceState[];
}

export interface IBaseHalfVideoInputGraphDelta {
	readonly addSourcePaths: readonly string[];
	readonly removeSourcePaths: readonly string[];
}

export type BaseHalfVideoInputMutationOperation = 'pick' | 'replace' | 'remove' | 'swap' | 'change-role' | 'reorder';

export interface IBaseHalfVideoInputMutationPlan {
	readonly operation: BaseHalfVideoInputMutationOperation;
	readonly beforeBindings: readonly IBaseHalfNodeInputBinding[];
	readonly afterBindings: readonly IBaseHalfNodeInputBinding[];
	readonly graph: IBaseHalfVideoInputGraphDelta;
	readonly focusSourcePath?: string;
}

export interface IBaseHalfVideoInputDocumentMutationRequest {
	readonly document: IBaseHalfNodeDocument;
	readonly plan: IBaseHalfVideoInputMutationPlan;
}

export interface IBaseHalfVideoInputPickRequest extends IBaseHalfVideoInputMutationContext {
	readonly sourcePath: string;
	readonly role: BaseHalfVideoInputKind;
	readonly edgeState: BaseHalfVideoDirectEdgeState;
}

export interface IBaseHalfVideoInputReplaceRequest extends IBaseHalfVideoInputMutationContext {
	readonly sourcePath: string;
	readonly replacementSourcePath: string;
	readonly currentEdgeState: BaseHalfVideoDirectEdgeState;
	readonly replacementEdgeState: BaseHalfVideoDirectEdgeState;
}

export interface IBaseHalfVideoInputRemoveRequest extends IBaseHalfVideoInputMutationContext {
	readonly sourcePath: string;
	readonly edgeState: BaseHalfVideoDirectEdgeState;
}

export interface IBaseHalfVideoInputRoleChangeRequest extends IBaseHalfVideoInputMutationContext {
	readonly sourcePath: string;
	readonly role: BaseHalfVideoInputKind;
}

export interface IBaseHalfVideoInputReorderRequest extends IBaseHalfVideoInputMutationContext {
	readonly sourcePath: string;
	readonly direction: -1 | 1;
}

export type BaseHalfVideoInputMutationProblemKind =
	| 'invalid-binding-set'
	| 'invalid-capability'
	| 'source-not-found'
	| 'source-not-saved'
	| 'source-unavailable'
	| 'source-already-bound'
	| 'binding-not-found'
	| 'target-not-editable'
	| 'stale-binding-set'
	| 'role-not-active'
	| 'role-not-recipe-compatible'
	| 'role-full'
	| 'edge-not-absent'
	| 'edge-not-present'
	| 'same-source'
	| 'same-role'
	| 'swap-unavailable'
	| 'move-unavailable';

export class BaseHalfVideoInputMutationError extends Error {
	constructor(
		readonly kind: BaseHalfVideoInputMutationProblemKind,
		message: string
	) {
		super(message);
		this.name = 'BaseHalfVideoInputMutationError';
	}
}

const INPUT_CONTENT_KINDS: Readonly<Partial<Record<BaseHalfVideoInputKind, BaseHalfCanvasContentKind>>> = Object.freeze({
	'first-frame': 'image',
	'last-frame': 'image',
	'reference-image': 'image',
	'reference-video': 'video',
	'source-video': 'video',
	audio: 'audio'
});

/** Derive slots, chips, retained bindings, and stable blockers without mutation. */
export function createBaseHalfVideoInputsPresentation(
	request: IBaseHalfVideoInputsPresentationRequest
): IBaseHalfVideoInputsPresentation {
	validateFrameCapability(request.capability);
	const bindings = copyAndValidateBindings(request.bindings);
	const sourceIndex = createSourceIndex(request.sources);
	const recipeIndex = createRecipeIndex(request.recipeInputs);
	const capabilityIndex = createCapabilityInputIndex(request.capability);
	const activeCounts = new Map<BaseHalfVideoInputKind, number>();

	const rows = bindings.map(binding => {
		const source = sourceIndex.get(baseHalfProjectPathKey(binding.sourcePath));
		const definition = capabilityIndex.get(binding.slot as BaseHalfVideoInputKind);
		const recipeInput = recipeIndex.get(binding.slot);
		let status: BaseHalfVideoInputBindingStatus;
		let problem: IBaseHalfVideoInputPresentationProblem | undefined;

		const integrity = baseHalfVideoInputBindingIntegrity(binding, source);
		if (integrity === 'missing') {
			status = 'source-missing';
			problem = problemForStatus(status, binding.sourcePath, binding.slot);
		} else if (integrity === 'changed') {
			status = 'source-changed';
			problem = problemForStatus(status, binding.sourcePath, binding.slot);
		} else if (integrity === 'unverified') {
			status = 'source-unverified';
			problem = problemForStatus(status, binding.sourcePath, binding.slot);
		} else if (!source || !recipeInput || recipeInput.maxItems === 0 || !source.kind || !recipeInput.accepts.includes(source.kind)) {
			status = 'incompatible';
			problem = problemForStatus(status, binding.sourcePath, binding.slot);
		} else if (!definition || definition.kind === 'text-prompt' || definition.maxItems === 0) {
			status = 'unused';
			problem = problemForStatus(status, binding.sourcePath, binding.slot);
		} else if (!definitionAcceptsContentKind(definition, source.kind)) {
			status = 'incompatible';
			problem = problemForStatus(status, binding.sourcePath, binding.slot);
		} else {
			const activeCount = activeCounts.get(definition.kind) ?? 0;
			const maximum = Math.min(definition.maxItems, recipeInput.maxItems);
			if (activeCount >= maximum) {
				status = 'over-capacity';
				problem = problemForStatus(status, binding.sourcePath, binding.slot, activeCount + 1, definition.minItems, maximum);
			} else {
				status = 'active';
				activeCounts.set(definition.kind, activeCount + 1);
			}
		}

		const assignableRoles = source
			? getAssignableRoles(request.capability, request.recipeInputs, bindings, source, binding.sourcePath, binding.slot)
			: Object.freeze([]) as readonly BaseHalfVideoInputKind[];
		const canReplace = !!definition && definition.kind !== 'text-prompt' && definition.maxItems > 0
			&& !!recipeInput && recipeInput.maxItems > 0;
		return freezeBindingPresentation({
			binding,
			...(source ? { source } : {}),
			status,
			blocking: status !== 'active',
			...(problem ? { problem } : {}),
			actions: actionsForBinding(status, assignableRoles.length > 0, canReplace),
			assignableRoles
		});
	});

	const rowProblems = rows.flatMap(row => row.problem ? [row.problem] : []);
	const mappedEvaluationProblems = request.inputEvaluation.problems
		.map(problem => mapEvaluationProblem(problem))
		.filter(problem => !isMisleadingMissingFrameProblem(problem, bindings));
	const readinessProblems = deduplicateProblems([...rowProblems, ...mappedEvaluationProblems]);
	const frameSlots = createFrameSlots(request.capability, rows, readinessProblems);
	const activeBindings = Object.freeze(rows.filter(row => row.status === 'active'));
	const ordinaryChips = Object.freeze(activeBindings.filter(row => !isFrameRole(row.binding.slot)));
	const needsReview = Object.freeze(rows.filter(row => row.status !== 'active'));

	return Object.freeze({
		mode: request.capability.mode,
		frameSlots,
		bindings: Object.freeze(rows),
		activeBindings,
		ordinaryChips,
		needsReview,
		canSwapFrames: canSwapFrames(request.capability, rows),
		readinessProblems
	});
}

/** Plan canvas pick: one new target binding and one new direct graph pair. */
export function planBaseHalfVideoInputPick(request: IBaseHalfVideoInputPickRequest): IBaseHalfVideoInputMutationPlan {
	const context = validateMutationContext(request);
	if (request.edgeState !== 'absent') {
		throw mutationError('edge-not-absent', `Cannot pick '${request.sourcePath}' because its direct edge is not absent.`);
	}
	const source = requireSource(context.sources, request.sourcePath);
	assertSourceNotBound(context.bindings, source.sourcePath);
	assertEligibleSourceForRole(context, source, request.role);
	const after = normalizeBindingOrder([
		...context.bindings,
		bindingForSource(source, request.role, nextBindingOrder(context.bindings))
	]);
	return freezePlan({
		operation: 'pick',
		beforeBindings: context.bindings,
		afterBindings: after,
		graph: { addSourcePaths: [source.sourcePath], removeSourcePaths: [] },
		focusSourcePath: source.sourcePath
	});
}

/** Plan replacement while preserving the role and display position. */
export function planBaseHalfVideoInputReplace(request: IBaseHalfVideoInputReplaceRequest): IBaseHalfVideoInputMutationPlan {
	const context = validateMutationContext(request);
	if (request.currentEdgeState !== 'present') {
		throw mutationError('edge-not-present', `Cannot replace '${request.sourcePath}' because its direct edge is not present and consistent.`);
	}
	if (request.replacementEdgeState !== 'absent') {
		throw mutationError('edge-not-absent', `Cannot use '${request.replacementSourcePath}' because its direct edge is not absent.`);
	}
	const binding = requireBinding(context.bindings, request.sourcePath);
	const replacement = requireSource(context.sources, request.replacementSourcePath);
	if (baseHalfProjectPathKey(binding.sourcePath) === baseHalfProjectPathKey(replacement.sourcePath)) {
		throw mutationError('same-source', 'Replacement must use a different source path.');
	}
	assertSourceNotBound(context.bindings, replacement.sourcePath, binding.sourcePath);
	assertEligibleSourceForRole(context, replacement, binding.slot as BaseHalfVideoInputKind, binding.sourcePath);
	const after = normalizeBindingOrder(context.bindings.map(candidate => candidate === binding
		? bindingForSource(replacement, binding.slot, binding.order)
		: candidate));
	return freezePlan({
		operation: 'replace',
		beforeBindings: context.bindings,
		afterBindings: after,
		graph: { addSourcePaths: [replacement.sourcePath], removeSourcePaths: [binding.sourcePath] },
		focusSourcePath: replacement.sourcePath
	});
}

/** Plan removal: the corresponding graph pair is part of the same host transaction. */
export function planBaseHalfVideoInputRemove(request: IBaseHalfVideoInputRemoveRequest): IBaseHalfVideoInputMutationPlan {
	const context = validateMutationContext(request);
	const binding = requireBinding(context.bindings, request.sourcePath);
	const after = normalizeBindingOrder(context.bindings.filter(candidate => candidate !== binding));
	return freezePlan({
		operation: 'remove',
		beforeBindings: context.bindings,
		afterBindings: after,
		graph: { addSourcePaths: [], removeSourcePaths: [binding.sourcePath] }
	});
}

/**
 * Applies only the binding portion of a plan to a fresh persisted Draft.
 * Composer-only prompt/model/setting edits must remain outside this snapshot.
 */
export function applyBaseHalfVideoInputMutationToDocument(
	request: IBaseHalfVideoInputDocumentMutationRequest
): IBaseHalfNodeDocument {
	const { document, plan } = request;
	if (document.result || document.attempts.length > 0 || !document.recipe) {
		throw mutationError('target-not-editable', 'Video input mutations require one persisted editable Draft with a Recipe.');
	}
	const currentBindings = copyAndValidateBindings(document.recipe.inputBindings);
	const beforeBindings = copyAndValidateBindings(plan.beforeBindings);
	if (!bindingSetsEqual(currentBindings, beforeBindings)) {
		throw mutationError('stale-binding-set', 'The persisted input bindings changed before this mutation could be applied.');
	}
	const afterBindings = copyAndValidateBindings(plan.afterBindings);
	return Object.freeze({
		...document,
		recipe: Object.freeze({
			...document.recipe,
			inputBindings: afterBindings
		})
	});
}

/** Classifies a binding against one fresh source inspection. */
export function baseHalfVideoInputBindingIntegrity(
	binding: IBaseHalfNodeInputBinding,
	source: IBaseHalfVideoInputSourceState | undefined
): BaseHalfVideoInputSourceIntegrity {
	if (!source || source.integrity === 'missing') {
		return 'missing';
	}
	if (source.integrity === 'changed') {
		return 'changed';
	}
	if (!source.saved || source.integrity === 'unverified') {
		return 'unverified';
	}
	if (binding.sourceId !== undefined) {
		if (source.sourceId === undefined) {
			return 'unverified';
		}
		if (binding.sourceId !== source.sourceId) {
			return 'changed';
		}
	}
	if (binding.sourceRevision === undefined || source.revision === undefined) {
		return 'unverified';
	}
	return binding.sourceRevision === source.revision ? 'available' : 'changed';
}

/** Plan an explicit target-owned role change. Graph state is intentionally unchanged. */
export function planBaseHalfVideoInputRoleChange(request: IBaseHalfVideoInputRoleChangeRequest): IBaseHalfVideoInputMutationPlan {
	const context = validateMutationContext(request);
	const binding = requireBinding(context.bindings, request.sourcePath);
	if (binding.slot === request.role) {
		throw mutationError('same-role', `Input '${binding.sourcePath}' already uses role '${request.role}'.`);
	}
	const source = requireSource(context.sources, binding.sourcePath);
	assertEligibleSourceForRole(context, source, request.role, binding.sourcePath);
	const after = context.bindings.map(candidate => candidate === binding
		? freezeBinding({ ...binding, slot: request.role })
		: candidate);
	return freezePlan({
		operation: 'change-role',
		beforeBindings: context.bindings,
		afterBindings: after,
		graph: { addSourcePaths: [], removeSourcePaths: [] },
		focusSourcePath: binding.sourcePath
	});
}

/** Plan a single atomic exchange of Start and End target-owned roles. */
export function planBaseHalfVideoFrameSwap(context: IBaseHalfVideoInputMutationContext): IBaseHalfVideoInputMutationPlan {
	const validated = validateMutationContext(context);
	const startBindings = validated.bindings.filter(binding => binding.slot === 'first-frame');
	const endBindings = validated.bindings.filter(binding => binding.slot === 'last-frame');
	if (validated.capability.mode !== 'first-last-frame-to-video' || startBindings.length !== 1 || endBindings.length !== 1) {
		throw mutationError('swap-unavailable', 'Swap requires exactly one Start binding and one End binding for Start + End Frames.');
	}
	const startSource = requireSource(validated.sources, startBindings[0].sourcePath);
	const endSource = requireSource(validated.sources, endBindings[0].sourcePath);
	assertEligibleExistingBinding(validated, startBindings[0], startSource);
	assertEligibleExistingBinding(validated, endBindings[0], endSource);
	const after = validated.bindings.map(binding => {
		if (binding === startBindings[0]) {
			return freezeBinding({ ...binding, slot: 'last-frame' });
		}
		if (binding === endBindings[0]) {
			return freezeBinding({ ...binding, slot: 'first-frame' });
		}
		return binding;
	});
	return freezePlan({
		operation: 'swap',
		beforeBindings: validated.bindings,
		afterBindings: after,
		graph: { addSourcePaths: [], removeSourcePaths: [] },
		focusSourcePath: startBindings[0].sourcePath
	});
}

/** Plan keyboard or pointer reordering within one role only. */
export function planBaseHalfVideoInputReorder(request: IBaseHalfVideoInputReorderRequest): IBaseHalfVideoInputMutationPlan {
	const context = validateMutationContext(request);
	const binding = requireBinding(context.bindings, request.sourcePath);
	const ordered = [...context.bindings];
	const roleBindings = ordered.filter(candidate => candidate.slot === binding.slot);
	const roleIndex = roleBindings.indexOf(binding);
	const peer = roleBindings[roleIndex + request.direction];
	if (!peer) {
		throw mutationError('move-unavailable', `Input '${binding.sourcePath}' cannot move further within role '${binding.slot}'.`);
	}
	const bindingIndex = ordered.indexOf(binding);
	const peerIndex = ordered.indexOf(peer);
	[ordered[bindingIndex], ordered[peerIndex]] = [ordered[peerIndex], ordered[bindingIndex]];
	const after = Object.freeze(ordered.map((candidate, order) => freezeBinding({ ...candidate, order })));
	return freezePlan({
		operation: 'reorder',
		beforeBindings: context.bindings,
		afterBindings: after,
		graph: { addSourcePaths: [], removeSourcePaths: [] },
		focusSourcePath: binding.sourcePath
	});
}

function validateMutationContext(context: IBaseHalfVideoInputMutationContext): {
	readonly capability: IBaseHalfVideoModeCapability;
	readonly recipeInputs: readonly IBaseHalfCanvasRecipeInputDefinition[];
	readonly bindings: readonly IBaseHalfNodeInputBinding[];
	readonly sources: ReadonlyMap<string, IBaseHalfVideoInputSourceState>;
} {
	validateFrameCapability(context.capability);
	createCapabilityInputIndex(context.capability);
	createRecipeIndex(context.recipeInputs);
	const bindings = copyAndValidateBindings(context.bindings);
	return Object.freeze({
		capability: context.capability,
		recipeInputs: context.recipeInputs,
		bindings,
		sources: createSourceIndex(context.sources)
	});
}

function validateFrameCapability(capability: IBaseHalfVideoModeCapability): void {
	const first = capability.inputs.find(input => input.kind === 'first-frame');
	const last = capability.inputs.find(input => input.kind === 'last-frame');
	const exactOne = (input: typeof first): boolean => !!input && input.minItems === 1 && input.maxItems === 1;
	let valid: boolean;
	if (capability.mode === 'first-frame-to-video') {
		valid = exactOne(first) && !last;
	} else if (capability.mode === 'first-last-frame-to-video') {
		valid = exactOne(first) && exactOne(last);
	} else {
		valid = !first && !last;
	}
	if (!valid) {
		throw mutationError('invalid-capability', `Generation method '${capability.mode}' has an invalid temporal-frame input contract.`);
	}
}

function createCapabilityInputIndex(capability: IBaseHalfVideoModeCapability): ReadonlyMap<string, IBaseHalfVideoModeCapability['inputs'][number]> {
	const result = new Map<string, IBaseHalfVideoModeCapability['inputs'][number]>();
	for (const input of capability.inputs) {
		if (result.has(input.kind)) {
			throw mutationError('invalid-capability', `Generation method '${capability.mode}' duplicates input '${input.kind}'.`);
		}
		result.set(input.kind, input);
	}
	return result;
}

function createRecipeIndex(inputs: readonly IBaseHalfCanvasRecipeInputDefinition[]): ReadonlyMap<string, IBaseHalfCanvasRecipeInputDefinition> {
	const result = new Map<string, IBaseHalfCanvasRecipeInputDefinition>();
	for (const input of inputs) {
		if (result.has(input.id)) {
			throw mutationError('invalid-capability', `Recipe input role '${input.id}' is duplicated.`);
		}
		result.set(input.id, input);
	}
	return result;
}

function createSourceIndex(sources: readonly IBaseHalfVideoInputSourceState[]): ReadonlyMap<string, IBaseHalfVideoInputSourceState> {
	const result = new Map<string, IBaseHalfVideoInputSourceState>();
	for (const source of sources) {
		const problem = baseHalfProjectPathProblem(source.sourcePath);
		if (problem) {
			throw mutationError('invalid-binding-set', `Source path '${source.sourcePath}' ${problem}`);
		}
		const key = baseHalfProjectPathKey(source.sourcePath);
		if (result.has(key)) {
			throw mutationError('invalid-binding-set', `Source path '${source.sourcePath}' is duplicated.`);
		}
		result.set(key, freezeSource(source));
	}
	return result;
}

function copyAndValidateBindings(bindings: readonly IBaseHalfNodeInputBinding[]): readonly IBaseHalfNodeInputBinding[] {
	const sourcePaths = new Set<string>();
	const orders = new Set<number>();
	const result: IBaseHalfNodeInputBinding[] = [];
	for (const binding of bindings) {
		const problem = baseHalfProjectPathProblem(binding.sourcePath);
		if (problem || !binding.slot || !Number.isInteger(binding.order) || binding.order < 0
			|| binding.sourceId !== undefined && binding.sourceId.length === 0
			|| binding.sourceRevision !== undefined && binding.sourceRevision.length === 0) {
			throw mutationError('invalid-binding-set', `Input binding '${binding.sourcePath}' is invalid.`);
		}
		const pathKey = baseHalfProjectPathKey(binding.sourcePath);
		if (sourcePaths.has(pathKey) || orders.has(binding.order)) {
			throw mutationError('invalid-binding-set', 'Input bindings require unique source paths and order values.');
		}
		sourcePaths.add(pathKey);
		orders.add(binding.order);
		result.push(freezeBinding(binding));
	}
	return Object.freeze(result.sort(compareBindings));
}

function assertEligibleSourceForRole(
	context: ReturnType<typeof validateMutationContext>,
	source: IBaseHalfVideoInputSourceState,
	role: BaseHalfVideoInputKind,
	excludedSourcePath?: string
): void {
	if (!source.saved) {
		throw mutationError('source-not-saved', `Source '${source.sourcePath}' must be saved before it can be bound.`);
	}
	if (source.integrity !== 'available' || !source.kind) {
		throw mutationError('source-unavailable', `Source '${source.sourcePath}' is not available with verified integrity.`);
	}
	if (!source.revision) {
		throw mutationError('source-unavailable', `Source '${source.sourcePath}' has no fresh revision to capture.`);
	}
	const capabilityInput = context.capability.inputs.find(input => input.kind === role && input.kind !== 'text-prompt' && input.maxItems > 0);
	if (!capabilityInput) {
		throw mutationError('role-not-active', `Role '${role}' is not active for generation method '${context.capability.mode}'.`);
	}
	const recipeInput = context.recipeInputs.find(input => input.id === role);
	if (!recipeInput || recipeInput.maxItems === 0 || !recipeInput.accepts.includes(source.kind) || !definitionAcceptsContentKind(capabilityInput, source.kind)) {
		throw mutationError('role-not-recipe-compatible', `Source '${source.sourcePath}' is not compatible with role '${role}'.`);
	}
	const excludedKey = excludedSourcePath ? baseHalfProjectPathKey(excludedSourcePath) : undefined;
	const count = context.bindings.filter(binding => binding.slot === role && baseHalfProjectPathKey(binding.sourcePath) !== excludedKey).length;
	if (count >= Math.min(capabilityInput.maxItems, recipeInput.maxItems)) {
		throw mutationError('role-full', `Role '${role}' has no remaining capacity.`);
	}
}

function assertEligibleExistingBinding(
	context: ReturnType<typeof validateMutationContext>,
	binding: IBaseHalfNodeInputBinding,
	source: IBaseHalfVideoInputSourceState
): void {
	assertEligibleSourceForRole(context, source, binding.slot as BaseHalfVideoInputKind, binding.sourcePath);
}

function assertSourceNotBound(bindings: readonly IBaseHalfNodeInputBinding[], sourcePath: string, excludedSourcePath?: string): void {
	const sourceKey = baseHalfProjectPathKey(sourcePath);
	const excludedKey = excludedSourcePath ? baseHalfProjectPathKey(excludedSourcePath) : undefined;
	if (bindings.some(binding => baseHalfProjectPathKey(binding.sourcePath) === sourceKey
		&& baseHalfProjectPathKey(binding.sourcePath) !== excludedKey)) {
		throw mutationError('source-already-bound', `Source '${sourcePath}' is already bound to this Draft.`);
	}
}

function requireSource(sources: ReadonlyMap<string, IBaseHalfVideoInputSourceState>, sourcePath: string): IBaseHalfVideoInputSourceState {
	const source = sources.get(baseHalfProjectPathKey(sourcePath));
	if (!source) {
		throw mutationError('source-not-found', `Source '${sourcePath}' is not in the inspected source set.`);
	}
	return source;
}

function requireBinding(bindings: readonly IBaseHalfNodeInputBinding[], sourcePath: string): IBaseHalfNodeInputBinding {
	const sourceKey = baseHalfProjectPathKey(sourcePath);
	const binding = bindings.find(candidate => baseHalfProjectPathKey(candidate.sourcePath) === sourceKey);
	if (!binding) {
		throw mutationError('binding-not-found', `Source '${sourcePath}' has no input binding.`);
	}
	return binding;
}

function getAssignableRoles(
	capability: IBaseHalfVideoModeCapability,
	recipeInputs: readonly IBaseHalfCanvasRecipeInputDefinition[],
	bindings: readonly IBaseHalfNodeInputBinding[],
	source: IBaseHalfVideoInputSourceState,
	excludedSourcePath: string,
	currentRole: string
): readonly BaseHalfVideoInputKind[] {
	if (!source.saved || source.integrity !== 'available' || !source.kind) {
		return Object.freeze([]);
	}
	const excludedKey = baseHalfProjectPathKey(excludedSourcePath);
	return Object.freeze(capability.inputs.flatMap(input => {
		if (input.kind === 'text-prompt' || input.kind === currentRole || input.maxItems === 0) {
			return [];
		}
		const recipeInput = recipeInputs.find(candidate => candidate.id === input.kind);
		const used = bindings.filter(binding => binding.slot === input.kind
			&& baseHalfProjectPathKey(binding.sourcePath) !== excludedKey).length;
		return recipeInput
			&& recipeInput.accepts.includes(source.kind!)
			&& definitionAcceptsContentKind(input, source.kind!)
			&& used < Math.min(input.maxItems, recipeInput.maxItems)
			? [input.kind]
			: [];
	}));
}

function createFrameSlots(
	capability: IBaseHalfVideoModeCapability,
	rows: readonly IBaseHalfVideoInputBindingPresentation[],
	problems: readonly IBaseHalfVideoInputPresentationProblem[]
): readonly IBaseHalfVideoFrameSlotPresentation[] {
	const roles = frameRolesForMode(capability.mode);
	return Object.freeze(roles.map(role => {
		const candidates = rows.filter(row => row.binding.slot === role);
		const row = candidates.find(candidate => candidate.status === 'active') ?? candidates[0];
		const problem = row?.problem ?? problems.find(candidate => candidate.input === role);
		return Object.freeze({
			role,
			labelKey: role === 'first-frame' ? 'start' : 'end',
			required: true as const,
			...(row ? { binding: row.binding } : {}),
			...(row?.source ? { source: row.source } : {}),
			...(problem ? { problem } : {}),
			actions: Object.freeze(row ? ['replace', 'remove'] as const : ['pick'] as const)
		});
	}));
}

function frameRolesForMode(mode: BaseHalfVideoGenerationMode): readonly BaseHalfVideoFrameRole[] {
	if (mode === 'first-frame-to-video') {
		return Object.freeze(['first-frame']);
	}
	if (mode === 'first-last-frame-to-video') {
		return BASEHALF_VIDEO_FRAME_ROLES;
	}
	return Object.freeze([]);
}

function canSwapFrames(capability: IBaseHalfVideoModeCapability, rows: readonly IBaseHalfVideoInputBindingPresentation[]): boolean {
	if (capability.mode !== 'first-last-frame-to-video') {
		return false;
	}
	const start = rows.filter(row => row.binding.slot === 'first-frame');
	const end = rows.filter(row => row.binding.slot === 'last-frame');
	return start.length === 1 && end.length === 1 && start[0].status === 'active' && end[0].status === 'active';
}

function mapEvaluationProblem(problem: IBaseHalfVideoInputEvaluation['problems'][number]): IBaseHalfVideoInputPresentationProblem {
	let kind: BaseHalfVideoInputPresentationProblemKind;
	if (problem.kind === 'too-few' && problem.input === 'first-frame') {
		kind = 'missing-start-frame';
	} else if (problem.kind === 'too-few' && problem.input === 'last-frame') {
		kind = 'missing-end-frame';
	} else if (problem.kind === 'too-few') {
		kind = 'too-few';
	} else if (problem.kind === 'too-many') {
		kind = 'too-many';
	} else {
		kind = 'unsupported-input';
	}
	return Object.freeze({
		kind,
		input: problem.input,
		actualCount: problem.actualCount,
		minimum: problem.minimum,
		maximum: problem.maximum
	});
}

function isMisleadingMissingFrameProblem(
	problem: IBaseHalfVideoInputPresentationProblem,
	bindings: readonly IBaseHalfNodeInputBinding[]
): boolean {
	return (problem.kind === 'missing-start-frame' && bindings.some(binding => binding.slot === 'first-frame'))
		|| (problem.kind === 'missing-end-frame' && bindings.some(binding => binding.slot === 'last-frame'));
}

function problemForStatus(
	status: Exclude<BaseHalfVideoInputBindingStatus, 'active'>,
	sourcePath: string,
	input: string,
	actualCount?: number,
	minimum?: number,
	maximum?: number
): IBaseHalfVideoInputPresentationProblem {
	const kind: BaseHalfVideoInputPresentationProblemKind = status === 'unused'
		? 'unused-role'
		: status === 'incompatible'
			? 'incompatible-role'
			: status;
	return Object.freeze({
		kind,
		...(isVideoInputKind(input) ? { input } : {}),
		sourcePath,
		...(actualCount === undefined ? {} : { actualCount }),
		...(minimum === undefined ? {} : { minimum }),
		...(maximum === undefined ? {} : { maximum })
	});
}

function deduplicateProblems(problems: readonly IBaseHalfVideoInputPresentationProblem[]): readonly IBaseHalfVideoInputPresentationProblem[] {
	const result: IBaseHalfVideoInputPresentationProblem[] = [];
	const keys = new Set<string>();
	for (const problem of problems) {
		const key = `${problem.kind}\u0000${problem.input ?? ''}\u0000${problem.sourcePath ? baseHalfProjectPathKey(problem.sourcePath) : ''}`;
		if (!keys.has(key)) {
			keys.add(key);
			result.push(problem);
		}
	}
	return Object.freeze(result);
}

function actionsForBinding(
	status: BaseHalfVideoInputBindingStatus,
	hasAssignableRole: boolean,
	canReplace: boolean
): readonly BaseHalfVideoInputAction[] {
	const actions: BaseHalfVideoInputAction[] = [];
	if (status === 'source-missing' || status === 'source-changed' || status === 'source-unverified') {
		actions.push('inspect-source');
		if (canReplace) {
			actions.push('replace');
		} else {
			actions.push('change-method');
		}
	} else if (status === 'active') {
		actions.push('replace');
	} else {
		if (status === 'incompatible' && canReplace) {
			actions.push('replace');
		}
		actions.push('change-method');
	}
	if (hasAssignableRole) {
		actions.push('change-role');
	}
	actions.push('remove');
	return Object.freeze(actions);
}

function definitionAcceptsContentKind(
	definition: IBaseHalfVideoModeCapability['inputs'][number] | undefined,
	kind: BaseHalfCanvasContentKind
): boolean {
	if (!definition || definition.kind === 'text-prompt') {
		return false;
	}
	return INPUT_CONTENT_KINDS[definition.kind] === kind;
}

function isFrameRole(value: string): value is BaseHalfVideoFrameRole {
	return value === 'first-frame' || value === 'last-frame';
}

function isVideoInputKind(value: string): value is BaseHalfVideoInputKind {
	return value === 'text-prompt'
		|| value === 'first-frame'
		|| value === 'last-frame'
		|| value === 'reference-image'
		|| value === 'reference-video'
		|| value === 'source-video'
		|| value === 'audio';
}

function nextBindingOrder(bindings: readonly IBaseHalfNodeInputBinding[]): number {
	return bindings.reduce((maximum, binding) => Math.max(maximum, binding.order), -1) + 1;
}

function normalizeBindingOrder(bindings: readonly IBaseHalfNodeInputBinding[]): readonly IBaseHalfNodeInputBinding[] {
	return Object.freeze([...bindings].sort(compareBindings).map((binding, order) => freezeBinding({ ...binding, order })));
}

function bindingForSource(
	source: IBaseHalfVideoInputSourceState,
	slot: string,
	order: number
): IBaseHalfNodeInputBinding {
	if (!source.revision) {
		throw mutationError('source-unavailable', `Source '${source.sourcePath}' has no fresh revision to capture.`);
	}
	return freezeBinding({
		sourcePath: source.sourcePath,
		slot,
		order,
		...(source.sourceId === undefined ? {} : { sourceId: source.sourceId }),
		sourceRevision: source.revision
	});
}

function bindingSetsEqual(
	left: readonly IBaseHalfNodeInputBinding[],
	right: readonly IBaseHalfNodeInputBinding[]
): boolean {
	return left.length === right.length && left.every((binding, index) => {
		const candidate = right[index];
		return binding.sourcePath === candidate.sourcePath
			&& binding.slot === candidate.slot
			&& binding.order === candidate.order
			&& binding.sourceId === candidate.sourceId
			&& binding.sourceRevision === candidate.sourceRevision;
	});
}

function compareBindings(left: IBaseHalfNodeInputBinding, right: IBaseHalfNodeInputBinding): number {
	return left.order - right.order
		|| baseHalfProjectPathKey(left.sourcePath).localeCompare(baseHalfProjectPathKey(right.sourcePath))
		|| left.slot.localeCompare(right.slot);
}

function freezeBinding(binding: IBaseHalfNodeInputBinding): IBaseHalfNodeInputBinding {
	return Object.freeze({
		sourcePath: binding.sourcePath,
		slot: binding.slot,
		order: binding.order,
		...(binding.sourceId === undefined ? {} : { sourceId: binding.sourceId }),
		...(binding.sourceRevision === undefined ? {} : { sourceRevision: binding.sourceRevision })
	});
}

function freezeSource(source: IBaseHalfVideoInputSourceState): IBaseHalfVideoInputSourceState {
	return Object.freeze({
		sourcePath: source.sourcePath,
		...(source.sourceId === undefined ? {} : { sourceId: source.sourceId }),
		title: source.title,
		...(source.kind === undefined ? {} : { kind: source.kind }),
		saved: source.saved,
		integrity: source.integrity,
		...(source.revision === undefined ? {} : { revision: source.revision })
	});
}

function freezeBindingPresentation(value: IBaseHalfVideoInputBindingPresentation): IBaseHalfVideoInputBindingPresentation {
	return Object.freeze({ ...value, actions: Object.freeze([...value.actions]), assignableRoles: Object.freeze([...value.assignableRoles]) });
}

function freezePlan(value: {
	readonly operation: BaseHalfVideoInputMutationOperation;
	readonly beforeBindings: readonly IBaseHalfNodeInputBinding[];
	readonly afterBindings: readonly IBaseHalfNodeInputBinding[];
	readonly graph: { readonly addSourcePaths: readonly string[]; readonly removeSourcePaths: readonly string[] };
	readonly focusSourcePath?: string;
}): IBaseHalfVideoInputMutationPlan {
	return Object.freeze({
		operation: value.operation,
		beforeBindings: Object.freeze(value.beforeBindings.map(freezeBinding)),
		afterBindings: Object.freeze(value.afterBindings.map(freezeBinding)),
		graph: Object.freeze({
			addSourcePaths: Object.freeze([...value.graph.addSourcePaths]),
			removeSourcePaths: Object.freeze([...value.graph.removeSourcePaths])
		}),
		...(value.focusSourcePath === undefined ? {} : { focusSourcePath: value.focusSourcePath })
	});
}

function mutationError(kind: BaseHalfVideoInputMutationProblemKind, message: string): BaseHalfVideoInputMutationError {
	return new BaseHalfVideoInputMutationError(kind, message);
}
