/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { extUri, extname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IProgress } from '../../../platform/progress/common/progress.js';
import { ActivationKind, IExtensionService } from '../../services/extensions/common/extensions.js';
import {
	BASEHALF_NODE_MAX_BINDINGS,
	BASEHALF_NODE_MAX_ID_LENGTH,
	BaseHalfNodeKind,
	createBaseHalfNodeDocument,
	IBaseHalfNodeDocument,
	IBaseHalfNodeAttemptCost,
	IBaseHalfNodeAttemptUsage,
	validateBaseHalfNodePersistentId
} from './basehalfNodeDocument.js';
import { IBaseHalfModelServiceAttemptSnapshot } from './basehalfModelServices.js';

const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;
const LOCAL_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const ICON_PATTERN = /^[a-z][a-z0-9-]*$/;
const OUTPUT_EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9.-]{0,15}$/i;
const MAX_INPUTS = 16;
const MAX_PARAMETERS = 32;
const MAX_ENUM_OPTIONS = 50;
const NODE_OUTPUT_KINDS = new Set<BaseHalfNodeKind>(['file', 'image', 'video', 'audio', 'pdf', 'presentation']);
const DEFAULT_NODE_ROLES: Readonly<Record<BaseHalfNodeKind, string>> = Object.freeze({
	file: 'Output file',
	image: 'Image result',
	video: 'Video clip',
	audio: 'Audio result',
	pdf: 'PDF document',
	presentation: 'Presentation'
});

export const BASEHALF_CANVAS_CONTENT_KINDS = [
	'text',
	'code',
	'file',
	'folder',
	'image',
	'video',
	'audio',
	'pdf',
	'presentation'
] as const;

export type BaseHalfCanvasContentKind = typeof BASEHALF_CANVAS_CONTENT_KINDS[number];
export type BaseHalfCanvasRecipeModelCapability = 'text' | 'image' | 'video' | 'audio';
export type BaseHalfCanvasRecipeValue = null | boolean | number | string | readonly BaseHalfCanvasRecipeValue[] | { readonly [key: string]: BaseHalfCanvasRecipeValue };

export function getBaseHalfCanvasDefaultNodeRole(kind: BaseHalfNodeKind): string {
	return DEFAULT_NODE_ROLES[kind];
}

export interface IBaseHalfCanvasRecipeInputDefinition {
	readonly id: string;
	readonly label: string;
	readonly accepts: readonly BaseHalfCanvasContentKind[];
	readonly minItems: number;
	readonly maxItems: number;
}

interface IBaseHalfCanvasRecipeParameterBase {
	readonly id: string;
	readonly label: string;
	readonly required?: boolean;
}

export interface IBaseHalfCanvasRecipeStringParameter extends IBaseHalfCanvasRecipeParameterBase {
	readonly type: 'string' | 'multiline';
	readonly default?: string;
	readonly minLength?: number;
	readonly maxLength?: number;
}

export interface IBaseHalfCanvasRecipeNumberParameter extends IBaseHalfCanvasRecipeParameterBase {
	readonly type: 'number';
	readonly default?: number;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly step?: number;
}

export interface IBaseHalfCanvasRecipeBooleanParameter extends IBaseHalfCanvasRecipeParameterBase {
	readonly type: 'boolean';
	readonly default?: boolean;
}

export interface IBaseHalfCanvasRecipeEnumOption {
	readonly value: string;
	readonly label: string;
}

export interface IBaseHalfCanvasRecipeEnumParameter extends IBaseHalfCanvasRecipeParameterBase {
	readonly type: 'enum';
	readonly default?: string;
	readonly options: readonly IBaseHalfCanvasRecipeEnumOption[];
}

export type IBaseHalfCanvasRecipeParameterDefinition =
	| IBaseHalfCanvasRecipeStringParameter
	| IBaseHalfCanvasRecipeNumberParameter
	| IBaseHalfCanvasRecipeBooleanParameter
	| IBaseHalfCanvasRecipeEnumParameter;

export interface IBaseHalfCanvasRecipeOutputDefinition {
	readonly id: string;
	readonly kind: BaseHalfNodeKind;
	readonly extensions: readonly string[];
	readonly minItems: number;
	readonly maxItems: number;
	readonly primary?: boolean;
}

export interface IBaseHalfCanvasRecipeContribution {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: string;
	readonly modelCapability?: BaseHalfCanvasRecipeModelCapability;
	/** Exact reviewed catalog owned by this recipe's extension. Required only for video recipes. */
	readonly videoModelCatalogId?: string;
	readonly inputs?: readonly IBaseHalfCanvasRecipeInputDefinition[];
	readonly parameters?: readonly IBaseHalfCanvasRecipeParameterDefinition[];
	readonly outputs: readonly IBaseHalfCanvasRecipeOutputDefinition[];
}

export interface IBaseHalfCanvasTemplateContribution {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly resource: string;
}

export interface IBaseHalfCanvasRecipeDescriptor extends Omit<IBaseHalfCanvasRecipeContribution, 'inputs' | 'parameters'> {
	readonly extensionId: string;
	readonly inputs: readonly IBaseHalfCanvasRecipeInputDefinition[];
	readonly parameters: readonly IBaseHalfCanvasRecipeParameterDefinition[];
}

export interface IBaseHalfCanvasConnectedRecipeChoice {
	readonly recipe: IBaseHalfCanvasRecipeDescriptor;
	readonly primaryOutput: IBaseHalfCanvasRecipeOutputDefinition;
	readonly slots: readonly IBaseHalfCanvasRecipeInputDefinition[];
}

export interface IBaseHalfCanvasConnectedCreateCompensation {
	readonly canvasApplied: boolean;
	readonly referenceApplied: boolean;
	readonly fileCreated: boolean;
	rollbackCanvas(): Promise<void>;
	rollbackReference(): Promise<void>;
	discardFile(): Promise<void>;
}

