/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { validateBaseHalfNodePersistentId } from '../../basehalf/common/basehalfNodeDocument.js';
import type * as vscode from 'vscode';
import * as extHostProtocol from './extHost.protocol.js';
import * as extHostTypes from './extHostTypes.js';
import { ExtHostWebview, ExtHostWebviews, shouldSerializeBuffersForPostMessage, toExtensionData } from './extHostWebview.js';

interface IBaseHalfProviderEntry {
	readonly extension: IExtensionDescription;
	readonly provider: vscode.basehalf.CardProjectionProvider;
}

interface IBaseHalfRecipeExecutorEntry {
	readonly extension: IExtensionDescription;
	readonly executor: vscode.basehalf.CanvasRecipeExecutor;
}

interface IBaseHalfModelProviderConnectionValidatorEntry {
	readonly extension: IExtensionDescription;
	readonly validator: vscode.basehalf.ModelProviderConnectionValidator;
}

interface IBaseHalfStructuralCleanupProviderEntry {
	readonly extension: IExtensionDescription;
	readonly provider: vscode.basehalf.CanvasStructuralCleanupProvider;
}

class ExtHostBaseHalfCardProjectionView extends Disposable implements vscode.basehalf.CardProjectionView {
	private _visible: boolean;
	private readonly _onDidChangeVisibility = this._register(new Emitter<void>());
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;
	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose = this._onDidDispose.event;

	constructor(readonly webview: ExtHostWebview, visible: boolean, private readonly setDirtyState: (dirty: boolean) => void) {
		super();
		this._visible = visible;
	}

	get visible(): boolean {
		return this._visible;
	}

	setVisible(visible: boolean): void {
		if (this._visible === visible) {
			return;
		}
		this._visible = visible;
		this._onDidChangeVisibility.fire();
	}

	setDirty(dirty: boolean): void {
		this.setDirtyState(dirty);
	}

	override dispose(): void {
		this._onDidDispose.fire();
		this.webview.dispose();
		super.dispose();
	}
}

export class ExtHostBaseHalf implements extHostProtocol.ExtHostBaseHalfShape {
	private readonly proxy: extHostProtocol.MainThreadBaseHalfShape;
	private readonly providers = new Map<string, IBaseHalfProviderEntry>();
	private readonly recipeExecutors = new Map<string, IBaseHalfRecipeExecutorEntry>();
	private readonly modelProviderConnectionValidators = new Map<string, IBaseHalfModelProviderConnectionValidatorEntry>();
	private readonly structuralCleanupProviders = new Map<string, IBaseHalfStructuralCleanupProviderEntry>();
	private readonly views = new Map<extHostProtocol.WebviewHandle, ExtHostBaseHalfCardProjectionView>();
	private readonly modelServicesChangeEmitter = new Emitter<void>();
	readonly onDidChangeModelServices = this.modelServicesChangeEmitter.event;

	constructor(
		mainContext: extHostProtocol.IMainContext,
		private readonly webviews: ExtHostWebviews
	) {
		this.proxy = mainContext.getProxy(extHostProtocol.MainContext.MainThreadBaseHalf);
	}

	registerCardProjectionProvider(
		extension: IExtensionDescription,
		projectionId: string,
		provider: vscode.basehalf.CardProjectionProvider,
		options: vscode.basehalf.CardProjectionProviderOptions = {}
	): vscode.Disposable {
		const extensionId = extension.identifier.value.toLowerCase();
		if (!projectionId.toLowerCase().startsWith(`${extensionId}.`)) {
			throw new Error(`BaseHalf projection '${projectionId}' must start with '${extensionId}.'.`);
		}
		if (this.providers.has(projectionId)) {
			throw new Error(`A BaseHalf projection provider for '${projectionId}' is already registered in this extension host.`);
		}
		this.providers.set(projectionId, { extension, provider });
		this.proxy.$registerCardProjectionProvider(
			toExtensionData(extension),
			projectionId,
			{ retainContextWhenHidden: options.retainContextWhenHidden },
			shouldSerializeBuffersForPostMessage(extension)
		);
		return new extHostTypes.Disposable(() => {
			if (this.providers.get(projectionId)?.provider === provider) {
				this.providers.delete(projectionId);
				this.proxy.$unregisterCardProjectionProvider(projectionId);
			}
		});
	}

