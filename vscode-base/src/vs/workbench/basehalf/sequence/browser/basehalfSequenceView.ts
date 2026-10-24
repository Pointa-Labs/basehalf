/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError, getErrorMessage } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWebviewElement, IWebviewService, WebviewContentPurpose } from '../../../contrib/webview/browser/webview.js';
import { asWebviewUri, webviewGenericCspSource } from '../../../contrib/webview/common/webview.js';
import { IBaseHalfCardDetailSurfaceInstance } from '../../cardDetail/browser/basehalfCardDetailSurface.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCardDetailState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfGenerationCardStore } from '../../video/common/basehalfVideoGeneration.js';
import { BASEHALF_SEQUENCE_MAX_ITEMS, BASEHALF_SEQUENCE_PROJECTION_ID, IBaseHalfSequenceItemInspection, resolveBaseHalfSequenceVideo } from '../common/basehalfSequence.js';
import {
	BaseHalfSequenceArtifactPaths,
	BaseHalfSequenceRefreshState,
	BaseHalfSequenceRenderQueue,
	BaseHalfSequenceVideoPaths,
	baseHalfSequenceWindow,
	canPlayEntireBaseHalfSequence,
	reloadBaseHalfSequencePreview,
	resolveBaseHalfSequencePlaybackRestore
} from '../common/basehalfSequenceRefresh.js';
import { IBaseHalfSequenceService } from './basehalfSequenceService.js';

/** How many clips the view shows; a longer Sequence stays whole in its file. */
const MAX_VIEW_ITEMS = 200;
/** How long the view waits for more changes before it inspects again. */
const REFRESH_DELAY_MS = 120;

interface IViewItem {
	readonly inspection: IBaseHalfSequenceItemInspection;
	readonly mediaResource?: URI;
}

interface IViewRead {
	readonly items: readonly IViewItem[];
	readonly totalItems: number;
	readonly truncated: boolean;
	readonly videoResourceKeys: readonly string[];
}

type ViewMessage =
	| { readonly type: 'refresh' }
	| { readonly type: 'add' }
	| { readonly type: 'escape' }
	| { readonly type: 'navigate'; readonly itemId: string }
	| { readonly type: 'move'; readonly itemId: string; readonly direction: 'up' | 'down' }
	| { readonly type: 'repair'; readonly itemId: string }
	| { readonly type: 'remove'; readonly itemId: string };

/**
 * The Sequence view in Card Detail (Video Sequence): the clips of a
 * `video-sequence.json` in their order, each with its state, a player that
 * plays one clip or, when every clip is available, the whole order, and the
 * Sequence operations. It inspects the Sequence again when the file, a clip's
 * video, the last video verified for a clip, or the generation record of a
 * clip's video changes, while it is shown; a change while it is hidden waits
 * until it is shown again.
 */
export class BaseHalfSequenceView extends Disposable implements IBaseHalfCardDetailSurfaceInstance {
	private webview: IWebviewElement | undefined;
	private resource: URI | undefined;
	private readonly cancellation = this._register(new CancellationTokenSource());
	private readonly refreshState = new BaseHalfSequenceRefreshState(false);
	private readonly artifactPaths = new BaseHalfSequenceArtifactPaths(BASEHALF_SEQUENCE_MAX_ITEMS);
	private readonly videoPaths = new BaseHalfSequenceVideoPaths(BASEHALF_SEQUENCE_MAX_ITEMS);
	private readonly renderQueue = new BaseHalfSequenceRenderQueue(() => this.renderOnce());
	private readonly refresh = this._register(new RunOnceScheduler(() => void this.render(), REFRESH_DELAY_MS));
	private renderGeneration = 0;
	private artifactEventGeneration = 0;
	private hasRendered = false;
	private disposed = false;

