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
import { baseHalfPathHoldsDraft } from '../../../video/common/basehalfGenerationDraft.js';
import { BaseHalfGenerationRecordPanel, IBaseHalfGenerationRecordPanelHost } from '../../../video/browser/basehalfGenerationRecordPanel.js';
import { BaseHalfVideoNodePanel, IBaseHalfVideoNodePanelHost, IBaseHalfVideoNodePanelOptions } from '../../../video/browser/basehalfVideoNodePanel.js';

/** What the canvas needs of the panel under a generation card. */
export interface IBaseHalfCanvasVideoPanelWidget extends IDisposable {
	readonly element: HTMLElement;
	/** Its height in screen pixels. */
	readonly height: number;
	readonly onDidChangeHeight: Event<unknown>;
	/** Saves the prompt. */
	flush(): Promise<void>;
}

/** The panel under the selected generation card and what it lives on. */
interface IBaseHalfCanvasVideoPanelMount {
	readonly sceneKey: string;
	readonly path: string;
	/** The panel of a draft, which makes the file; otherwise the panel of a card with its file, which shows what made it. */
	readonly draft: boolean;
	readonly panel: IBaseHalfCanvasVideoPanelWidget;
	readonly store: DisposableStore;
}

/**
 * The panel under the only selected generation card (generation cards, "The
 * panel" and "The panel of a card with its file"): for a draft, the panel
 * that makes its file; for a card with its file, the panel that shows what
 * made it, of an image or a video, as the canvas knows it from the card
 * store. It follows the selection, stays on its card while the canvas is
 * drawn again, becomes the other panel when a draft's file lands, saves the
 * prompt when it goes, and lets the user pick a card or import a file as an
 * input of a draft.
 */
export class BaseHalfCanvasVideoPanel extends Disposable implements IBaseHalfCanvasContribution {
	static readonly ID = 'basehalf.canvas.videoPanel';

