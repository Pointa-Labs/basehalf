/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname } from 'node:path';
import * as vscode from 'vscode';
import {
	MAX_SEQUENCE_ITEMS,
	MOVE_SEQUENCE_ITEM_COMMAND_ID,
	REMOVE_SEQUENCE_ITEM_COMMAND_ID,
	REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID,
	resolveAIVideoSequenceVideoNodePath,
	type AIVideoSequenceItemInspection
} from './domain';
import { addSequenceItemFromProjection, inspectLoadedSequence, loadSequence } from './sequenceCommands';
import { canPlayEntireSequence, reloadSequencePreview, resolveSequencePlaybackRestore, sequenceProjectionWindow, SequenceProjectionArtifactPaths, SequenceProjectionNodePaths, SequenceProjectionRefreshState, SequenceProjectionRenderQueue } from './sequenceProjectionRefresh';

export const SEQUENCE_PROJECTION_ID = 'pointa.basehalf-ai-video.sequence';
const MAX_SEQUENCE_PROJECTION_ITEMS = 200;

interface SequenceProjectionItem {
	readonly inspection: AIVideoSequenceItemInspection;
	readonly mediaResource?: vscode.Uri;
}

interface SequenceProjectionReadResult {
	readonly items: readonly SequenceProjectionItem[];
	readonly totalItems: number;
	readonly truncated: boolean;
	readonly nodeResourceKeys: readonly string[];
}

type SequenceProjectionMessage =
	| { readonly type: 'refresh' }
	| { readonly type: 'add' }
	| { readonly type: 'navigate'; readonly itemId: string }
	| { readonly type: 'move'; readonly itemId: string; readonly direction: 'up' | 'down' }
	| { readonly type: 'repair'; readonly itemId: string }
	| { readonly type: 'remove'; readonly itemId: string };