	constructor(
		private readonly container: HTMLElement,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IBaseHalfSequenceService private readonly sequenceService: IBaseHalfSequenceService,
		@IBaseHalfGenerationCardStore private readonly generationCardStore: IBaseHalfGenerationCardStore,
		@IBaseHalfCanvasNavigationService private readonly navigationService: IBaseHalfCanvasNavigationService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		const resource = this.resource = state.resource;
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(resource)?.uri;
		const webview = this.webview = this._register(this.webviewService.createWebviewElement({
			providedViewType: BASEHALF_SEQUENCE_PROJECTION_ID,
			title: state.relativePath || resource.path,
			options: {
				purpose: WebviewContentPurpose.CustomEditor,
				retainContextWhenHidden: true,
				tryRestoreScrollPosition: true
			},
			contentOptions: {
				allowScripts: true,
				allowForms: false,
				localResourceRoots: workspaceFolder ? [workspaceFolder] : []
			},
			extension: undefined
		}));
		webview.mountTo(this.container, mainWindow);
		if (!workspaceFolder || workspaceFolder.scheme !== Schemas.file) {
			webview.setHtml(errorDocument(localize('basehalf.sequence.view.notLocal', "Sequence must be an ordinary file inside an open local workspace.")));
			return;
		}
		this._register(webview.onMessage(event => void this.handleMessage(event.message)));
		this._register(webview.onFatalError(error => this.logService.error(`[BaseHalf] Sequence webview failed: ${error.message}`)));
		this._register(this.fileService.onDidFilesChange(event => {
			if (event.contains(resource)) {
				this.scheduleRender(true);
				return;
			}
			// A clip's video, or the last video verified for a clip.
			const artifactChanged = [...event.rawAdded, ...event.rawUpdated, ...event.rawDeleted].some(changed => {
				const key = changed.toString();
				return this.artifactPaths.hasResource(key) || this.videoPaths.hasResource(key);
			});
			if (artifactChanged) {
				this.artifactEventGeneration++;
				this.scheduleRender(true);
			}
		}));
		// The record of what made a clip's video, which can arrive after the
		// video does, as when the video is moved back.
		this._register(this.generationCardStore.onDidChange(card => {
			if (this.videoPaths.hasResource(card.toString()) || this.artifactPaths.hasResource(card.toString())) {
				this.artifactEventGeneration++;
				this.scheduleRender(true);
			}
		}));
		await this.render();
	}

	activate(_state: IBaseHalfCardDetailState): void { }

	applySelection(): void { }

	setVisible(visible: boolean): void {
		if (this.refreshState.setVisible(visible)) {
			this.scheduleRender(false);
		}
	}

	focus(): void {
		this.webview?.focus();
	}

	override dispose(): void {
		this.disposed = true;
		this.cancellation.cancel();
		this.renderGeneration++;
		this.renderQueue.dispose();
		this.artifactPaths.clear();
		this.videoPaths.clear();
		super.dispose();
	}

	private render(): Promise<void> {
		return this.renderQueue.request();
	}

	private scheduleRender(automatic: boolean): void {
		if (this.disposed || (automatic && !this.refreshState.markChanged())) {
			return;
		}
		this.refresh.schedule();
	}

	private async renderOnce(): Promise<void> {
		const webview = this.webview;
		const resource = this.resource;
		if (!webview || !resource || this.disposed) {
			return;
		}
		const generation = ++this.renderGeneration;
		const artifactGenerationAtStart = this.artifactEventGeneration;
		if (!this.hasRendered) {
			webview.setHtml(loadingDocument());
		}
		const token = this.cancellation.token;
		try {
			const read = await this.read(resource, token);
			if (token.isCancellationRequested || generation !== this.renderGeneration) {
				return;
			}
			this.videoPaths.reconcile(read.videoResourceKeys);
			this.artifactPaths.reconcile(read.items.map(item => ({
				resultKey: [item.inspection.item.id, item.inspection.item.generationId ?? '', item.inspection.item.videoPath].join('\u0000'),
				...(item.mediaResource ? { verifiedResourceKey: item.mediaResource.toString() } : {})
			})));
			webview.setHtml(sequenceDocument(read.items, read.totalItems, read.truncated));
			this.hasRendered = true;
			if (this.artifactEventGeneration !== artifactGenerationAtStart) {
				this.scheduleRender(true);
			}
		} catch (error) {
			if (!token.isCancellationRequested && generation === this.renderGeneration) {
				webview.setHtml(errorDocument(getErrorMessage(error)));
			}
		}
	}

	private async read(resource: URI, token: CancellationToken): Promise<IViewRead> {
		const loaded = await this.sequenceService.load(resource);
		throwIfCancelled(token);
		const window = baseHalfSequenceWindow(loaded.sequence.items, MAX_VIEW_ITEMS);
		const videoResourceKeys = loaded.sequence.items.map(item => resolveBaseHalfSequenceVideo(resource, item.videoPath).toString());
		// Follow every clip's video from now on, also while it is inspected.
		this.videoPaths.reconcile(videoResourceKeys);
		const inspection = await this.sequenceService.inspectLoaded({
			...loaded,
			sequence: Object.freeze({ ...loaded.sequence, items: window.items })
		}, token);
		throwIfCancelled(token);
		const items = inspection.items.map(inspected => {
			const mediaResource = inspected.video?.resource;
			return Object.freeze({ inspection: inspected, ...(mediaResource ? { mediaResource } : {}) });
		});
		return Object.freeze({
			items: Object.freeze(items),
			totalItems: window.totalItems,
			truncated: window.truncated,
			videoResourceKeys: Object.freeze(videoResourceKeys)
		});
	}

