/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCardDetailProjections.css';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { safeIntl } from '../../../../base/common/date.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { language } from '../../../../base/common/platform.js';
import { basename, dirname, isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { FileChangeType, IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWebviewElement, IWebviewService, WebviewContentPurpose } from '../../../contrib/webview/browser/webview.js';
import { asWebviewUri, webviewGenericCspSource } from '../../../contrib/webview/common/webview.js';
import { BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS, whenBaseHalfCanvasMediaDrawn } from '../../canvas/browser/basehalfCanvasCardMedia.js';
import { createBaseHalfCanvasCardVideoPlayer, IBaseHalfCanvasCardVideoPlayer } from '../../canvas/browser/basehalfCanvasCardVideoPlayer.js';
import { IBaseHalfCardDetailState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfRenderableContentKind, baseHalfRenderableContentKind } from '../common/basehalfContentRendering.js';
import { baseHalfPdfSelectionFromMessage, baseHalfPdfViewStateFromMessage, IBaseHalfMediaEscapeMessage, IBaseHalfPdfSelection, IBaseHalfPdfViewState, isBaseHalfMediaEscapeMessage, isBaseHalfPdfUserInteractionMessage, normalizeBaseHalfPdfViewState } from '../common/basehalfMediaViewState.js';
import { formatBaseHalfVideoElapsed } from '../../video/common/basehalfVideoCardPresentation.js';
import {
	BaseHalfVideoInputKind,
	baseHalfVideoInputKindOfPath,
	baseHalfVideoInputLabel,
	baseHalfVideoParamValueLabel,
	findBaseHalfVideoModel,
	findBaseHalfVideoProvider,
	IBaseHalfVideoCatalog
} from '../../video/common/basehalfVideoCatalog.js';
import { IBaseHalfGenerationCardSnapshot, IBaseHalfGenerationCardStore, IBaseHalfVideoCatalogService } from '../../video/common/basehalfVideoGeneration.js';

const contentViewerMediaRoot = FileAccess.asFileUri('vs/../../extensions/basehalf/content-viewer-out');
const pdfViewerScript = URI.joinPath(contentViewerMediaRoot, 'pdfViewer.js');
const pdfiumWasm = URI.joinPath(contentViewerMediaRoot, 'pdfium.wasm');
const simplifiedChinesePdfFont = URI.joinPath(contentViewerMediaRoot, 'NotoSansHans-Regular.otf');
const PDF_VIEW_STATE_STORAGE_PREFIX = 'basehalf.pdfViewState.';
/** What the page of an image says once it can be drawn. */
const BASEHALF_MEDIA_DRAWN_MESSAGE = 'basehalf.media.drawn';
/** What the page of an image says of an Escape it did not use. */
const BASEHALF_MEDIA_ESCAPE_MESSAGE: IBaseHalfMediaEscapeMessage['type'] = 'basehalf.media.escape';

/** What Card Detail draws in a page of its own: an image and a PDF. A video and a sound play in BaseHalf's player. */
type BaseHalfWebviewContentKind = Exclude<BaseHalfRenderableContentKind, 'video' | 'audio'>;

export function baseHalfMediaKind(resource: URI): BaseHalfRenderableContentKind | undefined {
	return baseHalfRenderableContentKind(resource);
}

export interface IBaseHalfGenerationProvenanceRow {
	readonly label: string;
	readonly value: string;
}

export interface IBaseHalfGenerationProvenanceInput {
	/** Such as `Image 1`, or `Text` for a note whose text joined the prompt. */
	readonly name: string;
	readonly path: string;
}

/** What made the file of a generation card, as Card Detail shows it below the image or the video. */
export interface IBaseHalfGenerationProvenance {
	readonly heading: string;
	/** A sentence below the heading, such as that the file is a copy. */
	readonly note?: string;
	readonly rows: readonly IBaseHalfGenerationProvenanceRow[];
	readonly inputs: readonly IBaseHalfGenerationProvenanceInput[];
}

/**
 * What made the file of a generation card, from its `made.yaml` (generation
 * cards, "The toolbar"): the model and the id sent to the provider, the
 * provider and its region, the mode, the settings, the prompt, which image of
 * how many it is, when it started and finished, and the inputs in order. The
 * names come from the model catalog when it has them, and are the recorded
 * ids otherwise. `kindOf` tells the kind of an input, so inputs are named as
 * the prompt names them. A card without a record says that BaseHalf did not
 * generate its file, and one whose record cannot be read says that.
 */
export function baseHalfGenerationProvenance(
	card: Pick<IBaseHalfGenerationCardSnapshot, 'kind' | 'made' | 'madeUnreadable'>,
	displayLanguage: string = language,
	catalog?: IBaseHalfVideoCatalog,
	kindOf: (path: string) => BaseHalfVideoInputKind = baseHalfVideoInputKindOfPath
): IBaseHalfGenerationProvenance {
	const made = card.made;
	if (!made) {
		return Object.freeze({
			heading: card.madeUnreadable
				? localize('basehalf.generation.detail.generated', "Generated")
				: localize('basehalf.generation.detail.notGenerated', "Not generated by BaseHalf"),
			// The record is left as it is; the user is never sent to it (D41).
			...(card.madeUnreadable ? { note: localize('basehalf.generation.detail.unreadable', "BaseHalf could not read what made this file.") } : {}),
			rows: Object.freeze([]),
			inputs: Object.freeze([])
		});
	}
	const provider = findBaseHalfVideoProvider(catalog, made.provider);
	const model = findBaseHalfVideoModel(catalog, made.provider, made.model)?.model;
	const region = provider?.regions.find(candidate => candidate.id === made.region);
	const mode = model?.modes.find(candidate => candidate.id === made.mode);
	const settings = Object.entries(made.params).map(([name, value]) => {
		const parameter = model?.parameters.find(candidate => candidate.name === name);
		return parameter
			? localize('basehalf.generation.detail.setting', "{0} {1}", parameter.label, baseHalfVideoParamValueLabel(parameter, value))
			: `${name}: ${String(value)}`;
	});
	const started = Date.parse(made.startedAt);
	const finished = Date.parse(made.finishedAt);
	const format = safeIntl.DateTimeFormat(displayLanguage, { dateStyle: 'medium', timeStyle: 'medium' }).value;
	const time = (value: number, fallback: string) => Number.isFinite(value) ? format.format(new Date(value)) : fallback;
	const ordinals = { image: 0, video: 0, audio: 0 };
	const inputs = made.inputs.map((path): IBaseHalfGenerationProvenanceInput => {
		const kind = kindOf(path);
		const name = kind === 'image' || kind === 'video' || kind === 'audio'
			? baseHalfVideoInputLabel(kind, ++ordinals[kind], displayLanguage)
			: kind === 'text'
				? localize('basehalf.generation.detail.textInput', "Text")
				: localize('basehalf.generation.detail.otherInput', "Input");
		return Object.freeze({ name, path });
	});
	const rows: IBaseHalfGenerationProvenanceRow[] = [
		{ label: localize('basehalf.generation.detail.model', "Model"), value: localize('basehalf.generation.detail.modelValue', "{0} ({1})", model?.label ?? made.model, made.providerModel) },
		{ label: localize('basehalf.generation.detail.provider', "Provider"), value: localize('basehalf.generation.detail.providerValue', "{0} · {1}", provider?.label ?? made.provider, region?.label ?? made.region) },
		{ label: localize('basehalf.generation.detail.mode', "Mode"), value: mode?.label ?? made.mode },
		{ label: localize('basehalf.generation.detail.settings', "Settings"), value: settings.length ? settings.join(' · ') : localize('basehalf.generation.detail.noSettings', "None") },
		{ label: localize('basehalf.generation.detail.prompt', "Prompt"), value: made.prompt.trim() || localize('basehalf.generation.detail.noPrompt', "No prompt") },
		...(made.output !== undefined && made.outputs !== undefined
			? [{ label: localize('basehalf.generation.detail.image', "Image"), value: localize('basehalf.generation.detail.imageOf', "{0} of {1}", made.output, made.outputs) }]
			: []),
		{ label: localize('basehalf.generation.detail.started', "Started"), value: time(started, made.startedAt) },
		{
			label: localize('basehalf.generation.detail.finished', "Finished"),
			value: Number.isFinite(started) && Number.isFinite(finished) && finished >= started
				? localize('basehalf.generation.detail.finishedAfter', "{0}, after {1}", time(finished, made.finishedAt), formatBaseHalfVideoElapsed(finished - started))
				: time(finished, made.finishedAt)
		}
	];
	return Object.freeze({
		heading: localize('basehalf.generation.detail.generated', "Generated"),
		// A copy keeps the original's record: what it says is what made the original.
		...(made.copyOf !== undefined ? {
			note: card.kind === 'image'
				? localize('basehalf.generation.detail.copyImage', "This image is a copy of a generated image; this is what made that one.")
				: localize('basehalf.generation.detail.copyVideo', "This video is a copy of a generated video; this is what made that one.")
		} : {}),
		rows: Object.freeze(rows.map(row => Object.freeze(row))),
		inputs: Object.freeze(inputs)
	});
}

/**
 * Read-only local content projection built on VS Code's isolated webview. A
 * video and a sound play in BaseHalf's player instead, the one their card
 * plays in (generation cards, "The player"), so that their sound never stops
 * at once.
 */
export class BaseHalfMediaCardDetail extends Disposable {
	private readonly root: HTMLElement;
	private readonly webviewHost: HTMLElement;
	private state: IBaseHalfCardDetailState | undefined;
	private webview: IWebviewElement | undefined;
	private readonly playerStore = this._register(new MutableDisposable<DisposableStore>());
	private player: IBaseHalfCanvasCardVideoPlayer | undefined;
	private playerVersion = 0;
	/** The image of the webview can be drawn: its page says so (opening and closing Card Detail). */
	private drawn: (() => void) | undefined;
	private kind: BaseHalfRenderableContentKind | undefined;
	/** What made the file, below an image or a video of a generation card. */
	private provenance: HTMLElement | undefined;
	private provenanceVersion = 0;
	private readonly provenanceListener = this._register(new MutableDisposable());
	private disposed = false;
	private renderVersion = 0;
	private pdfViewState: IBaseHalfPdfViewState | undefined;
	private pdfBranchPending = false;

	constructor(
		container: HTMLElement,
		private readonly createPdfBranch: (resource: URI, selection: IBaseHalfPdfSelection) => Promise<void>,
		private readonly onPdfUserInteraction: () => void,
		/** Escape in the page of an image, a sound, or a PDF, which closes Card Detail (opening and closing Card Detail, "The keyboard"). */
		private readonly onEscape: () => void,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService,
		@IBaseHalfGenerationCardStore private readonly generationCardStore: IBaseHalfGenerationCardStore,
		@IBaseHalfVideoCatalogService private readonly videoCatalogService: IBaseHalfVideoCatalogService,
		@IHoverService private readonly hoverService: IHoverService
	) {
		super();
		this.root = append(container, $('.basehalf-card-detail-media'));
		this.webviewHost = append(this.root, $('.basehalf-card-detail-media-webview'));
	}

	/** An image, a video, or a sound is drawn when `open` resolves; a PDF's viewer draws itself later. */
	get drawsInTransitions(): boolean {
		return this.kind !== 'pdf';
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.state = state;
		const kind = this.kind = baseHalfMediaKind(state.resource);
		if (!kind) {
			this.renderNotice('No media projection is available for this file type.');
			return;
		}

		try {
			await this.fileService.stat(state.resource);
			if (this.disposed || this.state?.resource.toString() !== state.resource.toString()) {
				return;
			}

			if (kind === 'video' || kind === 'audio') {
				if (kind === 'video') {
					this.followGenerationProvenance(state);
				}
				this._register(this.fileService.onDidFilesChange(event => {
					if (event.contains(state.resource, FileChangeType.DELETED)) {
						this.renderNotice('This media file no longer exists.');
						return;
					}
					if (event.contains(state.resource, FileChangeType.UPDATED, FileChangeType.ADDED)) {
						void this.renderPlayer(state.resource, kind === 'audio');
					}
				}));
				// Card Detail is drawn once the video has the frame it starts at, or the sound its length.
				await this.renderPlayer(state.resource, kind === 'audio');
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
			if (kind === 'image') {
				this.followGenerationProvenance(state);
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
			if (kind === 'pdf') {
				// The PDF viewer draws its own loading page at once.
				await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
			} else {
				await new Promise<void>(resolve => {
					this.drawn = resolve;
					this._register(disposableTimeout(resolve, BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS));
				});
			}
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
		if (this.player) {
			this.player.focus();
			return;
		}
		this.webview?.focus();
	}

	/** The video or the sound in the player of Card Detail; resolves when it has the frame it starts at. */
	private renderPlayer(resource: URI, sound: boolean): Promise<void> {
		const store = new DisposableStore();
		this.playerStore.value = store;
		clearNode(this.webviewHost);
		this.webviewHost.classList.add('holds-player');
		// A file that changed is asked for anew, not from the cache: a version in the query, as the webview's.
		const version = ++this.playerVersion;
		const player = this.player = store.add(createBaseHalfCanvasCardVideoPlayer(this.webviewHost, null, {
			source: resource.with({ query: [resource.query, `basehalfMediaVersion=${version}`].filter(Boolean).join('&') }),
			videoClasses: [],
			detail: true,
			sound,
			open: () => { /* Card Detail is open already. */ },
			onError: () => this.renderNotice('The media file could not be decoded by this system.'),
			hoverService: this.hoverService
		}));
		return new Promise<void>(resolve => {
			store.add(toDisposable(resolve));
			whenBaseHalfCanvasMediaDrawn(player.video, store, resolve);
		});
	}

	private renderWebview(kind: BaseHalfWebviewContentKind): void {
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

	private handleWebviewMessage(kind: BaseHalfWebviewContentKind, resource: URI, message: unknown): void {
		if (isBaseHalfMediaEscapeMessage(message)) {
			this.onEscape();
			return;
		}
		if (kind !== 'pdf') {
			if ((message as { type?: unknown } | undefined)?.type === BASEHALF_MEDIA_DRAWN_MESSAGE) {
				this.drawn?.();
				this.drawn = undefined;
			}
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
		this.playerStore.clear();
		this.player = undefined;
		this.webviewHost.classList.remove('holds-player');
		clearNode(this.webviewHost);
		const notice = append(this.webviewHost, $('.basehalf-card-detail-source-notice'));
		notice.textContent = message;
	}

	/**
	 * Below the image or the video of a generation card: what made its file
	 * (generation cards, "The toolbar"), drawn again when its card
	 * information changes. A file that is no generation card shows nothing
	 * more.
	 */
	private followGenerationProvenance(state: IBaseHalfCardDetailState): void {
		this.provenanceListener.value = this.generationCardStore.onDidChange(card => {
			if (isEqual(card, state.resource)) {
				void this.renderGenerationProvenance(state);
			}
		});
		void this.renderGenerationProvenance(state);
	}

	private async renderGenerationProvenance(state: IBaseHalfCardDetailState): Promise<void> {
		const version = ++this.provenanceVersion;
		const current = () => !this.disposed && version === this.provenanceVersion && this.state?.resource.toString() === state.resource.toString();
		let card: IBaseHalfGenerationCardSnapshot | undefined;
		try {
			card = await this.generationCardStore.isGenerationCard(state.resource) ? await this.generationCardStore.read(state.resource) : undefined;
		} catch (error) {
			this.logService.warn('[BaseHalf] Card Detail could not read what made a file', error);
		}
		// The names come from the catalog when it is there; a catalog still on its way is not waited for long.
		const catalog = card?.made ? await this.videoCatalogService.whenReady(3_000).catch(() => undefined) : undefined;
		if (!current()) {
			return;
		}
		this.provenance?.remove();
		this.provenance = undefined;
		this.root.classList.toggle('has-generation-provenance', !!card);
		if (!card) {
			return;
		}
		const provenance = baseHalfGenerationProvenance(card, language, catalog);
		const section = this.provenance = append(this.root, $('section.bh-generation-provenance'));
		section.setAttribute('aria-label', card.kind === 'image'
			? localize('basehalf.generation.detail.labelImage', "What made this image")
			: localize('basehalf.generation.detail.labelVideo', "What made this video"));
		append(section, $('h2.bh-generation-provenance-title')).textContent = provenance.heading;
		if (provenance.note) {
			append(section, $('p.bh-generation-provenance-note')).textContent = provenance.note;
		}
		if (!provenance.rows.length) {
			return;
		}
		const rows = append(section, $('dl.bh-generation-provenance-rows'));
		for (const row of provenance.rows) {
			append(rows, $('dt')).textContent = row.label;
			append(rows, $('dd')).textContent = row.value;
		}
		if (provenance.inputs.length) {
			append(rows, $('dt')).textContent = localize('basehalf.generation.detail.inputs', "Inputs");
			const list = append(append(rows, $('dd')), $('ol.bh-generation-provenance-inputs'));
			for (const input of provenance.inputs) {
				const item = append(list, $('li'));
				append(item, $('span.bh-generation-provenance-input-name')).textContent = input.name;
				append(item, $('span.bh-generation-provenance-input-path')).textContent = input.path;
			}
		}
	}
}

export function baseHalfMediaWebviewHtml(kind: BaseHalfWebviewContentKind, resource: URI, viewerScript = pdfViewerScript, wasm = pdfiumWasm, pdfViewState?: IBaseHalfPdfViewState, fontSc = simplifiedChinesePdfFont): string {
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
	const media = `<div class="image-stage" id="stage"><img id="media" src="${source}" alt="${resourceName}"></div>
			<div class="toolbar" role="toolbar" aria-label="Image zoom">
				<button type="button" data-action="out" aria-label="Zoom out">−</button>
				<button type="button" data-action="fit">Fit</button>
				<button type="button" data-action="actual">100%</button>
				<button type="button" data-action="in" aria-label="Zoom in">+</button>
			</div>`;
	const imageScript = `
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
		apply();`;
	const script = `<script nonce="${nonce}">
		const media = document.getElementById('media');
		const error = document.getElementById('error');
		const host = acquireVsCodeApi();
		const drawn = () => host.postMessage({ type: '${BASEHALF_MEDIA_DRAWN_MESSAGE}' });
		media.addEventListener('error', () => {
			error.hidden = false;
			media.hidden = true;
			document.querySelector('.toolbar')?.setAttribute('hidden', '');
			drawn();
		});
		if (media.complete) {
			drawn();
		} else {
			media.addEventListener('load', drawn, { once: true });
		}
		window.addEventListener('keydown', event => {
			if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
				host.postMessage({ type: '${BASEHALF_MEDIA_ESCAPE_MESSAGE}' });
			}
		});
		${imageScript}
	</script>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webviewGenericCspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
		body { display: flex; align-items: center; justify-content: center; font-family: var(--vscode-font-family); }
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
