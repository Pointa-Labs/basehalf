/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import EmbedPDF, {
	CommandsPlugin,
	DocumentManagerPlugin,
	ScrollPlugin,
	SelectionPlugin,
	UIPlugin,
	ZoomMode,
	ZoomPlugin,
	type DeepPartial,
	type EmbedPdfContainer,
	type PluginRegistry,
	type ThemeColors,
	type ZoomLevel
} from '@embedpdf/snippet';
import { FontCharset, PdfErrorCode } from '@embedpdf/models';
import { baseHalfNoteZoomFactor, baseHalfPagePinchFromMessage } from '../../../src/vs/workbench/basehalf/cardDetail/common/basehalfNoteZoom.js';
import { BASEHALF_PDF_AUTOMATIC_ZOOM_MAX, BASEHALF_PDF_SELECTION_TEXT_LIMIT, type BaseHalfPdfWebviewMessage, type BaseHalfPdfZoom, type IBaseHalfPdfSelection, type IBaseHalfPdfViewStateMessage } from '../../../src/vs/workbench/basehalf/cardDetail/common/basehalfMediaViewState.js';

interface VsCodeApi {
	postMessage(message: BaseHalfPdfWebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const DOCUMENT_ID = 'basehalf-document';
const CREATE_BRANCH_COMMAND_ID = 'basehalf:create-branch';
const CREATE_BRANCH_ITEM_ID = 'basehalf-create-branch';
const INITIALIZATION_TIMEOUT_MS = 20_000;

function requiredElement<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`BaseHalf PDF viewer element '${id}' is missing.`);
	}
	return element as T;
}

const root = requiredElement<HTMLElement>('basehalf-pdf-viewer');
const status = requiredElement<HTMLElement>('basehalf-pdf-status');
const statusMessage = requiredElement<HTMLElement>('basehalf-pdf-status-message');
const vscode = acquireVsCodeApi();
const initialization: { timeout?: number } = {};

/** While the viewer asks for the password of the PDF in its place. */
let locked = false;
/** When the user last pressed, typed, or scrolled in the page: a zoom right after it is the user's. */
let lastUserInput = 0;
for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
	window.addEventListener(type, () => {
		// What the user types for the password is not about the zoom that the PDF then opens at.
		if (!locked) {
			lastUserInput = Date.now();
		}
		vscode.postMessage({ type: 'basehalf.pdf.userInteraction' });
	}, {
		capture: true,
		passive: true
	});
}

/** The viewer's own menus and dialogs, which close on Escape themselves. */
let viewerUi: ReturnType<UIPlugin['provides']> | undefined;
let escapeUsedByViewer = false;
// Escape that the viewer does not use closes Card Detail (opening and closing
// Card Detail, "The keyboard"). The viewer closes a menu or a dialog on Escape
// without saying so, so whether one is open is read before it does, and a
// field of its own, such as the page number, keeps its Escape. The field of
// the password does not: Escape there is Cancel.
window.addEventListener('keydown', event => {
	if (event.key !== 'Escape') {
		return;
	}
	const target = event.composedPath()[0];
	const inField = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
	const scope = viewerUi?.forDocument(DOCUMENT_ID);
	escapeUsedByViewer = !locked && (inField || (!!scope && (scope.getOpenMenus().length > 0 || scope.isModalOpen())));
}, { capture: true });
window.addEventListener('keydown', event => {
	if (event.key === 'Escape' && !escapeUsedByViewer && !event.defaultPrevented && !event.isComposing
		&& !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
		vscode.postMessage({ type: 'basehalf.media.escape' });
	}
});

function requiredDatasetValue(name: string): string {
	const value = root.dataset[name];
	if (!value) {
		showError('The local PDF renderer is incomplete.');
		throw new Error(`BaseHalf PDF viewer data '${name}' is missing.`);
	}
	return value;
}

const source = requiredDatasetValue('source');
const wasmUrl = requiredDatasetValue('wasm');

