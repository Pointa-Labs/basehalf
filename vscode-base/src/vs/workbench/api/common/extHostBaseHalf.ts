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

	getModelServices(extension: IExtensionDescription, capability?: vscode.basehalf.ModelCapability): Promise<readonly vscode.basehalf.ModelService[]> {
		return this.proxy.$getModelServices(toBaseHalfExtensionIdentity(extension), capability);
	}

	getModelServiceAccess(extension: IExtensionDescription, snapshot: vscode.basehalf.ModelServiceRunSnapshot): Promise<vscode.basehalf.ModelServiceAccess | undefined> {
		return this.proxy.$getModelServiceAccess(toBaseHalfExtensionIdentity(extension), snapshot);
	}

	async inspectCanvasNode(extension: IExtensionDescription, resource: vscode.Uri, options?: vscode.basehalf.CanvasNodeInspectOptions): Promise<vscode.basehalf.CanvasNodeState | undefined> {
		const state = await this.proxy.$inspectCanvasNode(toBaseHalfExtensionIdentity(extension), resource, options);
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
		runHandle: string,
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
			report: value => this.proxy.$reportCanvasRecipeProgress(runHandle, value)
		};
		const result = await Promise.resolve(entry.executor.execute(reviveRecipeExecutionRequest(request), progress, cancellation));
		if (!result || !Array.isArray(result.artifacts)) {
			throw new Error(`BaseHalf canvas recipe executor '${recipeId}' returned no result.`);
		}
		return {
			artifacts: result.artifacts.map(artifact => ({
				id: artifact.id,
				outputId: artifact.outputId,
				kind: artifact.kind,
				resource: artifact.resource,
				...(artifact.label === undefined ? {} : { label: artifact.label })
			})),
			...(result.primaryArtifactId === undefined ? {} : { primaryArtifactId: result.primaryArtifactId }),
			...(result.providerRequestId === undefined ? {} : { providerRequestId: result.providerRequestId }),
			...(result.usage === undefined ? {} : { usage: result.usage }),
			...(result.cost === undefined ? {} : { cost: result.cost })
		};
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

function reviveRecipeExecutionRequest(request: extHostProtocol.IBaseHalfCanvasRecipeExecutionRequestDto): vscode.basehalf.CanvasRecipeExecutionRequest {
	return {
		runId: request.runId,
		workspaceFolder: URI.revive(request.workspaceFolder),
		node: reviveNodeSnapshot(request.node),
		recipeId: request.recipeId,
		parameters: request.parameters as Readonly<Record<string, vscode.basehalf.CanvasRecipeValue>>,
		...(request.modelServiceId === undefined ? {} : { modelServiceId: request.modelServiceId }),
		...(request.modelService === undefined ? {} : { modelService: request.modelService }),
		inputs: request.inputs.map(input => ({
			edgeId: input.edgeId,
			slotId: input.slotId,
			order: input.order,
			source: reviveNodeSnapshot(input.source)
		})),
		outputDirectory: URI.revive(request.outputDirectory)
	};
}

function reviveNodeSnapshot(node: extHostProtocol.IBaseHalfCanvasNodeSnapshotDto): vscode.basehalf.CanvasNodeSnapshot {
	return {
		id: node.id,
		path: node.path,
		kind: node.kind,
		...(node.resource === undefined ? {} : { resource: URI.revive(node.resource) }),
		...(node.current === undefined ? {} : {
			current: {
				id: node.current.id,
				kind: node.current.kind,
				resource: URI.revive(node.current.resource),
				...(node.current.runId === undefined ? {} : { runId: node.current.runId })
			}
		})
	};
}

function reviveCanvasNodeState(state: extHostProtocol.IBaseHalfCanvasNodeStateDto): vscode.basehalf.CanvasNodeState {
	return {
		id: state.id,
		kind: state.kind,
		...(state.currentVersionId === undefined ? {} : { currentVersionId: state.currentVersionId }),
		versions: state.versions.map(version => ({
			id: version.id,
			status: version.status,
			createdAt: version.createdAt,
			...(version.model === undefined ? {} : { model: version.model }),
			...(version.providerRequestId === undefined ? {} : { providerRequestId: version.providerRequestId }),
			...(version.usage === undefined ? {} : { usage: version.usage }),
			...(version.cost === undefined ? {} : { cost: version.cost }),
			...(version.primaryArtifact === undefined ? {} : {
				primaryArtifact: {
					id: version.primaryArtifact.id,
					kind: version.primaryArtifact.kind,
					resource: URI.revive(version.primaryArtifact.resource),
					integrity: version.primaryArtifact.integrity
				}
			})
		}))
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