	private async handleMessage(raw: unknown): Promise<void> {
		const resource = this.resource;
		if (!resource || this.disposed) {
			return;
		}
		try {
			const message = parseMessage(raw);
			switch (message.type) {
				case 'refresh':
					await this.render();
					return;
				case 'escape':
					// An Escape the page did not use closes Card Detail (opening and closing Card Detail, "The keyboard").
					await this.navigationService.closeCardDetail();
					return;
				case 'add':
					try {
						await this.sequenceService.addFromView(resource);
					} finally {
						await this.render();
					}
					return;
			}
			const loaded = await this.sequenceService.load(resource);
			const item = loaded.sequence.items.find(candidate => candidate.id === message.itemId);
			if (!item) {
				throw new Error(localize('basehalf.sequence.view.clipGone', "This clip is no longer in the Sequence."));
			}
			switch (message.type) {
				case 'navigate':
					await this.navigationService.openResource(resolveBaseHalfSequenceVideo(resource, item.videoPath), { source: 'api', pinned: true });
					return;
				case 'move':
					await this.sequenceService.move({ sequence: resource, itemId: item.id, direction: message.direction });
					break;
				case 'repair':
					await this.sequenceService.repair({ sequence: resource, itemId: item.id });
					break;
				case 'remove':
					await this.sequenceService.remove({ sequence: resource, itemId: item.id });
					break;
			}
			await this.render();
		} catch (error) {
			this.notificationService.error(getErrorMessage(error));
		}
	}
}

function throwIfCancelled(token: CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new CancellationError();
	}
}

function parseMessage(value: unknown): ViewMessage {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('The Sequence action is invalid.');
	}
	const record = value as Record<string, unknown>;
	if ((record.type === 'refresh' || record.type === 'add' || record.type === 'escape') && Object.keys(record).length === 1) {
		return { type: record.type };
	}
	if (typeof record.itemId !== 'string' || !record.itemId || record.itemId.length > 128) {
		throw new Error('The Sequence clip identity is invalid.');
	}
	if (record.type === 'navigate' || record.type === 'repair' || record.type === 'remove') {
		if (Object.keys(record).some(key => key !== 'type' && key !== 'itemId')) {
			throw new Error('The Sequence action contains unsupported data.');
		}
		return { type: record.type, itemId: record.itemId };
	}
	if (record.type === 'move' && (record.direction === 'up' || record.direction === 'down')
		&& Object.keys(record).every(key => key === 'type' || key === 'itemId' || key === 'direction')) {
		return { type: 'move', itemId: record.itemId, direction: record.direction };
	}
	throw new Error('The Sequence action is not supported.');
}

function loadingDocument(): string {
	return shellDocument(`<main class="state">${escape(localize('basehalf.sequence.view.loading', "Loading playback order…"))}</main>`, '');
}

function errorDocument(message: string): string {
	return shellDocument(`<main class="state error"><strong>${escape(localize('basehalf.sequence.view.couldNotOpen', "Sequence could not be opened"))}</strong><span>${escape(message)}</span><button data-refresh>${escape(localize('basehalf.sequence.view.tryAgain', "Try Again"))}</button></main>`, refreshScript());
}