let page = positiveInteger(root.dataset.page, 1);
/** How the user zoomed; none while the PDF fits the width of Card Detail, at most 125 % (PDFs and books, "The PDF reader"). */
let zoom = storedZoom(root.dataset.zoom);
/** The zoom that this page asked the viewer for, whose change is not the user's. */
let automaticRequest: ZoomLevel | undefined;
/**
 * The viewer shows a document once it has worked out a fit, and never for a
 * scale it starts at: a PDF opens at a fit, and then at the scale the user
 * chose for it.
 */
let restoredZoom = typeof zoom === 'number' ? zoom : undefined;
let ready = false;
let viewer: EmbedPdfContainer | undefined;
let pdfiumObjectUrl: string | undefined;
let simplifiedChineseFontObjectUrl: string | undefined;
let createBranchPending = false;

initialization.timeout = window.setTimeout(() => {
	if (!ready) {
		showError('The PDF renderer took too long to start. Reopen the file to try again.');
	}
}, INITIALIZATION_TIMEOUT_MS);

void initializeViewer().catch(error => {
	window.clearTimeout(initialization.timeout);
	showError(error instanceof Error ? error.message : 'The PDF renderer could not start.');
});

window.addEventListener('unload', () => {
	if (pdfiumObjectUrl) {
		URL.revokeObjectURL(pdfiumObjectUrl);
	}
	if (simplifiedChineseFontObjectUrl) {
		URL.revokeObjectURL(simplifiedChineseFontObjectUrl);
	}
}, { once: true });

async function initializeViewer(): Promise<void> {
	// VS Code's signed local-resource URL is resolved by the webview service
	// worker. A nested blob worker cannot use that service-worker route, so
	// resolve PDFium once here and give the renderer worker a same-origin blob.
	const response = await fetch(wasmUrl, { credentials: 'same-origin' });
	if (!response.ok) {
		throw new Error(`The local PDF engine could not be loaded (${response.status}).`);
	}
	const wasm = await response.arrayBuffer();
	const magic = new Uint8Array(wasm, 0, Math.min(4, wasm.byteLength));
	if (magic.length !== 4 || magic[0] !== 0 || magic[1] !== 97 || magic[2] !== 115 || magic[3] !== 109) {
		throw new Error('The local PDF engine returned invalid data.');
	}
	pdfiumObjectUrl = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
	const simplifiedChineseFontUrl = root.dataset.fontSc;
	if (simplifiedChineseFontUrl) {
		try {
			const fontResponse = await fetch(simplifiedChineseFontUrl, { credentials: 'same-origin' });
			if (!fontResponse.ok) {
				throw new Error(`HTTP ${fontResponse.status}`);
			}
			const font = await fontResponse.arrayBuffer();
			if (font.byteLength < 4) {
				throw new Error('empty font data');
			}
			simplifiedChineseFontObjectUrl = URL.createObjectURL(new Blob([font], { type: 'font/otf' }));
		} catch (error) {
			// A font package must never prevent an otherwise valid PDF from
			// opening. Embedded document fonts continue to work without it.
			console.warn('[BaseHalf] simplified Chinese PDF fallback font is unavailable', error);
		}
	}

	viewer = EmbedPDF.init({
		type: 'container',
		target: root,
		worker: true,
		wasmUrl: pdfiumObjectUrl,
		fontFallback: simplifiedChineseFontObjectUrl ? {
			fonts: {
				[FontCharset.GB2312]: [{ url: simplifiedChineseFontObjectUrl, weight: 400 }]
			}
		} : null,
		fonts: {
			ui: { family: 'var(--vscode-font-family)', stylesheetUrl: null },
			signature: null
		},
		tabBar: 'never',
		disabledCategories: [
			'annotation',
			'panel-comment',
			'redaction',
			'insert',
			'form',
			'document-open',
			'document-export',
			'document-print',
			'document-protect',
			'document-fullscreen',
			'security',
			'capture',
			'attachment'
		],
		permissions: {
			enforceDocumentPermissions: true,
			overrides: {
				print: false,
				modifyContents: false,
				modifyAnnotations: false,
				fillForms: false,
				assembleDocument: false,
				printHighQuality: false
			}
		},
		documentManager: {
			initialDocuments: [{
				url: source,
				documentId: DOCUMENT_ID,
				name: root.dataset.name || 'Document.pdf',
				mode: 'auto',
				autoActivate: true
			}],
			maxDocuments: 1
		},
		i18n: { defaultLocale: root.dataset.locale || 'en' },
		zoom: {
			defaultZoomLevel: zoom === 'fit-page' ? ZoomMode.FitPage : ZoomMode.FitWidth,
			minZoom: 0.25,
			maxZoom: 5,
			zoomStep: 0.15
		},
		selection: {
			marquee: { enabled: false },
			minSelectionDragDistance: 3
		},
		stamp: {
			defaultLibrary: false,
			libraries: [],
			manifests: []
		},
		theme: baseHalfPdfTheme()
	});

	if (!viewer) {
		throw new Error('The PDF renderer could not be created.');
	}
	observeWorkbenchTheme(viewer);
	await viewer.registry.then(initializeRegistry);
}

