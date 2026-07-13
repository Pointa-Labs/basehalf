/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
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
}