function sequenceDocument(items: readonly IViewItem[], totalItems: number, truncated: boolean): string {
	const playable = items.map((item, index) => item.mediaResource ? {
		index,
		itemId: item.inspection.item.id,
		title: item.inspection.item.title,
		src: asWebviewUri(item.mediaResource).toString()
	} : undefined).filter((item): item is NonNullable<typeof item> => !!item);
	const playableIndexByItemId = new Map(playable.map((item, index) => [item.itemId, index]));
	const canPlayAll = !truncated && canPlayEntireBaseHalfSequence(totalItems, playable.length);
	const playAllLabel = totalItems === 0
		? localize('basehalf.sequence.view.playAllEmpty', "Add clips before playing the saved order")
		: truncated
			? localize('basehalf.sequence.view.playAllTruncated', "Only the first {0} clips are shown; shorten the Sequence to play the complete order", items.length)
			: canPlayAll
				? localize('basehalf.sequence.view.playAllReady', "Play the complete saved order")
				: localize('basehalf.sequence.view.playAllBlocked', "Resolve unavailable clips before playing the saved order");
	const first = playable[0];
	const rows = items.map((item, index) => {
		const title = item.inspection.item.title;
		const state = item.inspection.state === 'available' ? localize('basehalf.sequence.view.available', "Available") : item.inspection.message;
		const playableIndex = playableIndexByItemId.get(item.inspection.item.id) ?? -1;
		return `<li class="clip${playableIndex === 0 ? ' active' : ''}" data-item-id="${escapeAttribute(item.inspection.item.id)}" data-playable-index="${playableIndex}">
			<button class="clip-main" data-select ${playableIndex < 0 ? 'disabled' : ''} aria-label="${escapeAttribute(localize('basehalf.sequence.view.play', "Play {0}", title))}">
				<span class="index">${index + 1}</span><span class="copy"><strong>${escape(title)}</strong><small>${escape(state)}</small></span>
			</button>
			<div class="actions" aria-label="${escapeAttribute(localize('basehalf.sequence.view.actionsFor', "Actions for {0}", title))}">
				<button aria-label="${escapeAttribute(localize('basehalf.sequence.view.openVideo', "Open video"))}" data-action="navigate">${escape(localize('basehalf.sequence.view.open', "Open"))}</button>
				<button aria-label="${escapeAttribute(localize('basehalf.sequence.view.moveEarlier', "Move earlier"))}" data-action="move-up" ${index === 0 ? 'disabled' : ''}>↑</button>
				<button aria-label="${escapeAttribute(localize('basehalf.sequence.view.moveLater', "Move later"))}" data-action="move-down" ${index === totalItems - 1 ? 'disabled' : ''}>↓</button>
				${item.inspection.repairCandidatePath ? `<button data-action="repair">${escape(localize('basehalf.sequence.view.repair', "Repair"))}</button>` : ''}
				<button class="quiet" aria-label="${escapeAttribute(localize('basehalf.sequence.view.removeFromOrder', "Remove from playback order"))}" data-action="remove">${escape(localize('basehalf.sequence.view.remove', "Remove"))}</button>
			</div>
		</li>`;
	}).join('');
	const clipCount = totalItems === 1
		? localize('basehalf.sequence.view.oneClip', "1 clip")
		: localize('basehalf.sequence.view.clips', "{0} clips", totalItems);
	const content = `<main>
		<header><div><h1>${escape(localize('basehalf.sequence.view.title', "Sequence"))}</h1><p>${escape(clipCount)}</p></div><div class="header-actions"><button data-add>${escape(localize('basehalf.sequence.view.addClip', "Add clip"))}</button><button class="primary" data-play-all aria-label="${escapeAttribute(playAllLabel)}" ${canPlayAll ? '' : 'disabled'}>${escape(localize('basehalf.sequence.view.playAll', "Play all"))}</button></div></header>
		${truncated ? `<p class="limit-note">${escape(localize('basehalf.sequence.view.limit', "Showing the first {0} clips. Open the local Sequence file to manage the remaining {1}.", items.length, totalItems - items.length))}</p>` : ''}
		<section class="player" aria-label="${escapeAttribute(localize('basehalf.sequence.view.activeClip', "Active clip"))}">
			${first ? `<video controls preload="metadata" src="${escapeAttribute(first.src)}"></video><div class="now"><div class="now-copy" aria-live="polite"><span>${escape(localize('basehalf.sequence.view.nowPlaying', "Now playing"))}</span><strong>${escape(first.title)}</strong></div><button data-reload-preview hidden aria-label="${escapeAttribute(localize('basehalf.sequence.view.reloadPreviewLabel', "Load this clip's video again"))}">${escape(localize('basehalf.sequence.view.reloadPreview', "Reload preview"))}</button></div>` : `<div class="empty-player">${escape(localize('basehalf.sequence.view.noClipReady', "No clip is ready to play."))}</div>`}
		</section>
		<section class="order"><h2>${escape(localize('basehalf.sequence.view.playbackOrder', "Playback order"))}</h2>${totalItems > 0 ? `<ol>${rows}</ol>` : `<div class="empty-list">${escape(localize('basehalf.sequence.view.emptyList', "Add a video to define playback order."))}</div>`}</section>
	</main>`;
	return shellDocument(content, sequenceScript(playable, canPlayAll));
}

function shellDocument(content: string, script: string): string {
	const nonce = generateUuid();
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webviewGenericCspSource} data:; media-src ${webviewGenericCspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">${styles()}</style></head><body>${content}<script nonce="${nonce}">${keyboardScript()}${script}</script></body></html>`;
}