async function initializeRegistry(registry: PluginRegistry): Promise<void> {
	installBaseHalfSelectionCommand(registry);
	await registry.pluginsReady();
	viewerUi = registry.getPlugin<UIPlugin>(UIPlugin.id)?.provides();

	const documentManager = registry.getPlugin<DocumentManagerPlugin>(DocumentManagerPlugin.id)?.provides();
	const scroll = registry.getPlugin<ScrollPlugin>(ScrollPlugin.id)?.provides();
	const zoomCapability = registry.getPlugin<ZoomPlugin>(ZoomPlugin.id)?.provides();
	if (!documentManager || !scroll || !zoomCapability) {
		throw new Error('The PDF reader did not provide its required capabilities.');
	}

	documentManager.onDocumentOpened(event => {
		if (event.id === DOCUMENT_ID) {
			markReady();
		}
	});
	documentManager.onDocumentError(event => {
		if (event.documentId === DOCUMENT_ID) {
			documentFailed(event.code, event.message);
		}
	});
	// Cancel, when the viewer asks for the password, closes the PDF, and Card Detail with it.
	documentManager.onDocumentClosed(documentId => {
		if (documentId === DOCUMENT_ID) {
			vscode.postMessage({ type: 'basehalf.media.escape' });
		}
	});

	scroll.onLayoutReady(event => {
		if (event.documentId !== DOCUMENT_ID || !event.isInitial) {
			return;
		}
		root.dataset.pageCount = String(event.totalPages);
		page = Math.min(Math.max(1, page), event.totalPages);
		scroll.forDocument(DOCUMENT_ID).scrollToPage({ pageNumber: page, behavior: 'instant', alignY: 0 });
		emitViewState();
	});
	scroll.onPageChange(event => {
		if (event.documentId !== DOCUMENT_ID || event.pageNumber === page) {
			return;
		}
		page = event.pageNumber;
		emitViewState();
	});
	const zoomScope = zoomCapability.forDocument(DOCUMENT_ID);
	const requestAutomaticZoom = (level: ZoomLevel) => {
		automaticRequest = level;
		zoomScope.requestZoom(level);
	};
	zoomCapability.onZoomChange(event => {
		if (event.documentId !== DOCUMENT_ID) {
			return;
		}
		if (restoredZoom !== undefined) {
			// The first fit shows the document: now the scale the user chose, at their page.
			const level = restoredZoom;
			restoredZoom = undefined;
			requestAutomaticZoom(level);
			window.requestAnimationFrame(() => scroll.forDocument(DOCUMENT_ID).scrollToPage({ pageNumber: page, behavior: 'instant', alignY: 0 }));
			return;
		}
		// A zoom that this page asked for, or the viewer's own fit to a new width, is not the user's.
		const requested = automaticRequest !== undefined && event.level === automaticRequest;
		automaticRequest = undefined;
		if (zoom === undefined && (requested || Date.now() - lastUserInput > 1000)) {
			// The width of Card Detail, but at most 125 %, until the user zooms.
			if (event.newZoom > BASEHALF_PDF_AUTOMATIC_ZOOM_MAX + 0.001) {
				requestAutomaticZoom(BASEHALF_PDF_AUTOMATIC_ZOOM_MAX);
			}
			return;
		}
		zoom = event.level === ZoomMode.FitWidth || event.level === ZoomMode.Automatic ? 'fit-width'
			: event.level === ZoomMode.FitPage ? 'fit-page'
				: boundedNumber(String(event.newZoom), 1, 0.25, 5);
		emitViewState();
	});
	// A pinch that the window took over the page zooms the PDF with its own
	// zoom, once a frame, around the fingers, and is the user's zoom (PDFs and
	// books, "The PDF reader").
	let pinch: { factor: number; x: number; y: number } | undefined;
	window.addEventListener('message', event => {
		const message = baseHalfPagePinchFromMessage(event.data);
		if (!message || locked) {
			return;
		}
		lastUserInput = Date.now();
		if (!pinch) {
			// The point in the viewer's scrolling viewport, below its toolbar.
			const viewport = scrollingViewport();
			pinch = { factor: 1, x: message.x - viewport.x, y: message.y - viewport.y };
			window.requestAnimationFrame(() => {
				const next = pinch!;
				pinch = undefined;
				const shown = zoomScope.getState().currentZoomLevel;
				zoomScope.requestZoom(Math.min(5, Math.max(0.25, shown * next.factor)), { vx: next.x, vy: next.y });
			});
		}
		pinch.factor *= baseHalfNoteZoomFactor(message);
	});
	// While the PDF fits the width of Card Detail, it follows the width.
	new ResizeObserver(() => {
		if (zoom === undefined && ready) {
			requestAutomaticZoom(ZoomMode.FitWidth);
		}
	}).observe(root);
	observeSelection(registry);

	const documentState = documentManager.getDocumentState(DOCUMENT_ID);
	if (documentState?.status === 'loaded') {
		markReady();
	} else if (documentState?.status === 'error') {
		documentFailed(documentState.errorCode, documentState.error ?? undefined);
	}
}