export interface IBaseHalfCanvasTemplateDescriptor extends Omit<IBaseHalfCanvasTemplateContribution, 'resource'> {
	readonly extensionId: string;
	readonly resource: URI;
}

export const IBaseHalfCanvasRecipeRegistryService = createDecorator<IBaseHalfCanvasRecipeRegistryService>('baseHalfCanvasRecipeRegistryService');

export interface IBaseHalfCanvasRecipeRegistryService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	registerRecipe(extensionId: string, contribution: IBaseHalfCanvasRecipeContribution): IDisposable;
	registerTemplate(extensionId: string, extensionLocation: URI, contribution: IBaseHalfCanvasTemplateContribution): IDisposable;
	getRecipe(id: string): IBaseHalfCanvasRecipeDescriptor | undefined;
	getRecipes(): readonly IBaseHalfCanvasRecipeDescriptor[];
	getTemplate(id: string): IBaseHalfCanvasTemplateDescriptor | undefined;
	getTemplates(): readonly IBaseHalfCanvasTemplateDescriptor[];
}

export class BaseHalfCanvasRecipeRegistryService extends Disposable implements IBaseHalfCanvasRecipeRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly recipes = new Map<string, IBaseHalfCanvasRecipeDescriptor>();
	private readonly templates = new Map<string, IBaseHalfCanvasTemplateDescriptor>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	registerRecipe(extensionId: string, contribution: IBaseHalfCanvasRecipeContribution): IDisposable {
		const descriptor = validateBaseHalfCanvasRecipeContribution(extensionId, contribution);
		if (this.recipes.has(descriptor.id)) {
			throw new Error(`A BaseHalf canvas recipe with id '${descriptor.id}' is already registered.`);
		}
		this.recipes.set(descriptor.id, descriptor);
		this._onDidChange.fire();
		return toDisposable(() => {
			if (this.recipes.get(descriptor.id) === descriptor) {
				this.recipes.delete(descriptor.id);
				this._onDidChange.fire();
			}
		});
	}

	registerTemplate(extensionId: string, extensionLocation: URI, contribution: IBaseHalfCanvasTemplateContribution): IDisposable {
		const descriptor = validateBaseHalfCanvasTemplateContribution(extensionId, extensionLocation, contribution);
		if (this.templates.has(descriptor.id)) {
			throw new Error(`A BaseHalf canvas template with id '${descriptor.id}' is already registered.`);
		}
		this.templates.set(descriptor.id, descriptor);
		this._onDidChange.fire();
		return toDisposable(() => {
			if (this.templates.get(descriptor.id) === descriptor) {
				this.templates.delete(descriptor.id);
				this._onDidChange.fire();
			}
		});
	}

	getRecipe(id: string): IBaseHalfCanvasRecipeDescriptor | undefined {
		return this.recipes.get(id.toLowerCase());
	}

	getRecipes(): readonly IBaseHalfCanvasRecipeDescriptor[] {
		return [...this.recipes.values()].sort(compareDescriptors);
	}

	getTemplate(id: string): IBaseHalfCanvasTemplateDescriptor | undefined {
		return this.templates.get(id.toLowerCase());
	}

	getTemplates(): readonly IBaseHalfCanvasTemplateDescriptor[] {
		return [...this.templates.values()].sort(compareDescriptors);
	}
}

/** Operations that can consume one direct source and produce one stable result
 *  node. Callers still ask the user to choose both the operation and, when
 *  ambiguous, the target-owned input role before creating anything. */
export function getBaseHalfCanvasConnectedRecipeChoices(
	recipes: readonly IBaseHalfCanvasRecipeDescriptor[],
	sourceKind: BaseHalfCanvasContentKind
): readonly IBaseHalfCanvasConnectedRecipeChoice[] {
	return Object.freeze(recipes.flatMap(recipe => {
		const primaryOutput = recipe.outputs.find(output => output.primary === true);
		const slots = recipe.inputs.filter(input => input.accepts.includes(sourceKind) && input.maxItems > 0);
		return primaryOutput && slots.length > 0
			? [Object.freeze({ recipe, primaryOutput, slots: Object.freeze(slots) })]
			: [];
	}));
}

/** A newly configured node persists only declarative recipe defaults. Model or
 *  service selection remains an explicit later choice. */
export function getBaseHalfCanvasRecipeDefaultParameters(
	recipe: IBaseHalfCanvasRecipeDescriptor
): Readonly<Record<string, BaseHalfCanvasRecipeValue>> {
	const result: Record<string, BaseHalfCanvasRecipeValue> = {};
	for (const parameter of recipe.parameters) {
		if (parameter.default !== undefined) {
			result[parameter.id] = parameter.default;
		}
	}
	return Object.freeze(result);
}

/** Builds the initial local document after the user has chosen one compatible
 *  operation and input role. The stable identity is supplied once and no model
 *  selection or non-default parameter is inferred from the connection. */
export function createBaseHalfCanvasConnectedNodeDocument(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	nodeId: string,
	sourcePath: string,
	sourceKind: BaseHalfCanvasContentKind,
	slotId: string
): IBaseHalfNodeDocument {
	const primaryOutput = recipe.outputs.find(output => output.primary === true);
	if (!primaryOutput) {
		throw new Error(`Recipe '${recipe.label}' has no primary output.`);
	}
	if (!recipe.inputs.some(input => input.id === slotId && input.maxItems > 0 && input.accepts.includes(sourceKind))) {
		throw new Error(`Recipe '${recipe.label}' cannot bind input role '${slotId}'.`);
	}
	return createBaseHalfNodeDocument({
		id: nodeId,
		kind: primaryOutput.kind,
		title: recipe.label,
		role: getBaseHalfCanvasDefaultNodeRole(primaryOutput.kind),
		recipe: {
			recipeId: recipe.id,
			parameters: getBaseHalfCanvasRecipeDefaultParameters(recipe),
			inputBindings: [{ sourcePath, slot: slotId, order: 0 }]
		}
	});
}

