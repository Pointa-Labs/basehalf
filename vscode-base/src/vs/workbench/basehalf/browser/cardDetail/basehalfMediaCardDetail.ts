/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { safeIntl } from '../../../../base/common/date.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { FileAccess } from '../../../../base/common/network.js';
import { language } from '../../../../base/common/platform.js';
import { basename, dirname, extname, isEqual, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { FileChangeType, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWebviewElement, IWebviewService, WebviewContentPurpose } from '../../../contrib/webview/browser/webview.js';
import { asWebviewUri, webviewGenericCspSource } from '../../../contrib/webview/common/webview.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';
import { BaseHalfRenderableContentKind, baseHalfRenderableContentKind } from '../../common/basehalfContentRendering.js';
import { baseHalfPdfSelectionFromMessage, baseHalfPdfViewStateFromMessage, IBaseHalfPdfSelection, IBaseHalfPdfViewState, isBaseHalfPdfUserInteractionMessage, normalizeBaseHalfPdfViewState } from '../../common/basehalfMediaViewState.js';
import { formatBaseHalfVideoElapsed } from '../../common/basehalfVideoCardPresentation.js';
import { IBaseHalfNodeResult, normalizeBaseHalfVideoResultGeneration } from '../../common/basehalfVideoNode.js';
import { baseHalfVideoPanelDurationLabel, baseHalfVideoPanelModeLabel, baseHalfVideoPanelRatioLabel, baseHalfVideoPanelSoundLabel } from '../../common/basehalfVideoNodePanelPresentation.js';
import {
	BaseHalfVideoInputKind,
	baseHalfVideoInputKindOfPath,
	baseHalfVideoInputLabel,
	baseHalfVideoModelLabel,
	getBaseHalfVideoProviderPreset
} from '../../common/basehalfVideoProviders.js';
import '../media/basehalfVideoNode.css';

const contentViewerMediaRoot = FileAccess.asFileUri('vs/../../extensions/basehalf/content-viewer-out');
const pdfViewerScript = URI.joinPath(contentViewerMediaRoot, 'pdfViewer.js');
const pdfiumWasm = URI.joinPath(contentViewerMediaRoot, 'pdfium.wasm');
const simplifiedChinesePdfFont = URI.joinPath(contentViewerMediaRoot, 'NotoSansHans-Regular.otf');
const PDF_VIEW_STATE_STORAGE_PREFIX = 'basehalf.pdfViewState.';

export function baseHalfMediaKind(resource: URI): BaseHalfRenderableContentKind | undefined {
	return baseHalfRenderableContentKind(resource);
}

/** The Video nodes whose videos were opened in Card Detail in this window, by video. */
const videoNodes = new ResourceMap<URI>();
const MAX_REMEMBERED_VIDEO_NODES = 64;
/** The most node documents Card Detail reads to find the node that holds a video. */
const MAX_NODES_SEARCHED = 200;
const NODE_DOCUMENT_MAX_BYTES = 1024 * 1024;

/**
 * Tells Card Detail which Video node holds `video`, so it can say what made
 * the video. The workbench calls it when it opens a node's video; otherwise
 * Card Detail looks for the node in the folder the canvas shows.
 */
export function rememberBaseHalfVideoDetailNode(video: URI, node: URI): void {
	videoNodes.delete(video);
	videoNodes.set(video, node);
	while (videoNodes.size > MAX_REMEMBERED_VIDEO_NODES) {
		const oldest = videoNodes.keys().next().value;
		if (!oldest) {
			break;
		}
		videoNodes.delete(oldest);
	}
}

export interface IBaseHalfVideoProvenanceRow {
	readonly label: string;
	readonly value: string;
}

export interface IBaseHalfVideoProvenanceInput {
	/** Such as `Image 1`, or `Text` for a note whose text joined the prompt. */
	readonly name: string;
	readonly path: string;
}

/** What made a node's video, as Card Detail shows it below the video. */
export interface IBaseHalfVideoProvenance {
	readonly heading: string;
	readonly rows: readonly IBaseHalfVideoProvenanceRow[];
	readonly inputs: readonly IBaseHalfVideoProvenanceInput[];
}

/**
 * What made a video: for a generated one, the model, the provider, the mode,
 * the settings, the prompt, the inputs in order, and when it started and
 * finished; for an imported one, that it was imported. `kindOf` tells the
 * kind of an input, so inputs are named as the prompt names them.
 */
export function baseHalfVideoProvenance(
	result: IBaseHalfNodeResult,
	kindOf: (path: string) => BaseHalfVideoInputKind = baseHalfVideoInputKindOfPath,
	displayLanguage: string = language
): IBaseHalfVideoProvenance {
	if (result.source === 'imported') {
		return Object.freeze({
			heading: localize('basehalf.video.detail.imported', "Imported"),
			rows: Object.freeze([
				Object.freeze({ label: localize('basehalf.video.detail.source', "Source"), value: localize('basehalf.video.detail.importedValue', "This video was imported into the node.") }),
				Object.freeze({ label: localize('basehalf.video.detail.file', "File"), value: result.artifact.path })
			]),
			inputs: Object.freeze([])
		});
	}
	const generation = result.generation;
	const request = generation.request;
	const modelLabel = baseHalfVideoModelLabel(request.model);
	const settings = [
		baseHalfVideoPanelRatioLabel(request.ratio),
		request.resolution,
		baseHalfVideoPanelDurationLabel(request.duration),
		baseHalfVideoPanelSoundLabel(request.audio)
	].join(' · ');
	const started = Date.parse(generation.startedAt);
	const completed = Date.parse(generation.completedAt);
	const format = safeIntl.DateTimeFormat(displayLanguage, { dateStyle: 'medium', timeStyle: 'medium' }).value;
	const time = (value: number, fallback: string) => Number.isFinite(value) ? format.format(new Date(value)) : fallback;
	const ordinals = { image: 0, video: 0, audio: 0 };
	const inputs = request.inputs.map((path): IBaseHalfVideoProvenanceInput => {
		const kind = kindOf(path);
		const name = kind === 'image' || kind === 'video' || kind === 'audio'
			? baseHalfVideoInputLabel(kind, ++ordinals[kind], displayLanguage)
			: kind === 'text'
				? localize('basehalf.video.detail.textInput', "Text")
				: localize('basehalf.video.detail.otherInput', "Input");
		return Object.freeze({ name, path });
	});
	const rows: IBaseHalfVideoProvenanceRow[] = [
		{ label: localize('basehalf.video.detail.model', "Model"), value: modelLabel === request.model ? modelLabel : `${modelLabel} (${request.model})` },
		{ label: localize('basehalf.video.detail.provider', "Provider"), value: getBaseHalfVideoProviderPreset(request.provider).label },
		{ label: localize('basehalf.video.detail.mode', "Mode"), value: baseHalfVideoPanelModeLabel(request.mode) },
		{ label: localize('basehalf.video.detail.settings', "Settings"), value: settings },
		{ label: localize('basehalf.video.detail.prompt', "Prompt"), value: request.prompt.trim() || localize('basehalf.video.detail.noPrompt', "No prompt") },
		{ label: localize('basehalf.video.detail.started', "Started"), value: time(started, generation.startedAt) },
		{
			label: localize('basehalf.video.detail.finished', "Finished"),
			value: Number.isFinite(started) && Number.isFinite(completed) && completed >= started
				? localize('basehalf.video.detail.finishedAfter', "{0}, after {1}", time(completed, generation.completedAt), formatBaseHalfVideoElapsed(completed - started))
				: time(completed, generation.completedAt)
		}
	];
	return Object.freeze({
		heading: localize('basehalf.video.detail.generated', "Generated"),
		rows: Object.freeze(rows.map(row => Object.freeze(row))),
		inputs: Object.freeze(inputs)
	});
}

/** Read-only local content projection built on VS Code's isolated webview. */
export class BaseHalfMediaCardDetail extends Disposable {
	private readonly root: HTMLElement;
	private readonly webviewHost: HTMLElement;
	private state: IBaseHalfCardDetailState | undefined;
	private webview: IWebviewElement | undefined;
	private disposed = false;
	private renderVersion = 0;
	private pdfViewState: IBaseHalfPdfViewState | undefined;
	private pdfBranchPending = false;

	constructor(
		container: HTMLElement,
		private readonly createPdfBranch: (resource: URI, selection: IBaseHalfPdfSelection) => Promise<void>,
		private readonly onPdfUserInteraction: () => void,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService
	) {
		super();
		this.root = append(container, $('.basehalf-card-detail-media'));
		this.webviewHost = append(this.root, $('.basehalf-card-detail-media-webview'));
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.state = state;
		const kind = baseHalfMediaKind(state.resource);
		if (!kind) {
			this.renderNotice('No media projection is available for this file type.');
			return;
		}

		try {
			await this.fileService.stat(state.resource);
			if (this.disposed || this.state?.resource.toString() !== state.resource.toString()) {
				return;
			}

			this.pdfViewState = kind === 'pdf' ? this.readPdfViewState(state.resource) : undefined;
			this.webview = this._register(this.webviewService.createWebviewElement({
				providedViewType: 'basehalf.media',
				title: state.relativePath || state.resource.path,
				options: {
					purpose: WebviewContentPurpose.CustomEditor,
					retainContextWhenHidden: true
				},
				contentOptions: {
					allowScripts: true,
					allowForms: false,
					localResourceRoots: [dirname(state.resource), contentViewerMediaRoot]
				},
				extension: undefined
			}));
			this.webview.mountTo(this.webviewHost, mainWindow);
			this._register(this.webview.onMessage(event => this.handleWebviewMessage(kind, state.resource, event.message)));
			this.renderWebview(kind);
			if (kind === 'video') {
				void this.renderVideoProvenance(state);
			}
			this._register(this.webview.onFatalError(error => {
				this.logService.error(`[BaseHalf] media webview failed: ${error.message}`);
			}));
			this._register(this.fileService.onDidFilesChange(event => {
				if (event.contains(state.resource, FileChangeType.DELETED)) {
					this.renderNotice('This media file no longer exists.');
					return;
				}
				if (event.contains(state.resource, FileChangeType.UPDATED, FileChangeType.ADDED)) {
					this.renderWebview(kind);
				}
			}));
			await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
		} catch (error) {
			if (!this.disposed) {
				this.logService.error('[BaseHalf] media projection failed to open', error);
				this.renderNotice('The media file could not be opened.');
			}
		}
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}

	activate(state: IBaseHalfCardDetailState): void {
		this.state = state;
	}

	applySelection(): void { }

	/** The isolated webview retains its own context while hidden; nothing to
	 *  suspend or resume. */
	setVisible(_visible: boolean): void { }

	focus(): void {
		this.webview?.focus();
	}

	private renderWebview(kind: BaseHalfRenderableContentKind): void {
		const webview = this.webview;
		const state = this.state;
		if (!webview || !state) {
			return;
		}
		const version = ++this.renderVersion;
		// EmbedPDF fetches the resource from inside the webview before handing
		// bytes to PDFium. Keep that URI identical to the file URI: the
		// webview resource loader treats synthetic queries as a different local
		// resource. Image/media elements can keep a cache-busting version.
		const resource = kind === 'pdf' ? state.resource : state.resource.with({
			query: [state.resource.query, `basehalfMediaVersion=${version}`].filter(Boolean).join('&')
		});
		webview.setHtml(baseHalfMediaWebviewHtml(
			kind,
			resource,
			pdfViewerScript,
			pdfiumWasm,
			this.pdfViewState,
			simplifiedChinesePdfFont
		));
	}

	private handleWebviewMessage(kind: BaseHalfRenderableContentKind, resource: URI, message: unknown): void {
		if (kind !== 'pdf') {
			return;
		}
		if (isBaseHalfPdfUserInteractionMessage(message)) {
			this.onPdfUserInteraction();
			return;
		}

		const state = baseHalfPdfViewStateFromMessage(message);
		if (state) {
			this.pdfViewState = state;
			this.storageService.store(this.pdfViewStateStorageKey(resource), state, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}

		const selection = baseHalfPdfSelectionFromMessage(message);
		if (selection && !this.pdfBranchPending) {
			this.pdfBranchPending = true;
			void this.createPdfBranch(resource, selection).catch(error => {
				this.logService.error('[BaseHalf] failed to grow a branch from PDF selection', error);
				this.notificationService.error(localize(
					'basehalf.pdf.branch.failed',
					"Could not grow a note from the PDF selection: {0}",
					getErrorMessage(error)
				));
			}).finally(() => {
				this.pdfBranchPending = false;
			});
		}
	}

	private readPdfViewState(resource: URI): IBaseHalfPdfViewState {
		return normalizeBaseHalfPdfViewState(this.storageService.getObject(this.pdfViewStateStorageKey(resource), StorageScope.WORKSPACE));
	}

	private pdfViewStateStorageKey(resource: URI): string {
		return `${PDF_VIEW_STATE_STORAGE_PREFIX}${resource.toString()}`;
	}

	private renderNotice(message: string): void {
		this.webview?.dispose();
		this.webview = undefined;
		clearNode(this.webviewHost);
		const notice = append(this.webviewHost, $('.basehalf-card-detail-source-notice'));
		notice.textContent = message;
	}

	/** Below a node's video: what made it. A video that no Video node holds shows nothing more. */
	private async renderVideoProvenance(state: IBaseHalfCardDetailState): Promise<void> {
		let result: IBaseHalfNodeResult | undefined;
		try {
			result = await this.findVideoResult(state);
		} catch (error) {
			this.logService.warn('[BaseHalf] Card Detail could not find what made a video', error);
		}
		if (!result || this.disposed || this.state?.resource.toString() !== state.resource.toString()) {
			return;
		}
		const kinds = new Map<string, BaseHalfVideoInputKind>();
		if (result.source === 'generated') {
			for (const path of result.generation.request.inputs) {
				kinds.set(path, await this.inputKind(state.workspaceFolder, path));
			}
		}
		if (this.disposed) {
			return;
		}
		const provenance = baseHalfVideoProvenance(result, path => kinds.get(path) ?? baseHalfVideoInputKindOfPath(path));
		this.root.classList.add('has-video-provenance');
		const section = append(this.root, $('section.bh-video-provenance'));
		section.setAttribute('aria-label', localize('basehalf.video.detail.label', "What made this video"));
		append(section, $('h2.bh-video-provenance-title')).textContent = provenance.heading;
		const rows = append(section, $('dl.bh-video-provenance-rows'));
		for (const row of provenance.rows) {
			append(rows, $('dt')).textContent = row.label;
			append(rows, $('dd')).textContent = row.value;
		}
		if (provenance.inputs.length) {
			append(rows, $('dt')).textContent = localize('basehalf.video.detail.inputs', "Inputs");
			const list = append(append(rows, $('dd')), $('ol.bh-video-provenance-inputs'));
			for (const input of provenance.inputs) {
				const item = append(list, $('li'));
				append(item, $('span.bh-video-provenance-input-name')).textContent = input.name;
				append(item, $('span.bh-video-provenance-input-path')).textContent = input.path;
			}
		}
	}

	/** The result of the Video node whose video this is: the node the workbench named, or one in the folder the canvas shows. */
	private async findVideoResult(state: IBaseHalfCardDetailState): Promise<IBaseHalfNodeResult | undefined> {
		const remembered = videoNodes.get(state.resource);
		if (remembered) {
			const result = await this.readVideoResult(remembered, state.relativePath);
			if (result) {
				return result;
			}
		}
		const folders: URI[] = [];
		const canvasFolder = this.canvasNavigationService.state.canvasFolder;
		if (canvasFolder && isEqual(canvasFolder.workspaceFolder, state.workspaceFolder)) {
			folders.push(canvasFolder.resource);
		}
		const own = dirname(state.resource);
		if (!folders.some(folder => isEqual(folder, own))) {
			folders.push(own);
		}
		let searched = 0;
		for (const folder of folders) {
			const children = (await this.fileService.resolve(folder)).children ?? [];
			for (const child of children) {
				if (child.isDirectory || extname(child.resource).toLowerCase() !== '.bhnode') {
					continue;
				}
				if (++searched > MAX_NODES_SEARCHED) {
					return undefined;
				}
				const result = await this.readVideoResult(child.resource, state.relativePath);
				if (result) {
					rememberBaseHalfVideoDetailNode(state.resource, child.resource);
					return result;
				}
			}
		}
		return undefined;
	}

	/** The result of a Video node when it is the video at `videoPath`. */
	private async readVideoResult(node: URI, videoPath: string): Promise<IBaseHalfNodeResult | undefined> {
		const document = await this.readNodeDocument(node);
		const result = document?.kind === 'video' && isRecord(document.result) ? document.result : undefined;
		const artifact = result && isRecord(result.artifact) ? result.artifact : undefined;
		if (!result || !artifact || artifact.path !== videoPath || typeof artifact.kind !== 'string' || typeof artifact.size !== 'number') {
			return undefined;
		}
		const file = Object.freeze({ kind: artifact.kind, path: videoPath, size: artifact.size });
		if (result.source === 'imported') {
			return Object.freeze({ source: 'imported', artifact: file });
		}
		if (result.source !== 'generated') {
			return undefined;
		}
		try {
			return Object.freeze({ source: 'generated', artifact: file, generation: normalizeBaseHalfVideoResultGeneration(result.generation) });
		} catch {
			return undefined;
		}
	}

	/** The kind of an input: by its extension, or for a node by the file it shows. */
	private async inputKind(workspaceFolder: URI, path: string): Promise<BaseHalfVideoInputKind> {
		if (!path.toLowerCase().endsWith('.bhnode')) {
			return baseHalfVideoInputKindOfPath(path);
		}
		const document = await this.readNodeDocument(joinPath(workspaceFolder, ...path.split('/')));
		const artifact = document && isRecord(document.result) && isRecord(document.result.artifact) ? document.result.artifact : undefined;
		const kind = artifact?.kind;
		return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'other';
	}

	private async readNodeDocument(node: URI): Promise<Record<string, unknown> | undefined> {
		try {
			const content = await this.fileService.readFile(node, { limits: { size: NODE_DOCUMENT_MAX_BYTES } });
			const value: unknown = JSON.parse(content.value.toString());
			return isRecord(value) ? value : undefined;
		} catch {
			return undefined;
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function baseHalfMediaWebviewHtml(kind: BaseHalfRenderableContentKind, resource: URI, viewerScript = pdfViewerScript, wasm = pdfiumWasm, pdfViewState?: IBaseHalfPdfViewState, fontSc = simplifiedChinesePdfFont): string {
	const nonce = generateUuid();
	const source = escapeAttribute(asWebviewUri(resource).toString(true));
	if (kind === 'pdf') {
		return baseHalfPdfWebviewHtml(
			source,
			asWebviewUri(viewerScript).toString(true),
			asWebviewUri(wasm).toString(true),
			asWebviewUri(fontSc).toString(true),
			nonce,
			normalizeBaseHalfPdfViewState(pdfViewState),
			basename(resource),
			baseHalfPdfLocale(language),
			localize('basehalf.pdf.branch.action', "Grow branch")
		);
	}
	const resourceName = escapeAttribute(basename(resource));
	const media = kind === 'image'
		? `<div class="image-stage" id="stage"><img id="media" src="${source}" alt="${resourceName}"></div>
			<div class="toolbar" role="toolbar" aria-label="Image zoom">
				<button type="button" data-action="out" aria-label="Zoom out">−</button>
				<button type="button" data-action="fit">Fit</button>
				<button type="button" data-action="actual">100%</button>
				<button type="button" data-action="in" aria-label="Zoom in">+</button>
			</div>`
		: kind === 'video'
			? `<video id="media" src="${source}" controls></video>`
			: `<audio id="media" src="${source}" controls></audio>`;
	const imageScript = kind === 'image' ? `
		const image = media;
		const stage = document.getElementById('stage');
		let scale = 1;
		let fitted = true;
		const apply = () => {
			image.classList.toggle('fit', fitted);
			image.style.width = fitted ? '' : Math.max(1, image.naturalWidth * scale) + 'px';
			image.style.height = fitted ? '' : 'auto';
			stage.classList.toggle('scaled', !fitted);
		};
		document.querySelector('.toolbar').addEventListener('click', event => {
			const action = event.target && event.target.dataset && event.target.dataset.action;
			if (!action) { return; }
			if (action === 'fit') { fitted = true; }
			if (action === 'actual') { fitted = false; scale = 1; }
			if (action === 'in') { fitted = false; scale = Math.min(8, scale * 1.25); }
			if (action === 'out') { fitted = false; scale = Math.max(0.1, scale / 1.25); }
			apply();
		});
		image.addEventListener('load', apply);
		apply();` : '';
	const script = `<script nonce="${nonce}">
		const media = document.getElementById('media');
		const error = document.getElementById('error');
		media.addEventListener('error', () => {
			error.hidden = false;
			media.hidden = true;
			document.querySelector('.toolbar')?.setAttribute('hidden', '');
		});
		${imageScript}
	</script>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webviewGenericCspSource}; media-src ${webviewGenericCspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
		body { display: flex; align-items: center; justify-content: center; font-family: var(--vscode-font-family); }
		video { width: min(100%, 1280px); height: min(100%, 900px); object-fit: contain; background: #000; }
		audio { width: min(680px, calc(100% - 48px)); }
		.image-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; box-sizing: border-box; overflow: auto; }
		.image-stage.scaled { align-items: flex-start; justify-content: flex-start; padding: 48px; }
		.image-stage img { display: block; max-width: none; max-height: none; image-rendering: auto; }
		.image-stage img.fit { max-width: calc(100% - 48px); max-height: calc(100% - 48px); }
		.toolbar { position: fixed; right: 18px; bottom: 18px; display: flex; gap: 2px; padding: 3px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; background: var(--vscode-editorWidget-background); box-shadow: 0 4px 14px rgb(0 0 0 / 25%); }
		.toolbar button { min-width: 30px; height: 28px; padding: 0 8px; color: var(--vscode-foreground); background: transparent; border: 0; border-radius: 4px; font: inherit; cursor: pointer; }
		.toolbar button:hover { background: var(--vscode-toolbar-hoverBackground); }
		.toolbar button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
		.error { max-width: 520px; padding: 24px; color: var(--vscode-descriptionForeground); text-align: center; }
	</style>
</head>
<body>${media}<div class="error" id="error" role="alert" hidden>The media file could not be decoded by this system.</div>${script}</body>
</html>`;
}

function baseHalfPdfWebviewHtml(source: string, viewerScript: string, wasm: string, fontSc: string, nonce: string, viewState: IBaseHalfPdfViewState, name: string, locale: string, branchActionLabel: string): string {
	return `<!DOCTYPE html>
<html lang="${escapeAttribute(locale)}">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src blob: ${webviewGenericCspSource}; img-src blob: data: ${webviewGenericCspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${webviewGenericCspSource}; worker-src blob: ${webviewGenericCspSource};">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
		body { position: relative; }
		#basehalf-pdf-viewer, embedpdf-container { display: block; width: 100%; height: 100%; }
		.status { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; box-sizing: border-box; padding: 24px; color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background); pointer-events: none; }
		.status[hidden] { display: none; }
		.status-content { display: grid; justify-items: center; gap: 14px; max-width: 520px; text-align: center; }
		.status-message { margin: 0; font-size: 12px; line-height: 18px; }
		.loading .status-placeholder { width: min(390px, 54vw); height: min(520px, 66vh); border: 1px solid var(--vscode-widget-border, transparent); border-radius: 3px; background: linear-gradient(100deg, var(--vscode-editorWidget-background) 20%, var(--vscode-toolbar-hoverBackground) 45%, var(--vscode-editorWidget-background) 70%); background-size: 220% 100%; box-shadow: 0 8px 28px rgb(0 0 0 / 18%); animation: basehalf-pdf-loading 1.4s ease-in-out infinite; }
		.error .status-placeholder { display: none; }
		.error .status-message { color: var(--vscode-errorForeground, var(--vscode-descriptionForeground)); }
		@keyframes basehalf-pdf-loading { from { background-position: 100% 0; } to { background-position: -100% 0; } }
		@media (prefers-reduced-motion: reduce) { .loading .status-placeholder { animation: none; } }
	</style>
</head>
<body>
	<div id="basehalf-pdf-viewer" data-source="${source}" data-wasm="${escapeAttribute(wasm)}" data-font-sc="${escapeAttribute(fontSc)}" data-name="${escapeAttribute(name)}" data-locale="${escapeAttribute(locale)}" data-branch-action-label="${escapeAttribute(branchActionLabel)}" data-page="${viewState.page}" data-zoom="${viewState.zoom}" data-fit-width="${viewState.fitWidth}" data-status="loading"></div>
	<div class="status loading" id="basehalf-pdf-status" role="status" aria-live="polite">
		<div class="status-content">
			<div class="status-placeholder" aria-hidden="true"></div>
			<p class="status-message" id="basehalf-pdf-status-message">Opening PDF...</p>
		</div>
	</div>
	<script nonce="${nonce}" type="module" src="${escapeAttribute(viewerScript)}"></script>
</body>
</html>`;
}

export function baseHalfPdfLocale(value: string): string {
	const normalized = value.toLowerCase();
	if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk')) {
		return 'zh-TW';
	}
	if (normalized.startsWith('zh')) {
		return 'zh-CN';
	}
	for (const supported of ['de', 'es', 'fr', 'ja', 'nl', 'pt-BR', 'sv']) {
		if (normalized.startsWith(supported.toLowerCase())) {
			return supported;
		}
	}
	return 'en';
}

function escapeAttribute(value: string): string {
	return value.replace(/[&<>"']/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		'\'': '&#39;'
	}[character]!));
}