/**
 * A PDF that a password locks is asked for by the viewer, in place of the
 * PDF, and opens once the password is right. Any other PDF that does not open
 * says that BaseHalf could not open it, and the reason goes to the log (PDFs
 * and books, "The PDF reader").
 */
function documentFailed(code: number | undefined, message: string | undefined): void {
	if (code === PdfErrorCode.Password) {
		locked = true;
		window.clearTimeout(initialization.timeout);
		root.dataset.status = 'locked';
		status.hidden = true;
		return;
	}
	vscode.postMessage({ type: 'basehalf.pdf.failed', message: message ?? '' });
	showError(root.dataset.failedLabel || 'BaseHalf could not open this PDF.');
}

function installBaseHalfSelectionCommand(registry: PluginRegistry): void {
	const commands = registry.getPlugin<CommandsPlugin>(CommandsPlugin.id)?.provides();
	const ui = registry.getPlugin<UIPlugin>(UIPlugin.id)?.provides();
	const selection = registry.getPlugin<SelectionPlugin>(SelectionPlugin.id)?.provides();
	if (!commands || !ui || !selection) {
		return;
	}

	commands.registerCommand({
		id: CREATE_BRANCH_COMMAND_ID,
		label: root.dataset.branchActionLabel || 'Grow branch',
		icon: 'plus',
		categories: ['basehalf'],
		action: ({ documentId }) => {
			if (createBranchPending) {
				return;
			}
			createBranchPending = true;
			const scope = selection.forDocument(documentId);
			const pages = scope.getFormattedSelection().map(item => item.pageIndex + 1);
			void (async () => {
				try {
					const parts = await scope.getSelectedText().toPromise();
					const text = parts.join('\n\n').trim();
					if (text && pages.length > 0) {
						const selected: IBaseHalfPdfSelection = { text, pages };
						vscode.postMessage({ type: 'basehalf.pdf.createBranch', selection: selected });
					}
				} catch (error) {
					console.error('[BaseHalf] failed to read the PDF selection', error);
				} finally {
					scope.clear();
					createBranchPending = false;
				}
			})();
		}
	});

	const schema = ui.getSchema();
	const menu = schema.selectionMenus.selection;
	if (!menu || menu.items.some(item => item.id === CREATE_BRANCH_ITEM_ID)) {
		return;
	}
	ui.mergeSchema({
		selectionMenus: {
			...schema.selectionMenus,
			selection: {
				...menu,
				visibilityDependsOn: {
					...menu.visibilityDependsOn,
					itemIds: [...(menu.visibilityDependsOn?.itemIds ?? []), CREATE_BRANCH_ITEM_ID]
				},
				items: [
					...menu.items,
					{ type: 'divider', id: 'basehalf-selection-divider', categories: ['basehalf'] },
					{ type: 'command-button', id: CREATE_BRANCH_ITEM_ID, commandId: CREATE_BRANCH_COMMAND_ID, variant: 'icon-text', categories: ['basehalf'] }
				]
			}
		}
	});
}