/** Reverses the durable layers of an incomplete connected-node creation. The
 *  initial file is discarded rather than retained as undo state because no
 *  user-visible operation was committed. Every eligible layer is attempted so
 *  callers can report all cleanup failures without hiding the first one. */
export async function compensateBaseHalfCanvasConnectedNodeCreate(
	compensation: IBaseHalfCanvasConnectedCreateCompensation
): Promise<readonly unknown[]> {
	const errors: unknown[] = [];
	for (const [applied, rollback] of [
		[compensation.canvasApplied, compensation.rollbackCanvas],
		[compensation.referenceApplied, compensation.rollbackReference],
		[compensation.fileCreated, compensation.discardFile]
	] as const) {
		if (!applied) {
			continue;
		}
		try {
			await rollback();
		} catch (error) {
			errors.push(error);
		}
	}
	return Object.freeze(errors);
}

export interface IBaseHalfCanvasArtifactSnapshot {
	readonly id: string;
	readonly kind: BaseHalfCanvasContentKind;
	readonly resource: URI;
	readonly attemptId?: string;
}

export interface IBaseHalfCanvasNodeSnapshot {
	readonly id: string;
	readonly path: string;
	readonly kind: BaseHalfCanvasContentKind;
	readonly resource?: URI;
	readonly result?: IBaseHalfCanvasArtifactSnapshot;
}

export interface IBaseHalfCanvasRecipeInput {
	readonly edgeId: string;
	readonly slotId: string;
	readonly order: number;
	readonly source: IBaseHalfCanvasNodeSnapshot;
}

export interface IBaseHalfCanvasRecipeExecutionRequest {
	readonly attemptId: string;
	readonly workspaceFolder: URI;
	readonly node: IBaseHalfCanvasNodeSnapshot;
	readonly recipeId: string;
	/** Host-owned generation intent frozen into this Attempt. */
	readonly prompt: string;
	readonly parameters: Readonly<Record<string, BaseHalfCanvasRecipeValue>>;
	readonly modelServiceId?: string;
	/** Host-frozen identity of the external service selected for this attempt. */
	readonly modelService?: IBaseHalfModelServiceAttemptSnapshot;
	readonly inputs: readonly IBaseHalfCanvasRecipeInput[];
	readonly outputDirectory: URI;
	/** Existing durable remote task reused by an exact Retry; executors must not submit a replacement task. */
	readonly resumeProviderRequestId?: string;
	/** Persist a newly submitted remote task id before polling or any other fallible work. */
	acknowledgeProviderRequestId(providerRequestId: string): Promise<void>;
}

export interface IBaseHalfCanvasRecipeProgress {
	readonly message?: string;
	readonly increment?: number;
}

export interface IBaseHalfCanvasRecipeArtifact {
	readonly id: string;
	readonly outputId: string;
	readonly kind: BaseHalfNodeKind;
	readonly resource: URI;
	readonly label?: string;
}

export interface IBaseHalfCanvasRecipeExecutionResult {
	readonly artifact: IBaseHalfCanvasRecipeArtifact;
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeAttemptUsage;
	readonly cost?: IBaseHalfNodeAttemptCost;
}

export interface IBaseHalfCanvasRecipeRuntimeProvider {
	readonly extensionId: string;
	execute(request: IBaseHalfCanvasRecipeExecutionRequest, progress: IProgress<IBaseHalfCanvasRecipeProgress>, token: CancellationToken): Promise<IBaseHalfCanvasRecipeExecutionResult>;
}

export const IBaseHalfCanvasRecipeRuntimeService = createDecorator<IBaseHalfCanvasRecipeRuntimeService>('baseHalfCanvasRecipeRuntimeService');

export interface IBaseHalfCanvasRecipeRuntimeService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeExecutors: Event<string>;
	registerExecutor(recipeId: string, provider: IBaseHalfCanvasRecipeRuntimeProvider): IDisposable;
	hasExecutor(recipeId: string): boolean;
	executeRecipe(recipeId: string, request: IBaseHalfCanvasRecipeExecutionRequest, progress: IProgress<IBaseHalfCanvasRecipeProgress>, token: CancellationToken): Promise<IBaseHalfCanvasRecipeExecutionResult>;
}

interface IBaseHalfCanvasRecipeRuntimeEntry {
	readonly provider: IBaseHalfCanvasRecipeRuntimeProvider;
	readonly runs: Set<CancellationTokenSource>;
}

export class BaseHalfCanvasRecipeRuntimeService extends Disposable implements IBaseHalfCanvasRecipeRuntimeService {
	declare readonly _serviceBrand: undefined;

	private readonly executors = new Map<string, IBaseHalfCanvasRecipeRuntimeEntry>();
	private readonly _onDidChangeExecutors = this._register(new Emitter<string>());
	readonly onDidChangeExecutors = this._onDidChangeExecutors.event;

	constructor(
		@IBaseHalfCanvasRecipeRegistryService private readonly recipeRegistryService: IBaseHalfCanvasRecipeRegistryService,
		@IExtensionService private readonly extensionService: IExtensionService
	) {
		super();
	}

	registerExecutor(recipeId: string, provider: IBaseHalfCanvasRecipeRuntimeProvider): IDisposable {
		const id = recipeId.toLowerCase();
		const recipe = this.recipeRegistryService.getRecipe(id);
		if (!recipe) {
			throw new Error(`BaseHalf canvas recipe '${id}' is not declared.`);
		}
		if (recipe.extensionId !== provider.extensionId.toLowerCase()) {
			throw new Error(`BaseHalf canvas recipe '${id}' cannot be executed by extension '${provider.extensionId}'.`);
		}
		if (this.executors.has(id)) {
			throw new Error(`A BaseHalf canvas recipe executor for '${id}' is already registered.`);
		}
		const entry: IBaseHalfCanvasRecipeRuntimeEntry = { provider, runs: new Set() };
		this.executors.set(id, entry);
		this._onDidChangeExecutors.fire(id);
		return toDisposable(() => {
			if (this.executors.get(id) !== entry) {
				return;
			}
			this.executors.delete(id);
			for (const run of entry.runs) {
				run.dispose(true);
			}
			entry.runs.clear();
			this._onDidChangeExecutors.fire(id);
		});
	}