	registerCanvasRecipeExecutor(
		extension: IExtensionDescription,
		recipeId: string,
		executor: vscode.basehalf.CanvasRecipeExecutor
	): vscode.Disposable {
		const extensionId = extension.identifier.value.toLowerCase();
		const id = recipeId.toLowerCase();
		if (!id.startsWith(`${extensionId}.`)) {
			throw new Error(`BaseHalf canvas recipe '${recipeId}' must start with '${extensionId}.'.`);
		}
		if (!extensionDeclaresCanvasRecipe(extension, id)) {
			throw new Error(`BaseHalf canvas recipe '${recipeId}' is not declared in contributes.basehalfCanvasRecipes.`);
		}
		if (this.recipeExecutors.has(id)) {
			throw new Error(`A BaseHalf canvas recipe executor for '${id}' is already registered in this extension host.`);
		}
		this.recipeExecutors.set(id, { extension, executor });
		this.proxy.$registerCanvasRecipeExecutor(toExtensionData(extension), id);
		return new extHostTypes.Disposable(() => {
			if (this.recipeExecutors.get(id)?.executor === executor) {
				this.recipeExecutors.delete(id);
				this.proxy.$unregisterCanvasRecipeExecutor(id);
			}
		});
	}

	registerModelProviderConnectionValidator(
		extension: IExtensionDescription,
		specId: string,
		validator: vscode.basehalf.ModelProviderConnectionValidator
	): vscode.Disposable {
		const extensionId = extension.identifier.value.toLowerCase();
		const id = specId.trim().toLowerCase();
		if (!id.startsWith(`${extensionId}.`)) {
			throw new Error(`BaseHalf model provider connection '${specId}' must start with '${extensionId}.'.`);
		}
		if (!extensionDeclaresModelProviderCatalog(extension)) {
			throw new Error(`Extension '${extensionId}' does not declare contributes.basehalfModelProviderCatalogs.`);
		}
		if (this.modelProviderConnectionValidators.has(id)) {
			throw new Error(`A BaseHalf model provider connection validator for '${id}' is already registered in this extension host.`);
		}
		this.modelProviderConnectionValidators.set(id, { extension, validator });
		this.proxy.$registerModelProviderConnectionValidator(toExtensionData(extension), id);
		return new extHostTypes.Disposable(() => {
			if (this.modelProviderConnectionValidators.get(id)?.validator === validator) {
				this.modelProviderConnectionValidators.delete(id);
				this.proxy.$unregisterModelProviderConnectionValidator(id);
			}
		});
	}

	getModelServices(extension: IExtensionDescription, capability?: vscode.basehalf.ModelCapability): Promise<readonly vscode.basehalf.ModelService[]> {
		return this.proxy.$getModelServices(toBaseHalfExtensionIdentity(extension), capability);
	}

	getModelServiceAccess(extension: IExtensionDescription, snapshot: vscode.basehalf.ModelServiceAttemptSnapshot): Promise<vscode.basehalf.ModelServiceAccess | undefined> {
		return this.proxy.$getModelServiceAccess(toBaseHalfExtensionIdentity(extension), snapshot);
	}

	async inspectCanvasNode(extension: IExtensionDescription, resource: vscode.Uri): Promise<vscode.basehalf.CanvasNodeState | undefined> {
		const state = await this.proxy.$inspectCanvasNode(toBaseHalfExtensionIdentity(extension), resource);
		return state ? reviveCanvasNodeState(state) : undefined;
	}