function markReady(): void {
	ready = true;
	locked = false;
	window.clearTimeout(initialization.timeout);
	root.dataset.status = 'ready';
	status.hidden = true;
}

function showError(message: string): void {
	window.clearTimeout(initialization.timeout);
	root.dataset.status = 'error';
	status.classList.remove('loading');
	status.classList.add('error');
	status.hidden = false;
	statusMessage.textContent = message;
}

function emitViewState(): void {
	const message: IBaseHalfPdfViewStateMessage = {
		type: 'basehalf.pdf.viewState',
		state: zoom === undefined ? { page } : { page, zoom }
	};
	vscode.postMessage(message);
}

/**
 * The text selected in the PDF, 30 ms after it stops changing, with its
 * pages, and nothing when the selection ends: what agents can see (PDFs and
 * books, "What agents can see").
 */
function observeSelection(registry: PluginRegistry): void {
	const selection = registry.getPlugin<SelectionPlugin>(SelectionPlugin.id)?.provides();
	if (!selection) {
		return;
	}
	let settling: number | undefined;
	let sent = false;
	let run = 0;
	selection.onSelectionChange(event => {
		if (event.documentId !== DOCUMENT_ID) {
			return;
		}
		window.clearTimeout(settling);
		settling = window.setTimeout(async () => {
			const current = ++run;
			const scope = selection.forDocument(DOCUMENT_ID);
			const pages = [...new Set(scope.getFormattedSelection().map(item => item.pageIndex + 1))].sort((left, right) => left - right);
			let text = '';
			if (pages.length > 0) {
				try {
					text = (await scope.getSelectedText().toPromise()).join('\n\n');
				} catch (error) {
					console.error('[BaseHalf] failed to read the PDF selection', error);
				}
			}
			if (current !== run) {
				return;
			}
			if (!text.trim()) {
				if (sent) {
					sent = false;
					vscode.postMessage({ type: 'basehalf.pdf.selectionChanged' });
				}
				return;
			}
			sent = true;
			vscode.postMessage({ type: 'basehalf.pdf.selectionChanged', selection: { text: text.slice(0, BASEHALF_PDF_SELECTION_TEXT_LIMIT), pages } });
		}, 30);
	});
}

