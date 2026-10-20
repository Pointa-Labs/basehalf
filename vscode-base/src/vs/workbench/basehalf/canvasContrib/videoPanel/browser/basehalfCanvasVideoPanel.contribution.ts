/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../base/browser/window.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { basename, dirname, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { IBaseHalfCanvasContribution, IBaseHalfCanvasContributionContext, IBaseHalfCanvasView, IBaseHalfCanvasViewSceneChange, registerBaseHalfCanvasContribution } from '../../../canvas/browser/basehalfCanvasExtensions.js';
import { baseHalfCanvasChildPath } from '../../../canvas/common/basehalfCanvasModel.js';
import { IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfVideoNodePanel, IBaseHalfVideoNodePanelHost, IBaseHalfVideoNodePanelOptions } from '../../../video/browser/basehalfVideoNodePanel.js';

/** What the canvas needs of the panel under a Video card. */
export interface IBaseHalfCanvasVideoPanelWidget extends IDisposable {
	readonly element: HTMLElement;
	/** Its height in screen pixels. */
	readonly height: number;
	readonly onDidChangeHeight: Event<unknown>;
	/** Saves the prompt. */
	flush(): Promise<void>;
}

/** The panel under the selected Video card (D58) and what it lives on. */
interface IBaseHalfCanvasVideoPanelMount {
	readonly sceneKey: string;
	readonly path: string;
	readonly panel: IBaseHalfCanvasVideoPanelWidget;
	readonly store: DisposableStore;
}

/**
 * The panel under a single selected Video card (video node, "The panel"): it
 * follows the selection, stays on its card while the canvas is drawn again,
 * saves its prompt when it goes, and lets the user pick a card or import a
 * file as an input of the node.
 */
export class BaseHalfCanvasVideoPanel extends Disposable implements IBaseHalfCanvasContribution {
	static readonly ID = 'basehalf.canvas.videoPanel';

	private readonly canvas: IBaseHalfCanvasView;
	/** The panel under the selected Video card. */
	private mount: IBaseHalfCanvasVideoPanelMount | undefined;
	/** A Video node that Generate made beside a node with a video: its card is selected once it is drawn. */
	private pendingNodeSelection: { readonly sceneKey: string; readonly path: string } | undefined;
	/** Counts selections, so a panel that waits for a drag to end shows only for the latest one. */
	private selectionToken = 0;
	/** A single selected card whose preview is still loading: its panel shows once it is known to be a Video node. */
	private wanted: { readonly sceneKey: string; readonly path: string; readonly token: number } | undefined;
	private disposed = false;

	constructor(
		context: IBaseHalfCanvasContributionContext,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILogService private readonly logService: ILogService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super();
		this.canvas = context.canvas;
		this._register(this.canvas.onDidChangeSelection(({ sceneKey, paths }) => this.followSelection(sceneKey, paths)));
		this._register(this.canvas.onDidChangeScene(change => this.onDidChangeScene(change)));
		this._register(lifecycleService.onWillShutdown(event => event.join(
			this.mount?.panel.flush() ?? Promise.resolve(),
			{ id: 'join.basehalfVideoPrompt', label: localize('join.basehalfVideoPrompt', "Saving the prompt of a Video node") }
		)));
		this._register(toDisposable(() => {
			this.disposed = true;
			this.canvas.cancelCardPick();
			this.mount?.store.dispose();
			this.mount = undefined;
		}));
	}

	/** Creates the panel of the node at `resource`. */
	protected createPanel(resource: URI, host: IBaseHalfVideoNodePanelHost, options: IBaseHalfVideoNodePanelOptions): IBaseHalfCanvasVideoPanelWidget {
		return this.instantiationService.createInstance(BaseHalfVideoNodePanel, resource, host, options);
	}

	/** Whether the card shows a Video node; a node whose preview is still loading counts when `loading` says so. */
	private isVideoNodeCard(path: string, loading: boolean): boolean | 'loading' {
		if (!this.canvas.getItem(path)) {
			return false;
		}
		const preview = this.canvas.getCardPreview(path);
		if (preview?.kind === 'node') {
			return preview.document.kind === 'video';
		}
		return loading && preview?.kind === 'nodeLoading' ? 'loading' : false;
	}

	/** Shows the panel for a single selected Video card and closes it for any other selection. */
	private followSelection(sceneKey: string, paths: readonly string[]): void {
		const token = ++this.selectionToken;
		this.wanted = undefined;
		const path = paths.length === 1 ? paths[0] : undefined;
		const video = path !== undefined ? this.isVideoNodeCard(path, true) : false;
		if (path === undefined || video === false) {
			void this.closePanel();
			return;
		}
		if (video === 'loading') {
			void this.closePanel();
			this.wanted = { sceneKey, path, token };
			return;
		}
		const show = (): void => {
			if (this.disposed || token !== this.selectionToken || !this.canvas.isCurrentScene(sceneKey)) {
				return;
			}
			// A drag that selected the card keeps the panel away until the pointer is released.
			if (this.canvas.isInteracting()) {
				mainWindow.requestAnimationFrame(show);
				return;
			}
			this.showPanel(sceneKey, path);
		};
		show();
	}

	/** After a drawing: follows a selection the drawing applied, and keeps the open panel on its card. */
	private onDidChangeScene({ scene, drawn, selection }: IBaseHalfCanvasViewSceneChange): void {
		if (!drawn) {
			return;
		}
		const sceneKey = scene.key;
		if (selection) {
			this.followSelection(sceneKey, selection);
		}
		const pendingNode = this.pendingNodeSelection;
		if (pendingNode && pendingNode.sceneKey === sceneKey && this.canvas.getItem(pendingNode.path)) {
			this.pendingNodeSelection = undefined;
			this.canvas.select([pendingNode.path]);
			this.followSelection(sceneKey, [pendingNode.path]);
		}
		const wanted = this.wanted;
		if (wanted && (wanted.token !== this.selectionToken || wanted.sceneKey !== sceneKey)) {
			this.wanted = undefined;
		} else if (wanted && this.isVideoNodeCard(wanted.path, false) === true) {
			this.wanted = undefined;
			this.showPanel(sceneKey, wanted.path);
		}
		const mount = this.mount;
		if (!mount) {
			return;
		}
		if (mount.sceneKey !== sceneKey || this.canvasNavigationService.state.cardDetail || this.isVideoNodeCard(mount.path, true) === false) {
			void this.closePanel();
			return;
		}
		this.publish(mount);
	}

	private showPanel(sceneKey: string, path: string): void {
		const current = this.mount;
		if (current && current.sceneKey === sceneKey && current.path === path) {
			this.publish(current);
			return;
		}
		void this.closePanel();
		const item = this.canvas.getItem(path);
		if (!item) {
			return;
		}
		const focusPrompt = this.canvas.takeCreatedNodeFocus(path);
		const store = new DisposableStore();
		const panel = store.add(this.createPanel(item.stat.resource, this.panelHost(sceneKey, path), { focusPromptWhenShown: focusPrompt }));
		const mount: IBaseHalfCanvasVideoPanelMount = { sceneKey, path, panel, store };
		this.mount = mount;
		store.add(panel.onDidChangeHeight(() => this.publish(mount)));
		this.publish(mount);
	}

	private publish(mount: IBaseHalfCanvasVideoPanelMount): void {
		if (this.mount !== mount) {
			return;
		}
		this.canvas.showCardPanel(mount.sceneKey, mount.path, mount.panel.element, mount.panel.height);
	}

	/** Saves the panel's prompt and takes the panel away. */
	private async closePanel(): Promise<void> {
		const mount = this.mount;
		if (!mount) {
			return;
		}
		this.mount = undefined;
		this.canvas.cancelCardPick();
		this.canvas.clearCardPanel(mount.panel.element);
		try {
			await mount.panel.flush();
		} catch (error) {
			this.logService.warn(error);
		} finally {
			mount.store.dispose();
		}
	}

	private panelHost(sceneKey: string, path: string): IBaseHalfVideoNodePanelHost {
		return {
			pickCard: () => this.canvas.pickCard(path),
			importFile: () => this.importFile(path),
			focusCard: () => this.canvas.focusCard(path),
			didGenerateInNode: resource => this.selectNodeWhenDrawn(sceneKey, resource)
		};
	}

	/** Selects a Video node that Generate made beside another, once its card is drawn. */
	private selectNodeWhenDrawn(sceneKey: string, resource: URI): void {
		const folder = this.canvas.getFolder();
		if (!folder || !this.canvas.isCurrentScene(sceneKey) || !this.uriIdentityService.extUri.isEqual(dirname(resource), folder.resource)) {
			return;
		}
		const path = baseHalfCanvasChildPath(folder.relativePath, basename(resource));
		if (this.canvas.getItem(path)) {
			this.canvas.select([path]);
			this.followSelection(sceneKey, [path]);
			return;
		}
		this.pendingNodeSelection = { sceneKey, path };
		this.canvas.requestRender();
	}

	/** Import File… of the Video panel: copies the chosen file into the node's folder and returns its path. */
	private async importFile(targetPath: string): Promise<string | undefined> {
		const item = this.canvas.getItem(targetPath);
		const folder = this.canvas.getFolder();
		if (!item || !folder) {
			return undefined;
		}
		const picked = await this.fileDialogService.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			title: localize('basehalf.canvas.video.importInput', "Import a File for the Video Node"),
			openLabel: localize('basehalf.canvas.video.importInputButton', "Import"),
			filters: [{
				name: localize('basehalf.canvas.video.importInputFilter', "Images, Videos, Audio, and Text"),
				extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'mp4', 'mov', 'm4v', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'md', 'markdown', 'txt']
			}]
		});
		const source = picked?.[0];
		if (!source) {
			return undefined;
		}
		const nodeFolder = dirname(item.stat.resource);
		const name = basename(source);
		if (this.uriIdentityService.extUri.isEqual(dirname(source), nodeFolder)) {
			return baseHalfCanvasChildPath(folder.relativePath, name);
		}
		const dot = name.lastIndexOf('.');
		const stem = dot > 0 ? name.slice(0, dot) : name;
		const extension = dot > 0 ? name.slice(dot) : '';
		for (let number = 1; number < 1000; number++) {
			const candidate = number === 1 ? name : `${stem} ${number}${extension}`;
			const target = joinPath(nodeFolder, candidate);
			if (await this.fileService.exists(target)) {
				continue;
			}
			await this.fileService.copy(source, target, false);
			return baseHalfCanvasChildPath(folder.relativePath, candidate);
		}
		return undefined;
	}
}

registerBaseHalfCanvasContribution(BaseHalfCanvasVideoPanel.ID, BaseHalfCanvasVideoPanel);
