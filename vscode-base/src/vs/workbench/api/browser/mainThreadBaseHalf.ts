/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../base/browser/window.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IWebviewElement, IWebviewService, WebviewContentPurpose } from '../../contrib/webview/browser/webview.js';
import { IBaseHalfExtensionCardProjectionRuntimeService, IBaseHalfExtensionCardProjectionSession } from '../../basehalf/browser/cardDetail/basehalfExtensionCardProjection.js';
import { IBaseHalfCardDetailState } from '../../basehalf/common/basehalfCanvasNavigation.js';
import { IBaseHalfCardProjectionRegistryService } from '../../basehalf/common/basehalfCardDetail.js';
import { BaseHalfModelCapability, IBaseHalfModelServiceService } from '../../basehalf/common/basehalfModelServices.js';
import { IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import * as extHostProtocol from '../common/extHost.protocol.js';
import { MainThreadWebviews, reviveWebviewExtension } from './mainThreadWebviews.js';

interface IBaseHalfRegisteredProjection {
	readonly extension: extHostProtocol.WebviewExtensionDescription;
	readonly options: { readonly retainContextWhenHidden?: boolean };
	readonly serializeBuffersForPostMessage: boolean;
}

class MainThreadBaseHalfCardProjectionSession extends Disposable implements IBaseHalfExtensionCardProjectionSession {
	private readonly cancellation = this._register(new CancellationTokenSource());
	readonly handle = generateUuid();
	private webview: IWebviewElement | undefined;
	private visible = false;
	private dirty = false;
	private disposed = false;

	constructor(
		private readonly container: HTMLElement,
		private readonly state: IBaseHalfCardDetailState,
		private readonly projectionId: string,
		private readonly registration: IBaseHalfRegisteredProjection,
		private readonly proxy: extHostProtocol.ExtHostBaseHalfShape,
		private readonly mainThreadWebviews: MainThreadWebviews,
		private readonly webviewService: IWebviewService,
		private readonly onDisposeSession: () => void
	) {
		super();
	}

	async open(): Promise<void> {
		const contentOptions: extHostProtocol.IWebviewContentOptions = {};
		const webview = this.webviewService.createWebviewElement({
			providedViewType: this.projectionId,
			title: this.state.relativePath || this.state.resource.path,
			options: {
				purpose: WebviewContentPurpose.CustomEditor,
				retainContextWhenHidden: this.registration.options.retainContextWhenHidden ?? true,
				tryRestoreScrollPosition: true
			},
			contentOptions: {
				forwardUntrustedKeypressEvents: true
			},
			extension: reviveWebviewExtension(this.registration.extension)
		});
		this.webview = this._register(webview);
		webview.mountTo(this.container, mainWindow);
		this.mainThreadWebviews.addWebview(this.handle, webview, {
			serializeBuffersForPostMessage: this.registration.serializeBuffersForPostMessage
		});
		await this.proxy.$resolveCardProjection(
			this.state.resource,
			this.handle,
			this.projectionId,
			contentOptions,
			this.visible,
			this.cancellation.token
		);
	}

	flush(): Promise<boolean> {
		return Promise.resolve(!this.dirty);
	}

	setDirty(dirty: boolean): void {
		this.dirty = dirty;
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.cancellation.cancel();
		this.proxy.$disposeCardProjection(this.handle);
		this.onDisposeSession();
		super.dispose();
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		if (this.webview) {
			this.proxy.$setCardProjectionVisible(this.handle, visible);
		}
	}

	focus(): void {
		this.webview?.focus();
	}
}

export class MainThreadBaseHalf extends Disposable implements extHostProtocol.MainThreadBaseHalfShape {
	private readonly proxy: extHostProtocol.ExtHostBaseHalfShape;
	private readonly registrations = this._register(new DisposableMap<string>());
	private readonly sessions = new Map<extHostProtocol.WebviewHandle, MainThreadBaseHalfCardProjectionSession>();

	constructor(
		context: IExtHostContext,
		private readonly mainThreadWebviews: MainThreadWebviews,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IBaseHalfCardProjectionRegistryService private readonly projectionRegistryService: IBaseHalfCardProjectionRegistryService,
		@IBaseHalfExtensionCardProjectionRuntimeService private readonly runtimeService: IBaseHalfExtensionCardProjectionRuntimeService,
		@IBaseHalfModelServiceService private readonly modelServiceService: IBaseHalfModelServiceService
	) {
		super();
		this.proxy = context.getProxy(extHostProtocol.ExtHostContext.ExtHostBaseHalf);
		this._register(this.modelServiceService.onDidChange(() => this.proxy.$onDidChangeModelServices()));
	}

	$registerCardProjectionProvider(
		extension: extHostProtocol.WebviewExtensionDescription,
		projectionId: string,
		options: { readonly retainContextWhenHidden?: boolean },
		serializeBuffersForPostMessage: boolean
	): void {
		const extensionId = extension.id.value.toLowerCase();
		if (!projectionId.toLowerCase().startsWith(`${extensionId}.`)) {
			throw new Error(`BaseHalf projection '${projectionId}' must start with '${extensionId}.'.`);
		}
		if (!this.projectionRegistryService.getProjection(projectionId)) {
			throw new Error(`BaseHalf projection '${projectionId}' is not declared in contributes.basehalfCardProjections.`);
		}
		const registration: IBaseHalfRegisteredProjection = { extension, options, serializeBuffersForPostMessage };
		const disposable = this.runtimeService.registerProvider(projectionId, {
			extensionId,
			create: (container, state) => {
				const session = new MainThreadBaseHalfCardProjectionSession(
					container,
					state,
					projectionId,
					registration,
					this.proxy,
					this.mainThreadWebviews,
					this.webviewService,
					() => this.sessions.delete(session.handle)
				);
				this.sessions.set(session.handle, session);
				return session;
			}
		});
		this.registrations.set(projectionId, disposable);
	}

	$unregisterCardProjectionProvider(projectionId: string): void {
		this.registrations.deleteAndDispose(projectionId);
	}

	$setCardProjectionDirty(handle: extHostProtocol.WebviewHandle, dirty: boolean): void {
		this.sessions.get(handle)?.setDirty(dirty);
	}

	$getModelServices(extensionId: string, capability?: BaseHalfModelCapability): Promise<readonly extHostProtocol.IBaseHalfModelServiceDto[]> {
		return this.modelServiceService.getServices(extensionId, capability);
	}

	$getModelServiceAccess(extensionId: string, serviceId: string): Promise<extHostProtocol.IBaseHalfModelServiceAccessDto | undefined> {
		return this.modelServiceService.getAccess(extensionId, serviceId);
	}

	override dispose(): void {
		// An Extension Host restart tears down the customer before constructing a
		// replacement. Dispose every live webview session so card detail can show
		// its reconnecting state instead of retaining a dead proxy/webview pair.
		for (const session of [...this.sessions.values()]) {
			session.dispose();
		}
		this.sessions.clear();
		super.dispose();
	}
}
