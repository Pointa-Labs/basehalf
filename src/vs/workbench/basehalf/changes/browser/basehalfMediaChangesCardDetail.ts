/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfChanges.css';
import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { extname, isEqual, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { baseHalfMediaUrl, baseHalfMediaVersionQuery, playBaseHalfMediaOneAtATime } from '../../playback/browser/basehalfMediaElements.js';
import { createBaseHalfVideoPlayer, IBaseHalfVideoPlayer } from '../../playback/browser/basehalfVideoPlayer.js';
import { IBaseHalfCardDetailSurfaceInstance } from '../../cardDetail/browser/basehalfCardDetailSurface.js';
import { baseHalfRenderableContentKind } from '../../workspace/common/basehalfContentRendering.js';
import { IBaseHalfCardDetailState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_LARGEST_COMPARED_VERSION_BYTES, IBaseHalfFileChange, IBaseHalfFileChangesService } from '../common/basehalfFileChanges.js';

/** Where a version in git waits to be shown: the window plays media only from files it may serve. */
const VERSIONS_FOLDER = 'basehalf-changes';

/** This workspace's own: a folder opens in one window, so no other window's start clears what this one shows. */
export function baseHalfChangesVersionsFolder(environmentService: IEnvironmentService, workspaceContextService: IWorkspaceContextService): URI {
	return joinPath(environmentService.workspaceStorageHome, workspaceContextService.getWorkspace().id, VERSIONS_FOLDER).with({ scheme: Schemas.file });
}

/**
 * The Changes view of a picture, a video, or a sound in Card Detail (the changes
 * of a file, rules 16 to 18): the earlier version and the file next to each
 * other.
 */
export class BaseHalfMediaChangesCardDetail extends Disposable implements IBaseHalfCardDetailSurfaceInstance {
	readonly drawsInTransitions = true;

	private readonly root: HTMLElement;
	private readonly shownStore = this._register(new MutableDisposable<DisposableStore>());
	private readonly redraw = this._register(new RunOnceScheduler(() => this.state && void this.show(this.state), 200));
	private players: IBaseHalfVideoPlayer[] = [];
	private state: IBaseHalfCardDetailState | undefined;
	/** The comparison shown or being read; nothing when what stands here is old. */
	private asked: IBaseHalfFileChange | undefined;
	private showSeq = 0;
	private visible = true;
	private disposed = false;

	constructor(
		container: HTMLElement,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IBaseHalfFileChangesService private readonly changes: IBaseHalfFileChangesService,
		@IHoverService private readonly hoverService: IHoverService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.root = append(container, $('.basehalf-card-detail-changes-media'));
		this._register(playBaseHalfMediaOneAtATime(this.root));
		// An agent can write the file while the view shows, and staging moves what it is compared with.
		this._register(this.fileService.onDidFilesChange(event => {
			if (this.state && event.contains(this.state.resource)) {
				this.asked = undefined;
				// While another view shows, nothing is read until this one shows again.
				if (this.visible) {
					this.redraw.schedule();
				}
			}
		}));
		this._register(this.changes.onDidChange(() => this.followChange()));
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.state = state;
		await this.show(state);
	}

	activate(state: IBaseHalfCardDetailState): void {
		this.state = state;
		this.followChange(true);
	}

	update(state: IBaseHalfCardDetailState): void {
		this.activate(state);
	}

	applySelection(): void {
		// A picture has no selection to show.
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		if (!visible) {
			for (const player of this.players) {
				player.pause();
			}
		}
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}

	private followChange(comesIntoView = false): void {
		const state = this.state;
		if (!state) {
			return;
		}
		const change = this.changes.changeOf(state.resource, state.changesGroup);
		if (!change) {
			// The change went: what stands here is old by the time one comes back.
			this.asked = undefined;
		} else if ((comesIntoView || this.visible) && (!this.asked || !isEqual(change.original, this.asked.original) || !isEqual(change.modified, this.asked.modified))) {
			void this.show(state);
		}
	}

	private async show(state: IBaseHalfCardDetailState): Promise<void> {
		const change = this.changes.changeOf(state.resource, state.changesGroup);
		if (!change) {
			return;
		}
		const seq = ++this.showSeq;
		this.asked = change;
		const store = new DisposableStore();
		const [before, now] = await Promise.all([this.versionFile(change.original, state.resource, store), this.versionFile(change.modified, state.resource, store)]);
		if (this.disposed || seq !== this.showSeq) {
			store.dispose();
			return;
		}
		this.players = [];
		clearNode(this.root);
		this.shownStore.value = store;
		this.renderVersion(state.resource, before, localize('basehalf.changes.before', "Before"), store);
		this.renderVersion(state.resource, now, localize('basehalf.changes.now', "Now"), store);
	}

	/** A file of the version that the window may show, or what to say instead. */
	private async versionFile(version: URI, resource: URI, store: DisposableStore): Promise<URI | { readonly notice: string }> {
		try {
			const stat = await this.fileService.stat(version);
			if (version.scheme === Schemas.file) {
				return version.with({ query: baseHalfMediaVersionQuery(stat) });
			}
			if (stat.size > BASEHALF_LARGEST_COMPARED_VERSION_BYTES) {
				return { notice: localize('basehalf.changes.versionTooLarge', "This version is too large to show here.") };
			}
			const contents = await this.fileService.readFile(version);
			const file = joinPath(baseHalfChangesVersionsFolder(this.environmentService, this.workspaceContextService), `${generateUuid()}${extname(resource)}`);
			await this.fileService.writeFile(file, contents.value);
			store.add(toDisposable(() => void this.fileService.del(file).catch(() => { /* The next window clears the folder. */ })));
			return file;
		} catch (error) {
			this.logService.warn('[BaseHalf] a version of a changed file could not be read', error);
			return { notice: localize('basehalf.changes.versionUnreadable', "This version could not be read.") };
		}
	}

	private renderVersion(resource: URI, version: URI | { readonly notice: string }, name: string, store: DisposableStore): void {
		const figure = append(this.root, $('figure.basehalf-card-detail-changes-version'));
		const stage = append(figure, $('.basehalf-card-detail-changes-stage'));
		const caption = append(figure, $('figcaption.basehalf-card-detail-changes-caption'));
		caption.textContent = name;
		if (!URI.isUri(version)) {
			append(stage, $('.basehalf-card-detail-source-notice')).textContent = version.notice;
			return;
		}
		// The stage takes the shape of the version, so that what it is stands right under it.
		const takeShape = (width: number, height: number) => {
			if (width > 0 && height > 0) {
				stage.style.aspectRatio = `${width} / ${height}`;
				stage.classList.add('shaped');
			}
		};
		const undecodable = () => {
			clearNode(stage);
			stage.classList.remove('shaped', 'sound');
			append(stage, $('.basehalf-card-detail-source-notice')).textContent = localize('basehalf.changes.versionUndecodable', "This version could not be decoded by this system.");
		};
		const kind = baseHalfRenderableContentKind(resource);
		if (kind === 'image') {
			const image = append(stage, $<HTMLImageElement>('img.basehalf-card-detail-changes-picture'));
			image.alt = name;
			image.onload = () => {
				caption.textContent = localize('basehalf.changes.pictureSize', "{0} · {1} × {2}", name, image.naturalWidth, image.naturalHeight);
				takeShape(image.naturalWidth, image.naturalHeight);
			};
			image.onerror = undecodable;
			image.src = baseHalfMediaUrl(version);
			return;
		}
		stage.classList.toggle('sound', kind === 'audio');
		store.add(addDisposableListener(stage, 'loadedmetadata', event => {
			const video = event.target as HTMLVideoElement;
			takeShape(video.videoWidth, video.videoHeight);
		}, true));
		const player = store.add(createBaseHalfVideoPlayer(stage, null, {
			source: version,
			videoClasses: [],
			detail: true,
			sound: kind === 'audio',
			open: () => { /* Card Detail is open already. */ },
			onError: undecodable,
			hoverService: this.hoverService
		}));
		this.players.push(player);
	}
}