function storedZoom(value: string | undefined): BaseHalfPdfZoom | undefined {
	if (value === 'fit-width' || value === 'fit-page') {
		return value;
	}
	return value ? boundedNumber(value, 1, 0.25, 5) : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function currentThemePreference(): 'light' | 'dark' {
	return document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light') ? 'light' : 'dark';
}

function observeWorkbenchTheme(container: EmbedPdfContainer): void {
	const apply = () => container.setTheme({ ...baseHalfPdfTheme(), preference: currentThemePreference() });
	apply();
	const observer = new MutationObserver(apply);
	observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	window.addEventListener('unload', () => observer.disconnect(), { once: true });
}

function baseHalfPdfTheme(): { preference: 'light' | 'dark'; light: DeepPartial<ThemeColors>; dark: DeepPartial<ThemeColors> } {
	const workbenchColors: DeepPartial<ThemeColors> = {
		background: {
			app: 'var(--vscode-editor-background)',
			surface: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
			surfaceAlt: 'var(--vscode-sideBar-background, var(--vscode-editorWidget-background))',
			elevated: 'var(--vscode-menu-background, var(--vscode-editorWidget-background))',
			overlay: 'rgb(0 0 0 / 42%)',
			input: 'var(--vscode-input-background)'
		},
		foreground: {
			primary: 'var(--vscode-editor-foreground)',
			secondary: 'var(--vscode-foreground)',
			muted: 'var(--vscode-descriptionForeground)',
			disabled: 'var(--vscode-disabledForeground, var(--vscode-descriptionForeground))',
			onAccent: 'var(--vscode-button-foreground)'
		},
		border: {
			default: 'var(--vscode-widget-border, transparent)',
			subtle: 'var(--vscode-editorWidget-border, var(--vscode-widget-border, transparent))',
			strong: 'var(--vscode-contrastBorder, var(--vscode-widget-border, transparent))'
		},
		accent: {
			primary: 'var(--vscode-button-background)',
			primaryHover: 'var(--vscode-button-hoverBackground)',
			primaryActive: 'var(--vscode-button-hoverBackground)',
			primaryLight: 'var(--vscode-editor-selectionBackground)',
			primaryForeground: 'var(--vscode-button-foreground)'
		},
		interactive: {
			hover: 'var(--vscode-toolbar-hoverBackground)',
			active: 'var(--vscode-toolbar-activeBackground, var(--vscode-toolbar-hoverBackground))',
			selected: 'var(--vscode-list-activeSelectionBackground)',
			focus: 'var(--vscode-focusBorder)',
			focusRing: 'var(--vscode-focusBorder)'
		},
		state: {
			error: 'var(--vscode-errorForeground)',
			errorLight: 'var(--vscode-inputValidation-errorBackground)',
			warning: 'var(--vscode-editorWarning-foreground)',
			warningLight: 'var(--vscode-inputValidation-warningBackground)',
			success: 'var(--vscode-testing-iconPassed, #4caf50)',
			successLight: 'var(--vscode-diffEditor-insertedTextBackground)',
			info: 'var(--vscode-editorInfo-foreground)',
			infoLight: 'var(--vscode-inputValidation-infoBackground)'
		},
		scrollbar: {
			track: 'transparent',
			thumb: 'var(--vscode-scrollbarSlider-background)',
			thumbHover: 'var(--vscode-scrollbarSlider-hoverBackground)'
		},
		tooltip: {
			background: 'var(--vscode-editorHoverWidget-background)',
			foreground: 'var(--vscode-editorHoverWidget-foreground)'
		}
	};
	return { preference: currentThemePreference(), light: workbenchColors, dark: workbenchColors };
}

/** Where the viewer's scrolling viewport stands in the page: the zoom's center is given in it. */
function scrollingViewport(): { readonly x: number; readonly y: number } {
	const scope: ParentNode = root.shadowRoot ?? root;
	for (const element of scope.querySelectorAll<HTMLElement>('*')) {
		const overflow = getComputedStyle(element).overflowY;
		if ((overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight) {
			const box = element.getBoundingClientRect();
			return { x: box.left, y: box.top };
		}
	}
	return { x: 0, y: 0 };
}