/** An Escape that nothing of the page used goes to Card Detail, which closes. */
function keyboardScript(): string {
	return `const host=acquireVsCodeApi();window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!document.fullscreenElement){host.postMessage({type:'escape'});}});`;
}

function refreshScript(): string {
	return `document.querySelector('[data-refresh]')?.addEventListener('click',()=>host.postMessage({type:'refresh'}));`;
}

function sequenceScript(playable: readonly { readonly index: number; readonly itemId: string; readonly title: string; readonly src: string }[], canPlayAll: boolean): string {
	const data = JSON.stringify(playable).replace(/</g, '\\u003c');
	const text = JSON.stringify({
		loadingPreview: localize('basehalf.sequence.view.loadingPreview', "Loading preview"),
		nowPlaying: localize('basehalf.sequence.view.nowPlaying', "Now playing"),
		previewUnavailable: localize('basehalf.sequence.view.previewUnavailable', "Preview unavailable")
	}).replace(/</g, '\\u003c');
	return `const vscode=host;const text=${text};const playable=${data};const canPlayAll=${JSON.stringify(canPlayAll)};const video=document.querySelector('video');const reloadPreviewButton=document.querySelector('[data-reload-preview]');const reloadExactPreview=${reloadBaseHalfSequencePreview.toString()};const resolveRestore=${resolveBaseHalfSequencePlaybackRestore.toString()};const restored=resolveRestore(playable,vscode.getState());let active=restored.playableIndex;let playAll=restored.playAll&&canPlayAll;let desiredPlayback=restored.shouldPlay;let resumeTime=restored.currentTime;let loadingSource=false;let lastSavedSecond=-1;
	const persist=()=>{const item=playable[active];if(!item)return;const currentTime=loadingSource?resumeTime:video&&Number.isFinite(video.currentTime)?video.currentTime:0;vscode.setState({activeItemId:item.itemId,activeSource:item.src,sequenceIndex:item.index,currentTime,wasPlaying:desiredPlayback,playAll:playAll&&canPlayAll});};
	const setPreviewState=(label,reloadAvailable)=>{const status=document.querySelector('.now span');if(status)status.textContent=label;if(reloadPreviewButton)reloadPreviewButton.hidden=!reloadAvailable;};
	const resume=()=>{if(!video)return;if(resumeTime>0&&video.readyState===0){loadingSource=true;persist();return;}loadingSource=false;if(resumeTime>0){const maximum=Number.isFinite(video.duration)&&video.duration>0?Math.max(0,video.duration-.01):resumeTime;video.currentTime=Math.min(resumeTime,maximum);resumeTime=0;}if(desiredPlayback){void video.play().catch(()=>{desiredPlayback=false;playAll=false;persist();});}persist();};
	const select=(index,play,time=0)=>{const item=playable[index];if(!item||!video)return;active=index;desiredPlayback=play;resumeTime=time;document.querySelectorAll('.clip').forEach(row=>row.classList.toggle('active',row.dataset.itemId===item.itemId));if(video.getAttribute('src')!==item.src){loadingSource=true;setPreviewState(text.loadingPreview,false);video.src=item.src;video.load();}else{resume();}document.querySelector('.now strong').textContent=item.title;persist();};
	document.querySelectorAll('[data-select]').forEach(button=>button.addEventListener('click',()=>{playAll=false;const index=Number(button.closest('.clip').dataset.playableIndex);if(index>=0)select(index,true,0);}));
	document.querySelector('[data-play-all]')?.addEventListener('click',()=>{playAll=true;select(0,true,0);});
	video?.addEventListener('ended',()=>{if(playAll&&active+1<playable.length){select(active+1,true);}else{desiredPlayback=false;playAll=false;persist();}});
	video?.addEventListener('loadedmetadata',()=>{setPreviewState(text.nowPlaying,false);resume();});
	video?.addEventListener('playing',()=>{desiredPlayback=true;persist();});
	video?.addEventListener('pause',()=>{if(!loadingSource&&!video.ended){desiredPlayback=false;playAll=false;persist();}});
	video?.addEventListener('timeupdate',()=>{const second=Math.floor(video.currentTime);if(second!==lastSavedSecond){lastSavedSecond=second;persist();}});
	video?.addEventListener('error',()=>{loadingSource=false;desiredPlayback=false;playAll=false;persist();setPreviewState(text.previewUnavailable,true);});
	reloadPreviewButton?.addEventListener('click',()=>{const item=playable[active];if(!video||!item)return;desiredPlayback=false;playAll=false;resumeTime=0;loadingSource=true;setPreviewState(text.loadingPreview,false);reloadExactPreview(video,item.src);persist();});
	document.querySelector('[data-add]')?.addEventListener('click',event=>{event.currentTarget.disabled=true;vscode.postMessage({type:'add'});});
	document.querySelector('[data-refresh]')?.addEventListener('click',()=>vscode.postMessage({type:'refresh'}));
	document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();const itemId=button.closest('.clip').dataset.itemId;const action=button.dataset.action;if(action==='navigate')vscode.postMessage({type:'navigate',itemId});else if(action==='move-up')vscode.postMessage({type:'move',itemId,direction:'up'});else if(action==='move-down')vscode.postMessage({type:'move',itemId,direction:'down'});else vscode.postMessage({type:action,itemId});}));
	if(active>=0){select(active,restored.shouldPlay,restored.currentTime);}`;
}