	hasExecutor(recipeId: string): boolean {
		return this.executors.has(recipeId.toLowerCase());
	}

	async executeRecipe(recipeId: string, request: IBaseHalfCanvasRecipeExecutionRequest, progress: IProgress<IBaseHalfCanvasRecipeProgress>, token: CancellationToken): Promise<IBaseHalfCanvasRecipeExecutionResult> {
		const id = recipeId.toLowerCase();
		const recipe = this.recipeRegistryService.getRecipe(id);
		if (!recipe) {
			throw new Error(`No BaseHalf canvas recipe executor is registered for '${id}'.`);
		}
		if (request.recipeId.toLowerCase() !== id) {
			throw new Error(`BaseHalf canvas recipe request '${request.recipeId}' does not match executor '${id}'.`);
		}
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		await this.extensionService.activateByEvent(`onBaseHalfCanvasRecipe:${id}`, ActivationKind.Immediate);
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const entry = this.executors.get(id);
		if (!entry) {
			throw new Error(`No BaseHalf canvas recipe executor is registered for '${id}'.`);
		}

		const cancellation = new CancellationTokenSource(token);
		entry.runs.add(cancellation);
		try {
			const result = await Promise.resolve().then(() => entry.provider.execute(request, progress, cancellation.token));
			return validateBaseHalfCanvasRecipeExecutionResult(recipe, request, result);
		} finally {
			entry.runs.delete(cancellation);
			cancellation.dispose();
		}
	}

	override dispose(): void {
		for (const entry of this.executors.values()) {
			for (const run of entry.runs) {
				run.dispose(true);
			}
			entry.runs.clear();
		}
		this.executors.clear();
		super.dispose();
	}
}

export function validateBaseHalfCanvasRecipeContribution(extensionId: string, contribution: IBaseHalfCanvasRecipeContribution): IBaseHalfCanvasRecipeDescriptor {
	const owner = normalizeExtensionId(extensionId);
	const id = normalizeContributionId(owner, contribution.id, 'recipe');
	const label = boundedText(contribution.label, `${id}.label`, 80);
	const description = optionalBoundedText(contribution.description, `${id}.description`, 500);
	const icon = contribution.icon === undefined ? undefined : boundedText(contribution.icon, `${id}.icon`, 64);
	if (icon !== undefined && !ICON_PATTERN.test(icon)) {
		throw new Error(`BaseHalf canvas recipe '${id}' has an invalid icon.`);
	}
	if (contribution.modelCapability !== undefined && !isModelCapability(contribution.modelCapability)) {
		throw new Error(`BaseHalf canvas recipe '${id}' has an invalid model capability.`);
	}
	let videoModelCatalogId: string | undefined;
	if (contribution.modelCapability === 'video') {
		if (contribution.videoModelCatalogId === undefined) {
			throw new Error(`BaseHalf video recipe '${id}' must declare its exact video model catalog.`);
		}
		videoModelCatalogId = normalizeContributionId(owner, contribution.videoModelCatalogId, 'video model catalog');
	} else if (contribution.videoModelCatalogId !== undefined) {
		throw new Error(`BaseHalf canvas recipe '${id}' cannot declare a video model catalog without video model capability.`);
	}

	const inputs = [...(contribution.inputs ?? [])];
	if (inputs.length > MAX_INPUTS) {
		throw new Error(`BaseHalf canvas recipe '${id}' has too many inputs.`);
	}
	validateUniqueLocalIds(id, 'input', inputs);
	const normalizedInputs = inputs.map(input => validateInput(id, input));
	if (normalizedInputs.reduce((total, input) => total + input.maxItems, 0) > BASEHALF_NODE_MAX_BINDINGS) {
		throw new Error(`BaseHalf canvas recipe '${id}' can bind at most ${BASEHALF_NODE_MAX_BINDINGS} direct inputs in total.`);
	}

	const parameters = [...(contribution.parameters ?? [])];
	if (parameters.length > MAX_PARAMETERS) {
		throw new Error(`BaseHalf canvas recipe '${id}' has too many parameters.`);
	}
	validateUniqueLocalIds(id, 'parameter', parameters);
	const normalizedParameters = parameters.map(parameter => validateParameter(id, parameter));
	if (contribution.modelCapability === 'video' && normalizedParameters.length > 0) {
		throw new Error(`BaseHalf video recipe '${id}' must use reviewed catalog settings instead of static parameters.`);
	}

	const outputs = [...(contribution.outputs ?? [])];
	if (outputs.length !== 1) {
		throw new Error(`BaseHalf canvas recipe '${id}' must declare exactly one output for one Result node.`);
	}
	validateUniqueLocalIds(id, 'output', outputs);
	const normalizedOutputs = outputs.map(output => validateOutput(id, output));
	const primaryOutputs = normalizedOutputs.filter(output => output.primary === true);
	if (primaryOutputs.length !== 1) {
		throw new Error(`BaseHalf canvas recipe '${id}' must declare exactly one primary output.`);
	}
	if (primaryOutputs[0].minItems !== 1 || primaryOutputs[0].maxItems !== 1) {
		throw new Error(`BaseHalf canvas recipe '${id}' primary output must produce exactly one artifact.`);
	}
	if (contribution.modelCapability === 'video' && primaryOutputs[0].kind !== 'video') {
		throw new Error(`BaseHalf video recipe '${id}' must produce a video Result.`);
	}
	if (primaryOutputs[0].kind === 'video'
		&& contribution.modelCapability !== undefined
		&& contribution.modelCapability !== 'video') {
		throw new Error(`BaseHalf local video recipe '${id}' must omit model capability, or use the reviewed video model capability.`);
	}

	return Object.freeze({
		id,
		extensionId: owner,
		label,
		...(description === undefined ? {} : { description }),
		...(icon === undefined ? {} : { icon }),
		...(contribution.modelCapability === undefined ? {} : { modelCapability: contribution.modelCapability }),
		...(videoModelCatalogId === undefined ? {} : { videoModelCatalogId }),
		inputs: Object.freeze(normalizedInputs),
		parameters: Object.freeze(normalizedParameters),
		outputs: Object.freeze(normalizedOutputs)
	});
}

