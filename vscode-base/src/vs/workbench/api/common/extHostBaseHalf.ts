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
	private readonly structuralCleanupProviders = new Map<string, IBaseHalfStructuralCleanupProviderEntry>();
	private readonly views = new Map<extHostProtocol.WebviewHandle, ExtHostBaseHalfCardProjectionView>();

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

	/** What the host knows of a generation card (D63): its kind, whether it has its file, and the `id` of its `made.yaml`. */
	async inspectGenerationCard(extension: IExtensionDescription, resource: vscode.Uri): Promise<vscode.basehalf.GenerationCardState | undefined> {
		const state = await this.proxy.$inspectGenerationCard(toBaseHalfExtensionIdentity(extension), resource);
		return state ? Object.freeze({
			kind: state.kind,
			hasFile: state.hasFile,
			...(state.generationId === undefined ? {} : { generationId: state.generationId })
		}) : undefined;
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
		this.structuralCleanupProviders.clear();
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