function styles(): string {
	return `:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:13px/1.45 var(--vscode-font-family);overflow:auto}button{font:inherit;color:inherit}main{width:min(920px,calc(100% - 48px));margin:0 auto;padding:34px 0 56px}header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:24px}h1{font-size:24px;line-height:1.2;margin:0 0 5px;font-weight:600}header p{margin:0;color:var(--vscode-descriptionForeground)}.header-actions,.actions{display:flex;align-items:center;gap:6px}.limit-note{margin:-8px 0 20px;padding:9px 11px;border-left:2px solid var(--vscode-inputValidation-warningBorder);background:var(--vscode-inputValidation-warningBackground);color:var(--vscode-descriptionForeground)}button{border:1px solid var(--vscode-button-border,transparent);border-radius:5px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:6px 10px;cursor:pointer}button:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button.primary:hover:not(:disabled){background:var(--vscode-button-hoverBackground)}button:disabled{cursor:default;opacity:.42}.player{border:1px solid var(--vscode-widget-border);border-radius:9px;background:var(--vscode-editorWidget-background);overflow:hidden;margin-bottom:28px}.player video{display:block;width:100%;max-height:480px;background:#000}.now{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border-top:1px solid var(--vscode-widget-border)}.now-copy{display:flex;gap:10px;min-width:0}.now-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.now span{color:var(--vscode-descriptionForeground)}.now button{flex:none;padding:4px 7px}.empty-player,.empty-list,.state{min-height:180px;display:flex;align-items:center;justify-content:center;color:var(--vscode-descriptionForeground)}.order h2{font-size:13px;margin:0 0 10px;font-weight:600}ol{list-style:none;margin:0;padding:0;border-top:1px solid var(--vscode-widget-border)}.clip{display:flex;align-items:center;min-height:58px;border-bottom:1px solid var(--vscode-widget-border);padding:6px 8px 6px 0}.clip.active{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.clip-main{display:flex;align-items:center;gap:12px;flex:1;min-width:0;border:0;background:transparent!important;text-align:left;padding:6px 10px;opacity:1}.index{width:24px;text-align:right;color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums}.copy{display:flex;flex-direction:column;min-width:0}.copy strong,.copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.copy strong{font-weight:550}.copy small{color:var(--vscode-descriptionForeground)}.actions{opacity:.74}.clip:hover .actions,.clip:focus-within .actions{opacity:1}.actions button{padding:4px 7px;background:transparent}.actions .quiet{color:var(--vscode-descriptionForeground)}.state{min-height:100vh;flex-direction:column;gap:10px;padding:32px;text-align:center}.state.error strong{color:var(--vscode-errorForeground)}@media(max-width:680px){main{width:calc(100% - 24px);padding-top:20px}header{align-items:flex-start;flex-direction:column}.clip{align-items:flex-start;flex-wrap:wrap}.actions{padding-left:46px;flex-wrap:wrap}}`;
}

function escape(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
	return escape(value).replace(/`/g, '&#96;');
}