export function validateBaseHalfCanvasTemplateContribution(extensionId: string, extensionLocation: URI, contribution: IBaseHalfCanvasTemplateContribution): IBaseHalfCanvasTemplateDescriptor {
	const owner = normalizeExtensionId(extensionId);
	const id = normalizeContributionId(owner, contribution.id, 'template');
	const label = boundedText(contribution.label, `${id}.label`, 80);
	const description = optionalBoundedText(contribution.description, `${id}.description`, 500);
	const relativeResource = validateRelativeTemplateResource(contribution.resource, id);
	const resource = URI.joinPath(extensionLocation, ...relativeResource.split('/'));
	if (!extUri.isEqualOrParent(resource, extensionLocation) || extUri.isEqual(resource, extensionLocation)) {
		throw new Error(`BaseHalf canvas template '${id}' resolves outside its extension.`);
	}
	return Object.freeze({
		id,
		extensionId: owner,
		label,
		...(description === undefined ? {} : { description }),
		resource
	});
}

export function validateBaseHalfCanvasRecipeExecutionResult(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	request: IBaseHalfCanvasRecipeExecutionRequest,
	result: IBaseHalfCanvasRecipeExecutionResult
): IBaseHalfCanvasRecipeExecutionResult {
	if (!result || typeof result !== 'object' || Array.isArray(result) || !result.artifact || typeof result.artifact !== 'object' || Array.isArray(result.artifact)) {
		throw new Error(`BaseHalf canvas recipe '${recipe.id}' returned an invalid result.`);
	}
	const unknownResultProperty = Object.keys(result).find(key => !['artifact', 'providerRequestId', 'usage', 'cost'].includes(key));
	if (unknownResultProperty) {
		throw new Error(`BaseHalf canvas recipe '${recipe.id}' result contains unsupported property '${unknownResultProperty}'.`);
	}
	const unknownArtifactProperty = Object.keys(result.artifact).find(key => !['id', 'outputId', 'kind', 'resource', 'label'].includes(key));
	if (unknownArtifactProperty) {
		throw new Error(`BaseHalf canvas recipe '${recipe.id}' artifact contains unsupported property '${unknownArtifactProperty}'.`);
	}
	const artifact = Object.freeze({
		id: validateBaseHalfNodePersistentId(result.artifact.id, `${recipe.id}.artifact.id`),
		outputId: boundedText(result.artifact.outputId, `${recipe.id}.artifact.outputId`, 64),
		kind: result.artifact.kind,
		resource: URI.revive(result.artifact.resource),
		...(result.artifact.label === undefined ? {} : { label: boundedText(result.artifact.label, `${recipe.id}.artifact.label`, 160) })
	});
	const output = recipe.outputs[0];
	if (artifact.outputId !== output.id || artifact.kind !== output.kind) {
		throw new Error(`BaseHalf canvas recipe '${recipe.id}' returned artifact '${artifact.id}' for an incompatible output.`);
	}
	if (!extUri.isEqualOrParent(artifact.resource, request.outputDirectory) || extUri.isEqual(artifact.resource, request.outputDirectory)) {
		throw new Error(`BaseHalf canvas recipe '${recipe.id}' returned an artifact outside its output directory.`);
	}
	if (!output.extensions.includes(extname(artifact.resource).toLowerCase())) {
		throw new Error(`BaseHalf canvas recipe '${recipe.id}' returned artifact '${artifact.id}' with an unsupported extension.`);
	}
	const providerRequestId = optionalAuditIdentifier(result.providerRequestId, `${recipe.id}.providerRequestId`, BASEHALF_NODE_MAX_ID_LENGTH);
	const usage = result.usage === undefined ? undefined : validateExecutionUsage(result.usage, `${recipe.id}.usage`);
	const cost = result.cost === undefined ? undefined : validateExecutionCost(result.cost, `${recipe.id}.cost`);
	return Object.freeze({
		artifact,
		...(providerRequestId === undefined ? {} : { providerRequestId }),
		...(usage === undefined ? {} : { usage }),
		...(cost === undefined ? {} : { cost })
	});
}

function validateExecutionUsage(value: IBaseHalfNodeAttemptUsage, path: string): IBaseHalfNodeAttemptUsage {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${path} must be an object.`);
	}
	const keys = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'images', 'videoSeconds', 'audioSeconds'] as const;
	const unknown = Object.keys(value).find(key => !(keys as readonly string[]).includes(key));
	if (unknown) {
		throw new Error(`${path} contains unsupported property '${unknown}'.`);
	}
	const result: Partial<Record<typeof keys[number], number>> = {};
	for (const key of keys) {
		const candidate = value[key];
		if (candidate === undefined) {
			continue;
		}
		if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0 || candidate > Number.MAX_SAFE_INTEGER
			|| (!key.endsWith('Seconds') && !Number.isInteger(candidate))) {
			throw new Error(`${path}.${key} is invalid.`);
		}
		result[key] = candidate;
	}
	if (Object.keys(result).length === 0) {
		throw new Error(`${path} must contain at least one usage value.`);
	}
	return Object.freeze(result);
}

function validateExecutionCost(value: IBaseHalfNodeAttemptCost, path: string): IBaseHalfNodeAttemptCost {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${path} must be an object.`);
	}
	const unknown = Object.keys(value).find(key => !['currency', 'amount', 'kind'].includes(key));
	if (unknown) {
		throw new Error(`${path} contains unsupported property '${unknown}'.`);
	}
	if (!/^[A-Z]{3}$/.test(value.currency)
		|| !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/.test(value.amount)
		|| (value.kind !== 'actual' && value.kind !== 'estimated')) {
		throw new Error(`${path} is invalid.`);
	}
	return Object.freeze({ currency: value.currency, amount: value.amount, kind: value.kind });
}