	applyProjectFileTransition(
		extension: IExtensionDescription,
		resource: vscode.Uri,
		expected: Uint8Array,
		next: Uint8Array,
		label: string
	): Promise<void> {
		return this.proxy.$applyProjectFileTransition(
			toBaseHalfExtensionIdentity(extension),
			resource,
			VSBuffer.wrap(expected),
			VSBuffer.wrap(next),
			label
		);
	}

	registerCanvasStructuralCleanupProvider(
		extension: IExtensionDescription,
		provider: vscode.basehalf.CanvasStructuralCleanupProvider
	): vscode.Disposable {
		const extensionId = extension.identifier.value.toLowerCase();
		if (this.structuralCleanupProviders.has(extensionId)) {
			throw new Error(`Extension '${extensionId}' already registered a BaseHalf structural cleanup provider.`);
		}
		this.structuralCleanupProviders.set(extensionId, { extension, provider });
		this.proxy.$registerCanvasStructuralCleanupProvider(toBaseHalfExtensionIdentity(extension));
		return new extHostTypes.Disposable(() => {
			if (this.structuralCleanupProviders.get(extensionId)?.provider === provider) {
				this.structuralCleanupProviders.delete(extensionId);
				this.proxy.$unregisterCanvasStructuralCleanupProvider(extensionId);
			}
		});
	}

	dispose(): void {
		for (const view of this.views.values()) {
			view.dispose();
		}
		this.views.clear();
		this.providers.clear();
		this.recipeExecutors.clear();
		this.modelProviderConnectionValidators.clear();
		this.structuralCleanupProviders.clear();
		this.modelServicesChangeEmitter.dispose();
	}

	async $resolveCardProjection(
		resource: UriComponents,
		handle: extHostProtocol.WebviewHandle,
		projectionId: string,
		contentOptions: extHostProtocol.IWebviewContentOptions,
		visible: boolean,
		cancellation: CancellationToken
	): Promise<void> {
		const entry = this.providers.get(projectionId);
		if (!entry) {
			throw new Error(`No BaseHalf projection provider is registered for '${projectionId}'.`);
		}
		const webview = this.webviews.createNewWebview(handle, contentOptions, entry.extension);
		this.webviews.ensureDefaultContentOptions(handle, contentOptions, entry.extension);
		const view = new ExtHostBaseHalfCardProjectionView(webview, visible, dirty => this.proxy.$setCardProjectionDirty(handle, dirty));
		this.views.set(handle, view);
		try {
			await entry.provider.resolveCardProjection(URI.revive(resource), view, cancellation);
		} catch (error) {
			if (this.views.get(handle) === view) {
				this.views.delete(handle);
				view.dispose();
				this.webviews.deleteWebview(handle);
			}
			throw error;
		}
	}

	$disposeCardProjection(handle: extHostProtocol.WebviewHandle): void {
		this.views.get(handle)?.dispose();
		this.views.delete(handle);
		this.webviews.deleteWebview(handle);
	}

	$setCardProjectionVisible(handle: extHostProtocol.WebviewHandle, visible: boolean): void {
		this.views.get(handle)?.setVisible(visible);
	}

