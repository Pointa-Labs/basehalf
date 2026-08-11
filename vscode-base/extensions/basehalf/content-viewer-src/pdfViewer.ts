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
	type ThemeColors
} from '@embedpdf/snippet';
import { FontCharset } from '@embedpdf/models';
import type { BaseHalfPdfWebviewMessage, IBaseHalfPdfSelection, IBaseHalfPdfViewStateMessage } from '../../../src/vs/workbench/basehalf/common/basehalfMediaViewState.js';

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

for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
	window.addEventListener(type, () => vscode.postMessage({ type: 'basehalf.pdf.userInteraction' }), {
		capture: true,
		passive: true
	});
}

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
let zoom = boundedNumber(root.dataset.zoom, 1, 0.25, 5);
let fitWidth = root.dataset.fitWidth !== 'false';
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
			defaultZoomLevel: fitWidth ? ZoomMode.FitWidth : zoom,
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
			showError(event.message || 'The PDF document could not be opened.');
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
	zoomCapability.onZoomChange(event => {
		if (event.documentId !== DOCUMENT_ID) {
			return;
		}
		zoom = boundedNumber(String(event.newZoom), 1, 0.25, 5);
		fitWidth = event.level === ZoomMode.FitWidth;
		emitViewState();
	});

	const documentState = documentManager.getDocumentState(DOCUMENT_ID);
	if (documentState?.status === 'loaded') {
		markReady();
	} else if (documentState?.status === 'error') {
		showError(documentState.error || 'The PDF document could not be opened.');
	}
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
		state: { page, zoom, fitWidth }
	};
	vscode.postMessage(message);
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