export async function resolveSequenceProjection(
	resource: vscode.Uri,
	view: vscode.basehalf.CardProjectionView,
	token: vscode.CancellationToken
): Promise<void> {
	const workspace = vscode.workspace.getWorkspaceFolder(resource);
	if (!workspace || workspace.uri.scheme !== 'file') {
		throw new Error('Sequence must be an ordinary file inside an open local workspace.');
	}
	view.webview.options = {
		enableScripts: true,
		localResourceRoots: [workspace.uri]
	};

	let renderGeneration = 0;
	let artifactEventGeneration = 0;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	let hasRendered = false;
	const projectionCancellation = new vscode.CancellationTokenSource();
	if (token.isCancellationRequested) {
		projectionCancellation.cancel();
	}
	const parentCancellation = token.onCancellationRequested(() => projectionCancellation.cancel());
	const refreshState = new SequenceProjectionRefreshState(view.visible);
	const artifactPaths = new SequenceProjectionArtifactPaths(MAX_SEQUENCE_ITEMS);
	const nodePaths = new SequenceProjectionNodePaths(MAX_SEQUENCE_ITEMS);
	const renderOnce = async (): Promise<void> => {
		const generation = ++renderGeneration;
		const artifactGenerationAtStart = artifactEventGeneration;
		if (!hasRendered) {
			view.webview.html = loadingDocument(view.webview);
		}
		try {
			const projection = await readProjectionItems(
				resource,
				projectionCancellation.token,
				resourceKeys => nodePaths.reconcile(resourceKeys)
			);
			if (projectionCancellation.token.isCancellationRequested || generation !== renderGeneration) {
				return;
			}
			nodePaths.reconcile(projection.nodeResourceKeys);
			artifactPaths.reconcile(projection.items.map(item => ({
				resultKey: sequenceResultKey(item.inspection),
				...(item.mediaResource ? { verifiedResourceKey: item.mediaResource.toString() } : {})
			})));
			view.webview.html = sequenceDocument(view.webview, projection.items, projection.totalItems, projection.truncated);
			hasRendered = true;
			if (artifactEventGeneration !== artifactGenerationAtStart) {
				scheduleRender(true);
			}
		} catch (error) {
			if (!projectionCancellation.token.isCancellationRequested && generation === renderGeneration) {
				view.webview.html = errorDocument(view.webview, error instanceof Error ? error.message : String(error));
			}
		}
	};
	const renderQueue = new SequenceProjectionRenderQueue(renderOnce);
	const render = (): Promise<void> => renderQueue.request();
	const scheduleRender = (automatic: boolean): void => {
		if (projectionCancellation.token.isCancellationRequested) {
			return;
		}
		if (automatic && !refreshState.markChanged()) {
			return;
		}
		if (refreshTimer) {
			clearTimeout(refreshTimer);
		}
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined;
			void render();
		}, 120);
	};
	const isTrackedDocument = (candidate: vscode.Uri): boolean => candidate.toString() === resource.toString()
		|| nodePaths.hasResource(candidate.toString());
	const sequenceWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(vscode.Uri.file(dirname(resource.fsPath)), basename(resource.fsPath))
	);
	const nodeWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, '**/*.bhnode'));
	const artifactWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, '**/*'));
	const onArtifactFileEvent = (candidate: vscode.Uri): void => {
		if (!artifactPaths.hasResource(candidate.toString())) {
			return;
		}
		artifactEventGeneration++;
		scheduleRender(true);
	};
	const refreshSubscriptions: vscode.Disposable[] = [
		sequenceWatcher,
		nodeWatcher,
		artifactWatcher,
		sequenceWatcher.onDidCreate(() => scheduleRender(true)),
		sequenceWatcher.onDidChange(() => scheduleRender(true)),
		sequenceWatcher.onDidDelete(() => scheduleRender(true)),
		nodeWatcher.onDidCreate(candidate => {
			if (isTrackedDocument(candidate)) {
				scheduleRender(true);
			}
		}),
		nodeWatcher.onDidChange(candidate => {
			if (isTrackedDocument(candidate)) {
				scheduleRender(true);
			}
		}),
		nodeWatcher.onDidDelete(candidate => {
			if (isTrackedDocument(candidate)) {
				scheduleRender(true);
			}
		}),
		artifactWatcher.onDidCreate(onArtifactFileEvent),
		artifactWatcher.onDidChange(onArtifactFileEvent),
		artifactWatcher.onDidDelete(onArtifactFileEvent),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (isTrackedDocument(event.document.uri)) {
				scheduleRender(true);
			}
		}),
		vscode.workspace.onDidSaveTextDocument(document => {
			if (isTrackedDocument(document.uri)) {
				scheduleRender(true);
			}
		}),
		vscode.workspace.onDidCreateFiles(event => {
			if (event.files.some(isTrackedDocument)) {
				scheduleRender(true);
			}
		}),
		vscode.workspace.onDidDeleteFiles(event => {
			if (event.files.some(isTrackedDocument)) {
				scheduleRender(true);
			}
		}),
		vscode.workspace.onDidRenameFiles(event => {
			const artifactChanged = event.files.some(entry => artifactPaths.hasResource(entry.oldUri.toString()) || artifactPaths.hasResource(entry.newUri.toString()));
			if (artifactChanged) {
				artifactEventGeneration++;
			}
			if (artifactChanged || event.files.some(entry => isTrackedDocument(entry.oldUri) || isTrackedDocument(entry.newUri))) {
				scheduleRender(true);
			}
		}),
		view.onDidChangeVisibility(() => {
			if (refreshState.setVisible(view.visible)) {
				scheduleRender(false);
			}
		}),
		parentCancellation
	];

	const messageSubscription = view.webview.onDidReceiveMessage(async raw => {
		try {
			const message = parseProjectionMessage(raw);
			if (message.type === 'refresh') {
				await render();
				return;
			}
			if (message.type === 'add') {
				try {
					await addSequenceItemFromProjection(resource);
				} finally {
					await render();
				}
				return;
			}
			const loaded = await loadSequence(resource);
			const item = loaded.sequence.items.find(candidate => candidate.id === message.itemId);
			if (!item) {
				throw new Error('This clip is no longer in the Sequence.');
			}
			if (message.type === 'navigate') {
				const nodeResource = vscode.Uri.file(resolveAIVideoSequenceVideoNodePath(resource.fsPath, item.videoNodePath));
				await vscode.commands.executeCommand('basehalf.openResource', nodeResource);
				return;
			}
			if (message.type === 'move') {
				await vscode.commands.executeCommand(MOVE_SEQUENCE_ITEM_COMMAND_ID, { sequence: resource, itemId: message.itemId, direction: message.direction });
			} else if (message.type === 'repair') {
				await vscode.commands.executeCommand(REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID, { sequence: resource, itemId: message.itemId });
			} else {
				await vscode.commands.executeCommand(REMOVE_SEQUENCE_ITEM_COMMAND_ID, { sequence: resource, itemId: message.itemId });
			}
			await render();
		} catch (error) {
			void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
		}
	});
	const disposeSubscription = view.onDidDispose(() => {
		projectionCancellation.cancel();
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = undefined;
		}
		for (const subscription of refreshSubscriptions) {
			subscription.dispose();
		}
		renderGeneration++;
		artifactPaths.clear();
		nodePaths.clear();
		renderQueue.dispose();
		messageSubscription.dispose();
		disposeSubscription.dispose();
		projectionCancellation.dispose();
	});
	await render();
}