	async $executeCanvasRecipe(
		attemptHandle: string,
		recipeId: string,
		request: extHostProtocol.IBaseHalfCanvasRecipeExecutionRequestDto,
		cancellation: CancellationToken
	): Promise<extHostProtocol.IBaseHalfCanvasRecipeExecutionResultDto> {
		const entry = this.recipeExecutors.get(recipeId.toLowerCase());
		if (!entry) {
			throw new Error(`No BaseHalf canvas recipe executor is registered for '${recipeId}'.`);
		}
		if (cancellation.isCancellationRequested) {
			throw new CancellationError();
		}
		const progress: vscode.Progress<vscode.basehalf.CanvasRecipeProgress> = {
			report: value => this.proxy.$reportCanvasRecipeProgress(attemptHandle, value)
		};
		const result = await Promise.resolve(entry.executor.execute(
			reviveRecipeExecutionRequest(
				request,
				providerRequestId => this.proxy.$acknowledgeCanvasRecipeProviderRequestId(attemptHandle, providerRequestId)
			),
			progress,
			cancellation
		));
		if (!result || typeof result !== 'object' || Array.isArray(result) || !result.artifact || typeof result.artifact !== 'object' || Array.isArray(result.artifact)) {
			throw new Error(`BaseHalf canvas recipe executor '${recipeId}' returned no result.`);
		}
		const unknownResultProperty = Object.keys(result).find(key => !['artifact', 'providerRequestId', 'usage', 'cost'].includes(key));
		if (unknownResultProperty) {
			throw new Error(`BaseHalf canvas recipe executor '${recipeId}' result contains unsupported property '${unknownResultProperty}'.`);
		}
		const unknownArtifactProperty = Object.keys(result.artifact).find(key => !['id', 'outputId', 'kind', 'resource', 'label'].includes(key));
		if (unknownArtifactProperty) {
			throw new Error(`BaseHalf canvas recipe executor '${recipeId}' artifact contains unsupported property '${unknownArtifactProperty}'.`);
		}
		return {
			artifact: {
				id: validateBaseHalfNodePersistentId(result.artifact.id, `${recipeId}.artifact.id`),
				outputId: result.artifact.outputId,
				kind: result.artifact.kind,
				resource: result.artifact.resource,
				...(result.artifact.label === undefined ? {} : { label: result.artifact.label })
			},
			...(result.providerRequestId === undefined ? {} : { providerRequestId: result.providerRequestId }),
			...(result.usage === undefined ? {} : { usage: result.usage }),
			...(result.cost === undefined ? {} : { cost: result.cost })
		};
	}

	async $validateModelProviderConnection(
		specId: string,
		request: extHostProtocol.IBaseHalfModelProviderConnectionValidationRequestDto,
		cancellation: CancellationToken
	): Promise<void> {
		const entry = this.modelProviderConnectionValidators.get(specId);
		if (!entry) {
			throw new Error(`No BaseHalf model provider connection validator is registered for '${specId}'.`);
		}
		await entry.validator.validate(request, cancellation);
	}

	async $prepareCanvasStructuralCleanup(
		extensionId: string,
		resource: UriComponents,
		cancellation: CancellationToken
	): Promise<readonly extHostProtocol.IBaseHalfProjectFileTransitionDto[]> {
		const entry = this.structuralCleanupProviders.get(extensionId.toLowerCase());
		if (!entry) {
			throw new Error(`No BaseHalf structural cleanup provider is registered for '${extensionId}'.`);
		}
		if (cancellation.isCancellationRequested) {
			throw new CancellationError();
		}
		const transitions = await Promise.resolve(entry.provider.prepareDelete(URI.revive(resource), cancellation));
		if (transitions === undefined || transitions === null) {
			return [];
		}
		if (!Array.isArray(transitions)) {
			throw new Error(`BaseHalf structural cleanup provider '${extensionId}' returned an invalid result.`);
		}
		return transitions.map(transition => ({
			resource: transition.resource,
			expected: VSBuffer.wrap(transition.expected),
			next: VSBuffer.wrap(transition.next),
			label: transition.label
		}));
	}

	$onDidChangeModelServices(): void {
		this.modelServicesChangeEmitter.fire();
	}
}

function toBaseHalfExtensionIdentity(extension: IExtensionDescription): extHostProtocol.IBaseHalfExtensionIdentityDto {
	return {
		id: extension.identifier,
		version: extension.version,
		location: extension.extensionLocation,
		isBuiltin: extension.isBuiltin,
		isUnderDevelopment: extension.isUnderDevelopment
	};
}

function extensionDeclaresCanvasRecipe(extension: IExtensionDescription, recipeId: string): boolean {
	const contributes = extension.contributes as unknown;
	if (!isRecord(contributes)) {
		return false;
	}
	const recipes = contributes.basehalfCanvasRecipes;
	return Array.isArray(recipes) && recipes.some(candidate => isRecord(candidate)
		&& typeof candidate.id === 'string'
		&& candidate.id.toLowerCase() === recipeId);
}

