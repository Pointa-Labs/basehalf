/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType } from '../../../../base/browser/dom.js';
import { timeout } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ITextEditorSelection } from '../../../../platform/editor/common/editor.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ActivationKind, IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';
import { IBaseHalfFocusMirrorService } from '../../common/basehalfFocusMirrorService.js';
import { baseHalfEditorProjectionCanFlush, BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { IBaseHalfCardDetailSurfaceInstance } from './basehalfCardDetailSurface.js';

export interface IBaseHalfExtensionCardProjectionSession extends IDisposable {
	open(): Promise<void>;
	flush(): Promise<boolean>;
	setVisible(visible: boolean): void;
	focus(): void;
}

export interface IBaseHalfExtensionCardProjectionRuntimeProvider {
	readonly extensionId: string;
	create(container: HTMLElement, state: IBaseHalfCardDetailState): IBaseHalfExtensionCardProjectionSession;
}

export const IBaseHalfExtensionCardProjectionRuntimeService = createDecorator<IBaseHalfExtensionCardProjectionRuntimeService>('baseHalfExtensionCardProjectionRuntimeService');

export interface IBaseHalfExtensionCardProjectionRuntimeService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeProviders: Event<string>;

	registerProvider(projectionId: string, provider: IBaseHalfExtensionCardProjectionRuntimeProvider): IDisposable;
	getProvider(projectionId: string): IBaseHalfExtensionCardProjectionRuntimeProvider | undefined;
	waitForProvider(projectionId: string, token: CancellationToken): Promise<IBaseHalfExtensionCardProjectionRuntimeProvider>;
}

export class BaseHalfExtensionCardProjectionRuntimeService extends Disposable implements IBaseHalfExtensionCardProjectionRuntimeService {
	declare readonly _serviceBrand: undefined;

	private readonly providers = new Map<string, IBaseHalfExtensionCardProjectionRuntimeProvider>();
	private readonly _onDidChangeProviders = this._register(new Emitter<string>());
	readonly onDidChangeProviders = this._onDidChangeProviders.event;

	registerProvider(projectionId: string, provider: IBaseHalfExtensionCardProjectionRuntimeProvider): IDisposable {
		if (this.providers.has(projectionId)) {
			throw new Error(`A runtime provider for BaseHalf projection '${projectionId}' is already registered.`);
		}
		this.providers.set(projectionId, provider);
		this._onDidChangeProviders.fire(projectionId);
		return toDisposable(() => {
			if (this.providers.get(projectionId) === provider) {
				this.providers.delete(projectionId);
				this._onDidChangeProviders.fire(projectionId);
			}
		});
	}

	getProvider(projectionId: string): IBaseHalfExtensionCardProjectionRuntimeProvider | undefined {
		return this.providers.get(projectionId);
	}

	waitForProvider(projectionId: string, token: CancellationToken): Promise<IBaseHalfExtensionCardProjectionRuntimeProvider> {
		const current = this.providers.get(projectionId);
		if (current) {
			return Promise.resolve(current);
		}
		if (token.isCancellationRequested) {
			return Promise.reject(new Error(`Opening BaseHalf projection '${projectionId}' was cancelled.`));
		}
		return new Promise((resolve, reject) => {
			const disposables = new DisposableStore();
			disposables.add(this.onDidChangeProviders(changed => {
				if (changed !== projectionId) {
					return;
				}
				const provider = this.providers.get(projectionId);
				if (provider) {
					disposables.dispose();
					resolve(provider);
				}
			}));
			disposables.add(token.onCancellationRequested(() => {
				disposables.dispose();
				reject(new Error(`Opening BaseHalf projection '${projectionId}' was cancelled.`));
			}));
		});
	}
}

/** Host-side lifecycle for a manifest-contributed extension projection. */
export class BaseHalfExtensionCardDetail extends Disposable implements IBaseHalfCardDetailSurfaceInstance {
	private readonly session = this._register(new MutableDisposable<IBaseHalfExtensionCardProjectionSession>());
	private readonly statusDisposables = this._register(new MutableDisposable<DisposableStore>());
	private readonly cancellation = this._register(new CancellationTokenSource());
	private state: IBaseHalfCardDetailState | undefined;
	private visible = false;
	private disposed = false;
	private connectionGeneration = 0;