async function readProjectionItems(
	resource: vscode.Uri,
	token: vscode.CancellationToken,
	onNodeResourcesLoaded: (resourceKeys: readonly string[]) => void
): Promise<SequenceProjectionReadResult> {
	const loaded = await loadSequence(resource);
	if (token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
	const projection = sequenceProjectionWindow(loaded.sequence.items, MAX_SEQUENCE_PROJECTION_ITEMS);
	const nodeResourceKeys = loaded.sequence.items.map(item =>
		vscode.Uri.file(resolveAIVideoSequenceVideoNodePath(resource.fsPath, item.videoNodePath)).toString());
	onNodeResourcesLoaded(nodeResourceKeys);
	if (token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
	const inspection = await inspectLoadedSequence({
		...loaded,
		sequence: Object.freeze({ ...loaded.sequence, items: projection.items })
	}, token);
	const items: SequenceProjectionItem[] = [];
	for (const inspected of inspection.items) {
		if (token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		const candidateResource = inspected.artifact?.resource;
		const mediaResource = candidateResource instanceof vscode.Uri ? candidateResource : undefined;
		items.push(Object.freeze({ inspection: inspected, ...(mediaResource ? { mediaResource } : {}) }));
	}
	return Object.freeze({
		items: Object.freeze(items),
		totalItems: projection.totalItems,
		truncated: projection.truncated,
		nodeResourceKeys: Object.freeze(nodeResourceKeys)
	});
}

function parseProjectionMessage(value: unknown): SequenceProjectionMessage {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('The Sequence action is invalid.');
	}
	const record = value as Record<string, unknown>;
	if (record.type === 'refresh' && Object.keys(record).length === 1) {
		return { type: 'refresh' };
	}
	if (record.type === 'add' && Object.keys(record).length === 1) {
		return { type: 'add' };
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

function loadingDocument(webview: vscode.Webview): string {
	return shellDocument(webview, '<main class="state">Loading playback order…</main>', '');
}

function errorDocument(webview: vscode.Webview, message: string): string {
	return shellDocument(webview, `<main class="state error"><strong>Sequence could not be opened</strong><span>${escapeHtml(message)}</span><button data-refresh>Try again</button></main>`, refreshScript());
}

function sequenceDocument(webview: vscode.Webview, items: readonly SequenceProjectionItem[], totalItems: number, truncated: boolean): string {
	const playable = items.map((item, index) => item.mediaResource ? {
		index,
		itemId: item.inspection.item.id,
		title: item.inspection.item.title,
		src: webview.asWebviewUri(item.mediaResource).toString()
	} : undefined).filter((item): item is NonNullable<typeof item> => !!item);
	const playableIndexByItemId = new Map(playable.map((item, index) => [item.itemId, index]));
	const canPlayAll = !truncated && canPlayEntireSequence(totalItems, playable.length);
	const playAllLabel = totalItems === 0
		? 'Add clips before playing the saved order'
		: truncated
			? `Only the first ${items.length} clips are shown; shorten the Sequence to play the complete order`
			: canPlayAll
			? 'Play the complete saved order'
			: 'Resolve unavailable clips before playing the saved order';
	const first = playable[0];
	const rows = items.map((item, index) => {
		const state = stateLabel(item.inspection);
		const playableIndex = playableIndexByItemId.get(item.inspection.item.id) ?? -1;
		return `<li class="clip${playableIndex === 0 ? ' active' : ''}" data-item-id="${escapeAttribute(item.inspection.item.id)}" data-playable-index="${playableIndex}">
			<button class="clip-main" data-select ${playableIndex < 0 ? 'disabled' : ''} aria-label="Play ${escapeAttribute(item.inspection.item.title)}">
				<span class="index">${index + 1}</span><span class="copy"><strong>${escapeHtml(item.inspection.item.title)}</strong><small>${escapeHtml(state)}</small></span>
			</button>
			<div class="actions" aria-label="Actions for ${escapeAttribute(item.inspection.item.title)}">
				<button title="Open source node" data-action="navigate">Open</button>
				<button title="Move earlier" data-action="move-up" ${index === 0 ? 'disabled' : ''}>↑</button>
				<button title="Move later" data-action="move-down" ${index === totalItems - 1 ? 'disabled' : ''}>↓</button>
				${item.inspection.repairCandidatePath ? '<button data-action="repair">Repair</button>' : ''}
				<button class="quiet" title="Remove from playback order" data-action="remove">Remove</button>
			</div>
		</li>`;
	}).join('');
	const content = `<main>
		<header><div><h1>Sequence</h1><p>${totalItems} ${totalItems === 1 ? 'clip' : 'clips'} · sealed Video Results</p></div><div class="header-actions"><button data-add>Add clip</button><button class="primary" data-play-all title="${escapeAttribute(playAllLabel)}" aria-label="${escapeAttribute(playAllLabel)}" ${canPlayAll ? '' : 'disabled'}>Play all</button></div></header>
		${truncated ? `<p class="limit-note">Showing the first ${items.length} clips. Open the local Sequence file to manage the remaining ${totalItems - items.length}.</p>` : ''}
		<section class="player" aria-label="Active clip">
			${first ? `<video controls preload="metadata" src="${escapeAttribute(first.src)}"></video><div class="now"><div class="now-copy" aria-live="polite"><span>Now playing</span><strong>${escapeHtml(first.title)}</strong></div><button data-reload-preview hidden title="Reload this sealed Video Result without running a model">Reload preview</button></div>` : '<div class="empty-player">No sealed Video Result is ready to play.</div>'}
		</section>
		<section class="order"><h2>Playback order</h2>${totalItems > 0 ? `<ol>${rows}</ol>` : '<div class="empty-list">Add a Video Result to define playback order.</div>'}</section>
	</main>`;
	return shellDocument(webview, content, sequenceScript(playable, canPlayAll));
}

function stateLabel(item: AIVideoSequenceItemInspection): string {
	if (item.state === 'result') {
		return 'Sealed Video Result';
	}
	return item.message;
}

function shellDocument(webview: vscode.Webview, content: string, script: string): string {
	const nonce = randomNonce();
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">${styles()}</style></head><body>${content}<script nonce="${nonce}">${script}</script></body></html>`;
}

function refreshScript(): string {
	return `const vscode=acquireVsCodeApi();document.querySelector('[data-refresh]')?.addEventListener('click',()=>vscode.postMessage({type:'refresh'}));`;
}

function sequenceScript(playable: readonly { readonly index: number; readonly itemId: string; readonly title: string; readonly src: string }[], canPlayAll: boolean): string {
	const data = JSON.stringify(playable).replace(/</g, '\\u003c');
	return `const vscode=acquireVsCodeApi();const playable=${data};const canPlayAll=${JSON.stringify(canPlayAll)};const video=document.querySelector('video');const reloadPreviewButton=document.querySelector('[data-reload-preview]');const reloadExactPreview=${reloadSequencePreview.toString()};const resolveRestore=${resolveSequencePlaybackRestore.toString()};const restored=resolveRestore(playable,vscode.getState());let active=restored.playableIndex;let playAll=restored.playAll&&canPlayAll;let desiredPlayback=restored.shouldPlay;let resumeTime=restored.currentTime;let loadingSource=false;let lastSavedSecond=-1;
	const persist=()=>{const item=playable[active];if(!item)return;const currentTime=loadingSource?resumeTime:video&&Number.isFinite(video.currentTime)?video.currentTime:0;vscode.setState({activeItemId:item.itemId,activeSource:item.src,sequenceIndex:item.index,currentTime,wasPlaying:desiredPlayback,playAll:playAll&&canPlayAll});};
	const setPreviewState=(label,reloadAvailable)=>{const status=document.querySelector('.now span');if(status)status.textContent=label;if(reloadPreviewButton)reloadPreviewButton.hidden=!reloadAvailable;};
	const resume=()=>{if(!video)return;if(resumeTime>0&&video.readyState===0){loadingSource=true;persist();return;}loadingSource=false;if(resumeTime>0){const maximum=Number.isFinite(video.duration)&&video.duration>0?Math.max(0,video.duration-.01):resumeTime;video.currentTime=Math.min(resumeTime,maximum);resumeTime=0;}if(desiredPlayback){void video.play().catch(()=>{desiredPlayback=false;playAll=false;persist();});}persist();};
	const select=(index,play,time=0)=>{const item=playable[index];if(!item||!video)return;active=index;desiredPlayback=play;resumeTime=time;document.querySelectorAll('.clip').forEach(row=>row.classList.toggle('active',row.dataset.itemId===item.itemId));if(video.getAttribute('src')!==item.src){loadingSource=true;setPreviewState('Loading preview',false);video.src=item.src;video.load();}else{resume();}document.querySelector('.now strong').textContent=item.title;persist();};
	document.querySelectorAll('[data-select]').forEach(button=>button.addEventListener('click',()=>{playAll=false;const index=Number(button.closest('.clip').dataset.playableIndex);if(index>=0)select(index,true,0);}));
	document.querySelector('[data-play-all]')?.addEventListener('click',()=>{playAll=true;select(0,true,0);});
	video?.addEventListener('ended',()=>{if(playAll&&active+1<playable.length){select(active+1,true);}else{desiredPlayback=false;playAll=false;persist();}});
	video?.addEventListener('loadedmetadata',()=>{setPreviewState('Now playing',false);resume();});
	video?.addEventListener('playing',()=>{desiredPlayback=true;persist();});
	video?.addEventListener('pause',()=>{if(!loadingSource&&!video.ended){desiredPlayback=false;playAll=false;persist();}});
	video?.addEventListener('timeupdate',()=>{const second=Math.floor(video.currentTime);if(second!==lastSavedSecond){lastSavedSecond=second;persist();}});
	video?.addEventListener('error',()=>{loadingSource=false;desiredPlayback=false;playAll=false;persist();setPreviewState('Preview unavailable',true);});
	reloadPreviewButton?.addEventListener('click',()=>{const item=playable[active];if(!video||!item)return;desiredPlayback=false;playAll=false;resumeTime=0;loadingSource=true;setPreviewState('Loading preview',false);reloadExactPreview(video,item.src);persist();});
	document.querySelector('[data-add]')?.addEventListener('click',event=>{event.currentTarget.disabled=true;vscode.postMessage({type:'add'});});
	document.querySelector('[data-refresh]')?.addEventListener('click',()=>vscode.postMessage({type:'refresh'}));
	document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();const itemId=button.closest('.clip').dataset.itemId;const action=button.dataset.action;if(action==='navigate')vscode.postMessage({type:'navigate',itemId});else if(action==='move-up')vscode.postMessage({type:'move',itemId,direction:'up'});else if(action==='move-down')vscode.postMessage({type:'move',itemId,direction:'down'});else vscode.postMessage({type:action,itemId});}));
	if(active>=0){select(active,restored.shouldPlay,restored.currentTime);}`;
}

function sequenceResultKey(item: AIVideoSequenceItemInspection): string {
	return [item.item.id, item.item.nodeId, item.item.videoNodePath].join('\u0000');
}

function styles(): string {
	return `:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:13px/1.45 var(--vscode-font-family);overflow:auto}button{font:inherit;color:inherit}main{width:min(920px,calc(100% - 48px));margin:0 auto;padding:34px 0 56px}header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:24px}h1{font-size:24px;line-height:1.2;margin:0 0 5px;font-weight:600}header p{margin:0;color:var(--vscode-descriptionForeground)}.header-actions,.actions{display:flex;align-items:center;gap:6px}.limit-note{margin:-8px 0 20px;padding:9px 11px;border-left:2px solid var(--vscode-inputValidation-warningBorder);background:var(--vscode-inputValidation-warningBackground);color:var(--vscode-descriptionForeground)}button{border:1px solid var(--vscode-button-border,transparent);border-radius:5px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:6px 10px;cursor:pointer}button:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button.primary:hover:not(:disabled){background:var(--vscode-button-hoverBackground)}button:disabled{cursor:default;opacity:.42}.player{border:1px solid var(--vscode-widget-border);border-radius:9px;background:var(--vscode-editorWidget-background);overflow:hidden;margin-bottom:28px}.player video{display:block;width:100%;max-height:480px;background:#000}.now{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border-top:1px solid var(--vscode-widget-border)}.now-copy{display:flex;gap:10px;min-width:0}.now-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.now span{color:var(--vscode-descriptionForeground)}.now button{flex:none;padding:4px 7px}.empty-player,.empty-list,.state{min-height:180px;display:flex;align-items:center;justify-content:center;color:var(--vscode-descriptionForeground)}.order h2{font-size:13px;margin:0 0 10px;font-weight:600}ol{list-style:none;margin:0;padding:0;border-top:1px solid var(--vscode-widget-border)}.clip{display:flex;align-items:center;min-height:58px;border-bottom:1px solid var(--vscode-widget-border);padding:6px 8px 6px 0}.clip.active{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.clip-main{display:flex;align-items:center;gap:12px;flex:1;min-width:0;border:0;background:transparent!important;text-align:left;padding:6px 10px;opacity:1}.index{width:24px;text-align:right;color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums}.copy{display:flex;flex-direction:column;min-width:0}.copy strong,.copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.copy strong{font-weight:550}.copy small{color:var(--vscode-descriptionForeground)}.actions{opacity:.74}.clip:hover .actions,.clip:focus-within .actions{opacity:1}.actions button{padding:4px 7px;background:transparent}.actions .quiet{color:var(--vscode-descriptionForeground)}.state{min-height:100vh;flex-direction:column;gap:10px;padding:32px;text-align:center}.state.error strong{color:var(--vscode-errorForeground)}@media(max-width:680px){main{width:calc(100% - 24px);padding-top:20px}header{align-items:flex-start;flex-direction:column}.clip{align-items:flex-start;flex-wrap:wrap}.actions{padding-left:46px;flex-wrap:wrap}}`;
}

function randomNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let index = 0; index < 32; index++) {
		value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	}
	return value;
}

function escapeHtml(value: string): string {
	// eslint-disable-next-line local/code-no-unexternalized-strings -- HTML entities are protocol data.
	return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": "&#39;" })[character]!);
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/`/g, '&#96;');
}