/** Resolves defaults and validates one persisted recipe parameter set. */
export function resolveBaseHalfCanvasRecipeParameters(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	values: Readonly<Record<string, BaseHalfCanvasRecipeValue>>
): Readonly<Record<string, BaseHalfCanvasRecipeValue>> {
	const definitions = new Map(recipe.parameters.map(parameter => [parameter.id, parameter]));
	for (const key of Object.keys(values)) {
		if (!definitions.has(key)) {
			throw new Error(`Recipe '${recipe.label}' no longer declares parameter '${key}'.`);
		}
	}
	const result: Record<string, BaseHalfCanvasRecipeValue> = {};
	for (const parameter of recipe.parameters) {
		const value = Object.prototype.hasOwnProperty.call(values, parameter.id) ? values[parameter.id] : parameter.default;
		if (value === undefined) {
			if (parameter.required) {
				throw new Error(`Set '${parameter.label}' before running '${recipe.label}'.`);
			}
			continue;
		}
		validateParameterValue(recipe, parameter, value);
		result[parameter.id] = value;
	}
	return Object.freeze(result);
}

/** Validates direct target-owned bindings against one installed recipe. */
export function validateBaseHalfCanvasRecipeInputs(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	inputs: readonly IBaseHalfCanvasRecipeInput[]
): void {
	const edgeIds = new Set<string>();
	const sourcePaths = new Set<string>();
	const orders = new Set<number>();
	for (const input of inputs) {
		if (edgeIds.has(input.edgeId)) {
			throw new Error(`Recipe '${recipe.label}' cannot consume the same direct connection more than once.`);
		}
		if (sourcePaths.has(input.source.path.toLowerCase())) {
			throw new Error(`Recipe '${recipe.label}' cannot consume the same direct source more than once.`);
		}
		if (orders.has(input.order)) {
			throw new Error(`Recipe '${recipe.label}' has duplicate order ${input.order} for its direct inputs.`);
		}
		edgeIds.add(input.edgeId);
		sourcePaths.add(input.source.path.toLowerCase());
		orders.add(input.order);
		const slot = recipe.inputs.find(candidate => candidate.id === input.slotId);
		if (!slot) {
			throw new Error(`Recipe '${recipe.label}' no longer declares input '${input.slotId}'.`);
		}
		if (!slot.accepts.includes(input.source.kind)) {
			throw new Error(`'${input.source.path}' cannot be used as '${slot.label}'.`);
		}
	}
	for (let order = 0; order < inputs.length; order++) {
		if (!orders.has(order)) {
			throw new Error(`Recipe '${recipe.label}' direct input order must be contiguous from zero.`);
		}
	}
	for (const slot of recipe.inputs) {
		const count = inputs.filter(input => input.slotId === slot.id).length;
		if (count < slot.minItems || count > slot.maxItems) {
			throw new Error(`'${slot.label}' requires ${slot.minItems}-${slot.maxItems} direct inputs; found ${count}.`);
		}
	}
}

function validateParameterValue(
	recipe: IBaseHalfCanvasRecipeDescriptor,
	parameter: IBaseHalfCanvasRecipeParameterDefinition,
	value: BaseHalfCanvasRecipeValue
): void {
	switch (parameter.type) {
		case 'string':
		case 'multiline':
			if (typeof value !== 'string'
				|| (parameter.required === true && !value.trim())
				|| (parameter.minLength !== undefined && value.length < parameter.minLength)
				|| (parameter.maxLength !== undefined && value.length > parameter.maxLength)) {
				throw new Error(`Parameter '${parameter.label}' is invalid for '${recipe.label}'.`);
			}
			return;
		case 'number':
			if (typeof value !== 'number' || !Number.isFinite(value)
				|| (parameter.minimum !== undefined && value < parameter.minimum)
				|| (parameter.maximum !== undefined && value > parameter.maximum)) {
				throw new Error(`Parameter '${parameter.label}' is invalid for '${recipe.label}'.`);
			}
			return;
		case 'boolean':
			if (typeof value !== 'boolean') {
				throw new Error(`Parameter '${parameter.label}' is invalid for '${recipe.label}'.`);
			}
			return;
		case 'enum':
			if (typeof value !== 'string' || !parameter.options.some(option => option.value === value)) {
				throw new Error(`Parameter '${parameter.label}' is invalid for '${recipe.label}'.`);
			}
	}
}

function validateInput(recipeId: string, input: IBaseHalfCanvasRecipeInputDefinition): IBaseHalfCanvasRecipeInputDefinition {
	const id = localId(input.id, `${recipeId}.input`);
	const label = boundedText(input.label, `${recipeId}.input.${id}.label`, 80);
	const accepts = [...new Set(input.accepts ?? [])];
	if (!accepts.length || accepts.some(kind => !isCanvasContentKind(kind))) {
		throw new Error(`BaseHalf canvas recipe '${recipeId}' input '${id}' has invalid accepted content kinds.`);
	}
	const { minItems, maxItems } = itemRange(input.minItems, input.maxItems, `${recipeId}.input.${id}`);
	return Object.freeze({ id, label, accepts: Object.freeze(accepts), minItems, maxItems });
}