	constructor(
		private readonly container: HTMLElement,
		private readonly extensionId: string,
		private readonly projectionId: string,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IBaseHalfExtensionCardProjectionRuntimeService private readonly runtimeService: IBaseHalfExtensionCardProjectionRuntimeService,
		@IBaseHalfFocusMirrorService private readonly focusMirrorService: IBaseHalfFocusMirrorService,
		@IBaseHalfEditorFlushService editorFlushService: IBaseHalfEditorFlushService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(editorFlushService.registerPaneFlusher(BASEHALF_CARD_DETAIL_PANE_ID, options => {
			if (!baseHalfEditorProjectionCanFlush(this.projectionId, this.visible, options ?? {})) {
				return Promise.resolve(true);
			}
			return this.session.value?.flush() ?? Promise.resolve(true);
		}));
		this._register(this.runtimeService.onDidChangeProviders(id => {
			if (id !== this.projectionId || this.disposed) {
				return;
			}
			if (!this.runtimeService.getProvider(this.projectionId)) {
				this.connectionGeneration++;
				this.session.clear();
				this.renderStatus('Plugin host restarted. Reconnecting…');
				return;
			}
			if (!this.session.value && this.state) {
				void this.connect(this.state, false);
			}
		}));
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.state = state;
		await this.connect(state, true);
	}

	private async connect(state: IBaseHalfCardDetailState, activateExtension: boolean): Promise<void> {
		const generation = ++this.connectionGeneration;
		this.renderStatus('Loading plugin projection…');
		try {
			if (activateExtension) {
				await this.extensionService.activateByEvent(`onBaseHalfCardProjection:${this.projectionId}`, ActivationKind.Immediate);
			}
			const provider = await Promise.race([
				this.runtimeService.waitForProvider(this.projectionId, this.cancellation.token),
				timeout(10_000).then(() => { throw new Error(`Extension '${this.extensionId}' did not register provider '${this.projectionId}'.`); })
			]);
			if (this.disposed || generation !== this.connectionGeneration) {
				return;
			}
			if (provider.extensionId.toLowerCase() !== this.extensionId.toLowerCase()) {
				throw new Error(`Projection '${this.projectionId}' was registered by the wrong extension.`);
			}
			clearNode(this.container);
			const session = provider.create(this.container, state);
			this.session.value = session;
			session.setVisible(this.visible);
			await session.open();
			if (!this.disposed && generation === this.connectionGeneration) {
				this.writeFocus();
			}
		} catch (error) {
			if (!this.disposed && generation === this.connectionGeneration) {
				this.session.clear();
				this.logService.error(`[BaseHalf] failed to open extension projection '${this.projectionId}'`, error);
				this.renderStatus(`The ${this.projectionId} plugin projection could not be opened.`, true, true);
			}
		}
	}

	override dispose(): void {
		this.disposed = true;
		this.cancellation.cancel();
		super.dispose();
	}

	activate(state: IBaseHalfCardDetailState): void {
		this.state = state;
		this.writeFocus();
	}

	applySelection(_selection: ITextEditorSelection | undefined): void { }

	setVisible(visible: boolean): void {
		this.visible = visible;
		this.session.value?.setVisible(visible);
		if (visible) {
			this.writeFocus();
		}
	}

	focus(): void {
		this.session.value?.focus();
	}

	private renderStatus(message: string, error = false, retry = false): void {
		const disposables = new DisposableStore();
		this.statusDisposables.value = disposables;
		clearNode(this.container);
		const status = append(this.container, $('.basehalf-card-detail-status'));
		const copy = append(status, $('span'));
		copy.textContent = message;
		status.classList.toggle('error', error);
		if (retry) {
			const button = append(status, $('button.basehalf-card-detail-status-retry')) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = 'Retry';
			disposables.add(addDisposableListener(button, EventType.CLICK, () => {
				const state = this.state;
				if (state && !this.disposed) {
					void this.connect(state, true);
				}
			}));
		}
	}

	private writeFocus(): void {
		const state = this.state;
		if (!state || !this.visible) {
			return;
		}
		void this.focusMirrorService.writeFileFocus(state, { projection: state.projection }).catch(error => {
			this.logService.error('[BaseHalf] extension projection focus mirror write failed', error);
		});
	}
}

registerSingleton(IBaseHalfExtensionCardProjectionRuntimeService, BaseHalfExtensionCardProjectionRuntimeService, InstantiationType.Delayed);