function extensionDeclaresModelProviderCatalog(extension: IExtensionDescription): boolean {
	const contributes = extension.contributes as unknown;
	return isRecord(contributes) && Array.isArray(contributes.basehalfModelProviderCatalogs) && contributes.basehalfModelProviderCatalogs.length > 0;
}

function reviveRecipeExecutionRequest(
	request: extHostProtocol.IBaseHalfCanvasRecipeExecutionRequestDto,
	acknowledgeProviderRequestId: (providerRequestId: string) => Promise<void>
): vscode.basehalf.CanvasRecipeExecutionRequest {
	return {
		attemptId: request.attemptId,
		workspaceFolder: URI.revive(request.workspaceFolder),
		node: reviveNodeSnapshot(request.node),
		recipeId: request.recipeId,
		prompt: request.prompt,
		parameters: request.parameters as Readonly<Record<string, vscode.basehalf.CanvasRecipeValue>>,
		...(request.modelServiceId === undefined ? {} : { modelServiceId: request.modelServiceId }),
		...(request.modelService === undefined ? {} : { modelService: request.modelService }),
		inputs: request.inputs.map(input => ({
			edgeId: input.edgeId,
			slotId: input.slotId,
			order: input.order,
			source: reviveNodeSnapshot(input.source)
		})),
		outputDirectory: URI.revive(request.outputDirectory),
		...(request.resumeProviderRequestId === undefined ? {} : { resumeProviderRequestId: request.resumeProviderRequestId }),
		acknowledgeProviderRequestId
	};
}

function reviveNodeSnapshot(node: extHostProtocol.IBaseHalfCanvasNodeSnapshotDto): vscode.basehalf.CanvasNodeSnapshot {
	return {
		id: node.id,
		path: node.path,
		kind: node.kind,
		...(node.resource === undefined ? {} : { resource: URI.revive(node.resource) }),
		...(node.result === undefined ? {} : {
			result: {
				id: node.result.id,
				kind: node.result.kind,
				resource: URI.revive(node.result.resource),
				...(node.result.attemptId === undefined ? {} : { attemptId: node.result.attemptId })
			}
		})
	};
}

function reviveCanvasNodeState(state: extHostProtocol.IBaseHalfCanvasNodeStateDto): vscode.basehalf.CanvasNodeState {
	return {
		id: state.id,
		kind: state.kind,
		lifecycle: state.lifecycle,
		...(state.result === undefined ? {} : {
			result: reviveCanvasNodeResult(state.result)
		}),
		attempts: state.attempts.map(attempt => ({
			id: attempt.id,
			status: attempt.status,
			createdAt: attempt.createdAt,
			...(attempt.startedAt === undefined ? {} : { startedAt: attempt.startedAt }),
			...(attempt.completedAt === undefined ? {} : { completedAt: attempt.completedAt }),
			...(attempt.model === undefined ? {} : { model: attempt.model }),
			...(attempt.providerRequestId === undefined ? {} : { providerRequestId: attempt.providerRequestId }),
			...(attempt.usage === undefined ? {} : { usage: attempt.usage }),
			...(attempt.cost === undefined ? {} : { cost: attempt.cost }),
			...(attempt.error === undefined ? {} : { error: attempt.error })
		}))
	};
}

function reviveCanvasNodeResult(result: extHostProtocol.IBaseHalfCanvasNodeResultDto): vscode.basehalf.CanvasNodeResult {
	const artifact: vscode.basehalf.CanvasNodeResultArtifact = {
		id: result.artifact.id,
		outputId: result.artifact.outputId,
		kind: result.artifact.kind,
		resource: URI.revive(result.artifact.resource),
		integrity: result.artifact.integrity,
		...(result.artifact.label === undefined ? {} : { label: result.artifact.label })
	};
	return result.source === 'attempt'
		? { source: 'attempt', attemptId: result.attemptId, artifact }
		: { source: 'imported', artifact };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