function validateParameter(recipeId: string, parameter: IBaseHalfCanvasRecipeParameterDefinition): IBaseHalfCanvasRecipeParameterDefinition {
	const id = localId(parameter.id, `${recipeId}.parameter`);
	const label = boundedText(parameter.label, `${recipeId}.parameter.${id}.label`, 80);
	const base = { id, label, ...(parameter.required === true ? { required: true } : {}) };
	switch (parameter.type) {
		case 'string':
		case 'multiline': {
			const minLength = optionalInteger(parameter.minLength, `${recipeId}.parameter.${id}.minLength`, 0, 100_000);
			const maxLength = optionalInteger(parameter.maxLength, `${recipeId}.parameter.${id}.maxLength`, 1, 100_000);
			if (minLength !== undefined && maxLength !== undefined && maxLength < minLength) {
				throw new Error(`BaseHalf canvas recipe '${recipeId}' parameter '${id}' has an invalid length range.`);
			}
			const defaultValue = parameter.default === undefined ? undefined : boundedText(parameter.default, `${recipeId}.parameter.${id}.default`, maxLength ?? 100_000, true);
			if (parameter.required === true && defaultValue !== undefined && !defaultValue.trim()) {
				throw new Error(`BaseHalf canvas recipe '${recipeId}' required parameter '${id}' has a blank default.`);
			}
			if (defaultValue !== undefined && minLength !== undefined && defaultValue.length < minLength) {
				throw new Error(`BaseHalf canvas recipe '${recipeId}' parameter '${id}' default is shorter than minLength.`);
			}
			return Object.freeze({ ...base, type: parameter.type, ...(defaultValue === undefined ? {} : { default: defaultValue }), ...(minLength === undefined ? {} : { minLength }), ...(maxLength === undefined ? {} : { maxLength }) });
		}
		case 'number': {
			const minimum = optionalFiniteNumber(parameter.minimum, `${recipeId}.parameter.${id}.minimum`);
			const maximum = optionalFiniteNumber(parameter.maximum, `${recipeId}.parameter.${id}.maximum`);
			if (minimum !== undefined && maximum !== undefined && maximum < minimum) {
				throw new Error(`BaseHalf canvas recipe '${recipeId}' parameter '${id}' has an invalid number range.`);
			}
			const step = optionalFiniteNumber(parameter.step, `${recipeId}.parameter.${id}.step`);
			if (step !== undefined && step <= 0) {
				throw new Error(`BaseHalf canvas recipe '${recipeId}' parameter '${id}' step must be positive.`);
			}
			const defaultValue = optionalFiniteNumber(parameter.default, `${recipeId}.parameter.${id}.default`);
			if (defaultValue !== undefined && ((minimum !== undefined && defaultValue < minimum) || (maximum !== undefined && defaultValue > maximum))) {
				throw new Error(`BaseHalf canvas recipe '${recipeId}' parameter '${id}' default is outside its range.`);
			}
			return Object.freeze({ ...base, type: 'number', ...(defaultValue === undefined ? {} : { default: defaultValue }), ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }), ...(step === undefined ? {} : { step }) });
		}
		case 'boolean':
			if (parameter.default !== undefined && typeof parameter.default !== 'boolean') {
				throw new Error(`BaseHalf canvas recipe '${recipeId}' parameter '${id}' has an invalid boolean default.`);
			}
			return Object.freeze({ ...base, type: 'boolean', ...(parameter.default === undefined ? {} : { default: parameter.default }) });
		case 'enum': {
			if (!Array.isArray(parameter.options) || parameter.options.length < 1 || parameter.options.length > MAX_ENUM_OPTIONS) {
				throw new Error(`BaseHalf canvas recipe '${recipeId}' parameter '${id}' has an invalid enum option count.`);
			}
			const values = new Set<string>();
			const options = parameter.options.map(option => {
				const value = boundedText(option.value, `${recipeId}.parameter.${id}.option.value`, 100);
				if (values.has(value)) {
					throw new Error(`BaseHalf canvas recipe '${recipeId}' parameter '${id}' has duplicate enum value '${value}'.`);
				}
				values.add(value);
				return Object.freeze({ value, label: boundedText(option.label, `${recipeId}.parameter.${id}.option.label`, 100) });
			});
			if (parameter.default !== undefined && !values.has(parameter.default)) {
				throw new Error(`BaseHalf canvas recipe '${recipeId}' parameter '${id}' default is not an enum option.`);
			}
			return Object.freeze({ ...base, type: 'enum', options: Object.freeze(options), ...(parameter.default === undefined ? {} : { default: parameter.default }) });
		}
		default:
			throw new Error(`BaseHalf canvas recipe '${recipeId}' parameter '${id}' has an invalid type.`);
	}
}

function validateOutput(recipeId: string, output: IBaseHalfCanvasRecipeOutputDefinition): IBaseHalfCanvasRecipeOutputDefinition {
	const id = localId(output.id, `${recipeId}.output`);
	const kind: unknown = output.kind;
	if (typeof kind !== 'string' || !NODE_OUTPUT_KINDS.has(kind as BaseHalfNodeKind)) {
		throw new Error(`BaseHalf canvas recipe '${recipeId}' output '${id}' has an invalid content kind.`);
	}
	const extensions = [...new Set((output.extensions ?? []).map(extension => extension.toLowerCase()))];
	if (!extensions.length || extensions.length > 16 || extensions.some(extension => !OUTPUT_EXTENSION_PATTERN.test(extension))) {
		throw new Error(`BaseHalf canvas recipe '${recipeId}' output '${id}' has invalid file extensions.`);
	}
	const { minItems, maxItems } = itemRange(output.minItems, output.maxItems, `${recipeId}.output.${id}`);
	return Object.freeze({ id, kind: kind as BaseHalfNodeKind, extensions: Object.freeze(extensions), minItems, maxItems, ...(output.primary === true ? { primary: true } : {}) });
}

