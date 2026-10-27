/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../base/browser/window.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
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
import { BaseHalfGenerationKind } from '../../../video/common/basehalfGenerationInfo.js';
import { BASEHALF_VIDEO_INPUT_EXTENSIONS, BaseHalfTakenInputKind } from '../../../video/common/basehalfVideoCatalog.js';
import { createBaseHalfDraftPanel } from '../../../video/browser/basehalfDraftPanels.js';
import { BaseHalfGenerationRecordPanel, IBaseHalfGenerationRecordPanelHost } from '../../../video/browser/basehalfGenerationRecordPanel.js';
import { IBaseHalfVideoNodePanelHost, IBaseHalfVideoNodePanelOptions } from '../../../video/browser/basehalfVideoNodePanel.js';

/** What the canvas needs of the panel under a generation card. */
export interface IBaseHalfCanvasVideoPanelWidget extends IDisposable {
	readonly element: HTMLElement;
	/** Its height in screen pixels. */
	readonly height: number;
	readonly onDidChangeHeight: Event<unknown>;
	/** Settles once the panel has drawn its first read of the card: the canvas shows it from then on (D91). */
	readonly ready?: Promise<unknown>;
	/** Saves the prompt. */
	flush(): Promise<void>;
}

/**
 * How long the canvas waits at most for a new panel to read its card before
 * it shows the panel as it is, so that a slow disk never keeps it away.
 */
export const BASEHALF_CANVAS_PANEL_READ_WAIT = 300;

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
 *
 * A new panel shows once it has read its card, so that its first frame has the
 * shape it keeps; until then the panel the canvas showed stays, and the new one
 * takes its place in the same drawing, so that no frame is without one (D91).
 */
export class BaseHalfCanvasVideoPanel extends Disposable implements IBaseHalfCanvasContribution {
	static readonly ID = 'basehalf.canvas.videoPanel';