	private readonly canvas: IBaseHalfCanvasView;
	/** The panel under the selected generation card. */
	private mount: IBaseHalfCanvasVideoPanelMount | undefined;
	/** A card that Generate made, or a draft its model renamed: it is selected once it is drawn. */
	private pendingCardSelection: { readonly sceneKey: string; readonly path: string } | undefined;
	/** Counts selections, so a panel that waits for a drag to end shows only for the latest one. */
	private selectionToken = 0;
	/** The only selected card, while it is no generation card: its panel shows once a drawing says it is one. */
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
			{ id: 'join.basehalfVideoPrompt', label: localize('join.basehalfVideoPrompt', "Saving the prompt of an image or video card") }
		)));
		this._register(toDisposable(() => {
			this.disposed = true;
			this.canvas.endCardPick();
			this.mount?.store.dispose();
			this.mount = undefined;
		}));
	}

	/** Creates the panel of the draft at `resource`. */
	protected createPanel(resource: URI, host: IBaseHalfVideoNodePanelHost, options: IBaseHalfVideoNodePanelOptions): IBaseHalfCanvasVideoPanelWidget {
		return this.instantiationService.createInstance(BaseHalfVideoNodePanel, resource, host, options);
	}

	/** Creates the panel of the card with its file at `resource`. */
	protected createRecordPanel(resource: URI, host: IBaseHalfGenerationRecordPanelHost): IBaseHalfCanvasVideoPanelWidget {
		return this.instantiationService.createInstance(BaseHalfGenerationRecordPanel, resource, host);
	}

	/** Whether the card is a generation card, as the card store told the canvas when it drew it. */
	private isGenerationCard(path: string): boolean {
		return this.canvas.getItem(path)?.generation !== undefined;
	}

	/** Whether the generation card is a draft, as the canvas drew it. */
	private isDraft(path: string): boolean {
		return this.canvas.getItem(path)?.generation?.draft === true;
	}

	/** Shows the panel for a single selected generation card and closes it for any other selection. */
	private followSelection(sceneKey: string, paths: readonly string[]): void {
		const token = ++this.selectionToken;
		this.wanted = undefined;
		const path = paths.length === 1 ? paths[0] : undefined;
		if (path === undefined) {
			void this.closePanel();
			return;
		}
		if (!this.isGenerationCard(path)) {
			void this.closePanel();
			// A file whose generation information arrives later, as when an agent writes it, gets the panel then.
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
		const pending = this.pendingCardSelection;
		if (pending && pending.sceneKey === sceneKey && this.canvas.getItem(pending.path)) {
			this.pendingCardSelection = undefined;
			this.canvas.select([pending.path]);
			this.followSelection(sceneKey, [pending.path]);
		}
		const wanted = this.wanted;
		if (wanted && (wanted.token !== this.selectionToken || wanted.sceneKey !== sceneKey || !this.canvas.getItem(wanted.path))) {
			this.wanted = undefined;
		} else if (wanted && this.isGenerationCard(wanted.path)) {
			this.wanted = undefined;
			this.showPanel(sceneKey, wanted.path);
		}
		const mount = this.mount;
		if (!mount) {
			return;
		}
		if (mount.sceneKey !== sceneKey || this.canvasNavigationService.state.cardDetail || !this.isGenerationCard(mount.path)) {
			void this.closePanel();
			return;
		}
		if (mount.draft !== this.isDraft(mount.path)) {
			// The draft's file landed, or the file is gone: the card gets the panel of what it is now.
			this.showPanel(sceneKey, mount.path);
			return;
		}
		this.publish(mount);
	}

	private showPanel(sceneKey: string, path: string): void {
		const draft = this.isDraft(path);
		const current = this.mount;
		if (current && current.sceneKey === sceneKey && current.path === path && current.draft === draft) {
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
		const panel = store.add(draft
			? this.createPanel(item.stat.resource, this.panelHost(sceneKey, path), { focusPromptWhenShown: focusPrompt })
			: this.createRecordPanel(item.stat.resource, this.recordPanelHost(sceneKey, path)));
		const mount: IBaseHalfCanvasVideoPanelMount = { sceneKey, path, draft, panel, store };
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
		this.canvas.endCardPick();
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
			startPick: pick => this.canvas.startCardPick(pick),
			didChangeConnections: () => this.canvas.requestRender(),
			importFile: accept => this.importFile(path, accept),
			focusCard: () => this.canvas.focusCard(path),
			didGenerateInNode: resource => this.selectCardWhenDrawn(sceneKey, resource),
			// The draft a model of another format renamed keeps the selection and its panel at its new name.
			didRenameCard: resource => this.selectCardWhenDrawn(sceneKey, resource)
		};
	}

	private recordPanelHost(sceneKey: string, path: string): IBaseHalfGenerationRecordPanelHost {
		return {
			focusCard: () => this.canvas.focusCard(path),
			didMakeNewVersion: draft => {
				// A card the user just created beside another: selected, in sight, with its prompt
				// focused, so that Cmd/Ctrl+Enter makes another result at once.
				const folder = this.canvas.getFolder();
				if (folder && this.canvas.isCurrentScene(sceneKey) && this.uriIdentityService.extUri.isEqual(dirname(draft), folder.resource)) {
					this.canvas.selectCreatedCard(baseHalfCanvasChildPath(folder.relativePath, basename(draft)));
				}
			}
		};
	}

	/** Selects a card of this canvas that Generate made, or that was renamed, once its card is drawn. */
	private selectCardWhenDrawn(sceneKey: string, resource: URI): void {
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
		this.pendingCardSelection = { sceneKey, path };
		this.canvas.requestRender();
	}

	/**
	 * Import File… of the panel: copies the chosen file into the card's folder,
	 * under a name that no file, folder, or draft has, and returns its path.
	 * `accept` is asked first, with the path the file would have, and nothing
	 * is copied when it refuses (generation cards, "What is connected is sent").
	 */
	private async importFile(targetPath: string, accept: (path: string) => Promise<boolean>): Promise<string | undefined> {
		const item = this.canvas.getItem(targetPath);
		const folder = this.canvas.getFolder();
		if (!item || !folder) {
			return undefined;
		}
		const picked = await this.fileDialogService.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			title: localize('basehalf.canvas.video.importInput', "Import a File as an Input"),
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
		const cardFolder = dirname(item.stat.resource);
		const name = basename(source);
		if (this.uriIdentityService.extUri.isEqual(dirname(source), cardFolder)) {
			const path = baseHalfCanvasChildPath(folder.relativePath, name);
			return await accept(path) ? path : undefined;
		}
		const dot = name.lastIndexOf('.');
		const stem = dot > 0 ? name.slice(0, dot) : name;
		const extension = dot > 0 ? name.slice(dot) : '';
		for (let number = 1; number < 1000; number++) {
			const candidate = number === 1 ? name : `${stem} ${number}${extension}`;
			const target = joinPath(cardFolder, candidate);
			const path = baseHalfCanvasChildPath(folder.relativePath, candidate);
			// A draft's path is taken, as for every name the canvas chooses.
			if (await this.fileService.exists(target) || await baseHalfPathHoldsDraft(this.fileService, folder.workspaceFolder, path)) {
				continue;
			}
			if (!await accept(path)) {
				return undefined;
			}
			await this.fileService.copy(source, target, false);
			return path;
		}
		return undefined;
	}
}

registerBaseHalfCanvasContribution(BaseHalfCanvasVideoPanel.ID, BaseHalfCanvasVideoPanel);