function validateUniqueLocalIds(recipeId: string, kind: string, values: readonly { readonly id: string }[]): void {
	const ids = new Set<string>();
	for (const value of values) {
		const id = localId(value.id, `${recipeId}.${kind}`);
		if (ids.has(id)) {
			throw new Error(`BaseHalf canvas recipe '${recipeId}' has duplicate ${kind} id '${id}'.`);
		}
		ids.add(id);
	}
}

function validateRelativeTemplateResource(value: string, templateId: string): string {
	const resource = boundedText(value, `${templateId}.resource`, 500);
	if (resource.startsWith('/') || resource.startsWith('\\') || resource.includes('\\') || resource.includes('?') || resource.includes('#') || /^[a-z][a-z0-9+.-]*:/i.test(resource)) {
		throw new Error(`BaseHalf canvas template '${templateId}' resource must be an extension-relative path.`);
	}
	const segments = resource.split('/');
	if (segments.some(segment => !segment || segment === '.' || segment === '..') || !resource.toLowerCase().endsWith('.json')) {
		throw new Error(`BaseHalf canvas template '${templateId}' resource must be a canonical relative JSON path.`);
	}
	return resource;
}

function normalizeExtensionId(value: string): string {
	const id = value.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/.test(id)) {
		throw new Error(`Invalid BaseHalf extension id '${value}'.`);
	}
	return id;
}

function normalizeContributionId(extensionId: string, value: string, kind: string): string {
	const id = typeof value === 'string' ? value : '';
	if (id.length > BASEHALF_NODE_MAX_ID_LENGTH || !CONTRIBUTION_ID_PATTERN.test(id) || !id.startsWith(`${extensionId}.`)) {
		throw new Error(`BaseHalf canvas ${kind} '${id || value}' must be prefixed by '${extensionId}.'.`);
	}
	return id;
}

/** A node keeps one stable content kind; its selected recipe must produce that kind. */
export function baseHalfCanvasRecipeMatchesNodeKind(recipe: IBaseHalfCanvasRecipeDescriptor, kind: BaseHalfNodeKind): boolean {
	return recipe.outputs.find(output => output.primary === true)?.kind === kind;
}

function localId(value: string, field: string): string {
	const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
	if (!LOCAL_ID_PATTERN.test(id)) {
		throw new Error(`BaseHalf canvas ${field} id '${id || value}' is invalid.`);
	}
	return id;
}

function boundedText(value: string, field: string, maximum: number, allowEmpty = false): string {
	if (typeof value !== 'string') {
		throw new Error(`BaseHalf canvas field '${field}' must be text.`);
	}
	const text = allowEmpty ? value : value.trim();
	if ((!allowEmpty && !text) || text.length > maximum) {
		throw new Error(`BaseHalf canvas field '${field}' must contain ${allowEmpty ? `at most ${maximum}` : `1-${maximum}`} characters.`);
	}
	return text;
}

function optionalBoundedText(value: string | undefined, field: string, maximum: number): string | undefined {
	return value === undefined ? undefined : boundedText(value, field, maximum);
}

function optionalAuditIdentifier(value: string | undefined, field: string, maximum: number): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const result = boundedText(value, field, maximum);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]*$/.test(result)) {
		throw new Error(`BaseHalf canvas field '${field}' contains unsupported characters.`);
	}
	return result;
}

function itemRange(minItems: number, maxItems: number, field: string): { minItems: number; maxItems: number } {
	const min = integer(minItems, `${field}.minItems`, 0, 64);
	const max = integer(maxItems, `${field}.maxItems`, 1, 64);
	if (max < min) {
		throw new Error(`BaseHalf canvas field '${field}' has an invalid item range.`);
	}
	return { minItems: min, maxItems: max };
}

function optionalInteger(value: number | undefined, field: string, minimum: number, maximum: number): number | undefined {
	return value === undefined ? undefined : integer(value, field, minimum, maximum);
}

function integer(value: number, field: string, minimum: number, maximum: number): number {
	if (!Number.isInteger(value) || value < minimum || value > maximum) {
		throw new Error(`BaseHalf canvas field '${field}' must be an integer from ${minimum} to ${maximum}.`);
	}
	return value;
}

function optionalFiniteNumber(value: number | undefined, field: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`BaseHalf canvas field '${field}' must be a finite number.`);
	}
	return value;
}

function isCanvasContentKind(value: unknown): value is BaseHalfCanvasContentKind {
	return typeof value === 'string' && (BASEHALF_CANVAS_CONTENT_KINDS as readonly string[]).includes(value);
}

function isModelCapability(value: unknown): value is BaseHalfCanvasRecipeModelCapability {
	return value === 'text' || value === 'image' || value === 'video' || value === 'audio';
}

export function baseHalfCanvasContentKindForPath(path: string, directory: boolean): BaseHalfCanvasContentKind {
	if (directory) {
		return 'folder';
	}
	const extension = extname(URI.file(path)).toLowerCase();
	if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'].includes(extension)) {
		return 'image';
	}
	if (['.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv'].includes(extension)) {
		return 'video';
	}
	if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(extension)) {
		return 'audio';
	}
	if (extension === '.pdf') {
		return 'pdf';
	}
	if (['.ppt', '.pptx', '.key'].includes(extension)) {
		return 'presentation';
	}
	if (['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.css', '.html', '.sh'].includes(extension)) {
		return 'code';
	}
	if (['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv'].includes(extension)) {
		return 'text';
	}
	return 'file';
}

function compareDescriptors(first: { readonly id: string; readonly label: string }, second: { readonly id: string; readonly label: string }): number {
	return first.label.localeCompare(second.label) || first.id.localeCompare(second.id);
}

registerSingleton(IBaseHalfCanvasRecipeRegistryService, BaseHalfCanvasRecipeRegistryService, InstantiationType.Delayed);
registerSingleton(IBaseHalfCanvasRecipeRuntimeService, BaseHalfCanvasRecipeRuntimeService, InstantiationType.Delayed);