	private readonly canvas: IBaseHalfCanvasView;
	/** The panel under the selected generation card, shown or still reading its card. */
	private mount: IBaseHalfCanvasVideoPanelMount | undefined;
	/** The panel the canvas shows: the selected card's, or the one before it while the new one reads its card. */
	private shown: IBaseHalfCanvasVideoPanelMount | undefined;
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
			Promise.all(this.mounts().map(mount => mount.panel.flush())).then(() => undefined),
			{ id: 'join.basehalfVideoPrompt', label: localize('join.basehalfVideoPrompt', "Saving the prompt of an image or video card") }
		)));
		this._register(toDisposable(() => {
			this.disposed = true;
			this.canvas.endCardPick();
			for (const mount of this.mounts()) {
				mount.store.dispose();
			}
			this.mount = undefined;
			this.shown = undefined;
		}));
	}

	/** Creates the panel of the draft at `resource`: its kind's own (D91). */
	protected createPanel(resource: URI, kind: BaseHalfGenerationKind, host: IBaseHalfVideoNodePanelHost, options: IBaseHalfVideoNodePanelOptions): IBaseHalfCanvasVideoPanelWidget {
		return createBaseHalfDraftPanel(this.instantiationService, kind, resource, host, options);
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
			// A drag that selected the card keeps the panel away until the pointer is released,
			// and the panel of another card goes at once: the canvas draws a panel until it is taken away.
			if (this.canvas.isInteracting()) {
				if (this.mount && this.mount.path !== path) {
					void this.closePanel();
				}
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
		// The panel before it stays on its card while the new one reads its card (D91).
		const shown = this.shown;
		if (shown && shown !== mount && shown.sceneKey === sceneKey) {
			this.canvas.showCardPanel(shown.sceneKey, shown.path, shown.panel.element, shown.panel.height);
		}
	}

	private showPanel(sceneKey: string, path: string): void {
		const draft = this.isDraft(path);
		const current = this.mount;
		if (current && current.sceneKey === sceneKey && current.path === path && current.draft === draft) {
			this.publish(current);
			return;
		}
		const item = this.canvas.getItem(path);
		if (!item?.generation) {
			void this.closePanel();
			return;
		}
		// Another card is selected: picking for the card before it ends (D69).
		this.canvas.endCardPick();
		// A panel that was still reading its card is never shown.
		if (current && current !== this.shown) {
			void this.retire(current);
		}
		const focusPrompt = this.canvas.takeCreatedNodeFocus(path);
		const store = new DisposableStore();
		const panel = store.add(draft
			? this.createPanel(item.stat.resource, item.generation.kind, this.panelHost(sceneKey, path), { focusPromptWhenShown: focusPrompt })
			: this.createRecordPanel(item.stat.resource, this.recordPanelHost(sceneKey, path)));
		const mount: IBaseHalfCanvasVideoPanelMount = { sceneKey, path, draft, panel, store };
		this.mount = mount;
		store.add(panel.onDidChangeHeight(() => this.publish(mount)));
		// Shown once it has read its card, in the shape it keeps, in place of the panel before it (D91).
		const show = (): void => {
			if (this.disposed || this.mount !== mount || this.shown === mount) {
				return;
			}
			const before = this.shown;
			this.shown = mount;
			this.publish(mount);
			if (before) {
				void this.retire(before);
			}
		};
		if (!panel.ready) {
			show();
			return;
		}
		const wait = store.add(new RunOnceScheduler(show, BASEHALF_CANVAS_PANEL_READ_WAIT));
		wait.schedule();
		void panel.ready.then(() => {
			wait.cancel();
			show();
		});
	}

	private publish(mount: IBaseHalfCanvasVideoPanelMount): void {
		if (this.mount !== mount || this.shown !== mount) {
			return;
		}
		this.canvas.showCardPanel(mount.sceneKey, mount.path, mount.panel.element, mount.panel.height);
	}

	/** Saves the panel's prompt and takes the panel away, and one that was still reading its card. */
	private async closePanel(): Promise<void> {
		const mounts = this.mounts();
		const shown = this.shown;
		this.mount = undefined;
		this.shown = undefined;
		if (!mounts.length) {
			return;
		}
		this.canvas.endCardPick();
		if (shown) {
			this.canvas.clearCardPanel(shown.panel.element);
		}
		await Promise.all(mounts.map(mount => this.retire(mount)));
	}

	/** Saves the prompt of a panel that goes, and lets go of it. */
	private async retire(mount: IBaseHalfCanvasVideoPanelMount): Promise<void> {
		try {
			await mount.panel.flush();
		} catch (error) {
			this.logService.warn(error);
		} finally {
			mount.store.dispose();
		}
	}

	/** The panel of the selected card and the one the canvas still shows, each once. */
	private mounts(): IBaseHalfCanvasVideoPanelMount[] {
		const mounts: IBaseHalfCanvasVideoPanelMount[] = [];
		for (const mount of [this.mount, this.shown]) {
			if (mount && !mounts.includes(mount)) {
				mounts.push(mount);
			}
		}
		return mounts;
	}

	private panelHost(sceneKey: string, path: string): IBaseHalfVideoNodePanelHost {
		return {
			startPick: pick => this.canvas.startCardPick(pick),
			didChangeConnections: () => this.canvas.requestRender(),
			importFile: (accept, kinds) => this.importFile(path, accept, kinds),
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
	 * The dialog offers the files of `kinds`, those some model of the card's
	 * kind takes: images and notes on an image card (D90).
	 */
	private async importFile(targetPath: string, accept: (path: string) => Promise<boolean>, kinds: readonly BaseHalfTakenInputKind[]): Promise<string | undefined> {
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
				name: importFilterName(kinds),
				extensions: kinds.flatMap(kind => BASEHALF_VIDEO_INPUT_EXTENSIONS[kind])
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

/** The name of Import File…'s filter, by the kinds it offers: "Images and Text" on an image card (D90). */
function importFilterName(kinds: readonly BaseHalfTakenInputKind[]): string {
	const offers = (kind: BaseHalfTakenInputKind) => kinds.includes(kind);
	if (offers('image') && !offers('video')) {
		return offers('audio')
			? localize('basehalf.canvas.video.importInputFilterImagesAudio', "Images, Audio, and Text")
			: localize('basehalf.canvas.video.importInputFilterImages', "Images and Text");
	}
	return localize('basehalf.canvas.video.importInputFilter', "Images, Videos, Audio, and Text");
}

registerBaseHalfCanvasContribution(BaseHalfCanvasVideoPanel.ID, BaseHalfCanvasVideoPanel);
