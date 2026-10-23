/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasZoom.css';
import { $, addDisposableListener, append, isHTMLElement, isHTMLInputElement, isSVGElement } from '../../../../../base/browser/dom.js';
import { AnchorAlignment, AnchorAxisAlignment, AnchorPosition } from '../../../../../base/browser/ui/contextview/contextview.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { localize } from '../../../../../nls.js';
import { IContextViewDelegate, IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IBaseHalfCanvasContribution, IBaseHalfCanvasContributionContext, IBaseHalfCanvasView, registerBaseHalfCanvasContribution } from '../../../canvas/browser/basehalfCanvasExtensions.js';
import { BASEHALF_CANVAS_MAX_ZOOM, BASEHALF_CANVAS_MIN_ZOOM, normalizeBaseHalfCanvasZoom } from '../../../shell/common/basehalfConfiguration.js';
import { setBaseHalfHover } from '../../../shell/browser/basehalfHover.js';

/**
 * The zoom of the canvas among its view controls: a button that shows the
 * zoom, and the menu it opens to type a zoom, step it, fit the canvas to the
 * screen, or choose a preset.
 */
export class BaseHalfCanvasZoomControls extends Disposable implements IBaseHalfCanvasContribution {
	static readonly ID = 'basehalf.canvas.zoomControls';

	private readonly canvas: IBaseHalfCanvasView;
	private readonly trigger: HTMLButtonElement;
	private menuOpen = false;
	private menu: HTMLElement | undefined;
	private menuInput: HTMLInputElement | undefined;
	private menuInAction: HTMLButtonElement | undefined;
	private menuOutAction: HTMLButtonElement | undefined;
	private menuPresetActions: readonly { readonly button: HTMLButtonElement; readonly zoom: number }[] = [];

	constructor(
		context: IBaseHalfCanvasContributionContext,
		@IContextViewService private readonly contextViewService: IContextViewService,
	) {
		super();
		this.canvas = context.canvas;
		this.trigger = append(this.canvas.viewControls, $('button.basehalf-canvas-chrome-button.basehalf-canvas-zoom-value')) as HTMLButtonElement;
		this.trigger.type = 'button';
		this.trigger.setAttribute('aria-haspopup', 'dialog');
		this.trigger.setAttribute('aria-expanded', 'false');
		this.trigger.setAttribute('data-testid', 'canvas-zoom-trigger');
		this._register(addDisposableListener(this.trigger, 'click', () => this.toggleMenu()));
		this._register(this.canvas.onDidChangeZoom(() => this.update()));
		this._register(this.canvas.onDidHideViewControls(() => this.closeMenu(false)));
		this._register(toDisposable(() => {
			if (this.menuOpen) {
				this.contextViewService.hideContextView();
			}
			this.trigger.remove();
		}));
		this.update();
	}

	private toggleMenu(): void {
		if (this.menuOpen) {
			this.closeMenu(true);
			return;
		}

		this.showMenu();
	}

	private showMenu(): void {
		let focusZoomInput = () => { };
		this.menuOpen = true;
		this.trigger.classList.add('open');
		this.trigger.setAttribute('aria-expanded', 'true');

		const delegate: IContextViewDelegate = {
			getAnchor: () => this.canvas.viewControls,
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
			anchorPosition: AnchorPosition.ABOVE,
			canRelayout: true,
			focus: () => focusZoomInput(),
			render: contextContainer => {
				const store = new DisposableStore();
				const menu = append(contextContainer, $('.basehalf-canvas-zoom-menu'));
				menu.id = 'basehalf-canvas-zoom-menu';
				menu.setAttribute('role', 'dialog');
				menu.setAttribute('aria-label', localize('basehalf.canvas.zoomOptions', "Canvas zoom options"));
				menu.setAttribute('data-testid', 'canvas-zoom-menu');

				const inputShell = append(menu, $('.basehalf-canvas-zoom-input-shell'));
				const input = append(inputShell, $('input.basehalf-canvas-zoom-input')) as HTMLInputElement;
				input.type = 'text';
				input.inputMode = 'decimal';
				input.autocomplete = 'off';
				input.spellcheck = false;
				input.value = formatBaseHalfCanvasZoomPercent(this.canvas.zoom);
				input.setAttribute('aria-label', localize(
					'basehalf.canvas.zoomPercentageInput',
					"Zoom percentage, from {0}% to {1}%",
					Math.round(BASEHALF_CANVAS_MIN_ZOOM * 100),
					Math.round(BASEHALF_CANVAS_MAX_ZOOM * 100)
				));
				input.setAttribute('data-testid', 'canvas-zoom-input');
				const inputSuffix = append(inputShell, $('span.basehalf-canvas-zoom-input-suffix'));
				inputSuffix.textContent = '%';
				inputSuffix.setAttribute('aria-hidden', 'true');

				const actionList = append(menu, $('.basehalf-canvas-zoom-menu-actions'));
				actionList.setAttribute('role', 'menu');
				const actionButtons: HTMLButtonElement[] = [];
				const addAction = (
					label: string,
					shortcut: string | undefined,
					action: () => void,
					options?: { readonly actionId?: string; readonly zoomTarget?: number }
				): HTMLButtonElement => {
					const button = append(actionList, $('button.basehalf-canvas-zoom-menu-action')) as HTMLButtonElement;
					button.type = 'button';
					button.setAttribute('role', 'menuitem');
					button.setAttribute('aria-label', label);
					button.dataset.zoomAction = options?.actionId;
					if (options?.zoomTarget !== undefined) {
						button.dataset.zoomTarget = String(options.zoomTarget);
					}
					const actionLabel = append(button, $('span.basehalf-canvas-zoom-menu-label'));
					actionLabel.textContent = label;
					if (shortcut) {
						const shortcutLabel = append(button, $('span.basehalf-canvas-zoom-menu-shortcut'));
						shortcutLabel.textContent = shortcut;
						shortcutLabel.setAttribute('aria-hidden', 'true');
					}
					store.add(addDisposableListener(button, 'click', event => {
						event.preventDefault();
						event.stopPropagation();
						this.closeMenu(event.detail === 0);
						action();
					}));
					actionButtons.push(button);
					return button;
				};

				const commandKey = isMacintosh ? '⌘' : localize('basehalf.canvas.controlKey', "Ctrl");
				this.menuInAction = addAction(localize('basehalf.canvas.zoomIn', "Zoom In"), `${commandKey} +`, () => this.canvas.zoomBy(1), { actionId: 'in' });
				this.menuOutAction = addAction(localize('basehalf.canvas.zoomOut', "Zoom Out"), `${commandKey} -`, () => this.canvas.zoomBy(-1), { actionId: 'out' });
				addAction(localize('basehalf.canvas.fitToScreen', "Fit to Screen"), undefined, () => this.canvas.fitToScreen(), { actionId: 'fit' });

				const separator = append(actionList, $('.basehalf-canvas-zoom-menu-separator'));
				separator.setAttribute('role', 'separator');

				const presetPercentages = [50, 100, Math.round(BASEHALF_CANVAS_MAX_ZOOM * 100)];
				const presetActions: { readonly button: HTMLButtonElement; readonly zoom: number }[] = [];
				for (const percentage of [...new Set(presetPercentages)]) {
					const zoom = percentage / 100;
					const button = addAction(
						localize('basehalf.canvas.zoomToPercentage', "Zoom to {0}%", percentage),
						percentage === 100 ? `${commandKey} 0` : undefined,
						() => this.canvas.setZoom(zoom),
						{ actionId: percentage === 100 ? 'reset' : `preset-${percentage}`, zoomTarget: zoom }
					);
					presetActions.push({ button, zoom });
				}
				this.menuPresetActions = presetActions;

				const markInputValid = (): void => {
					input.removeAttribute('aria-invalid');
					inputShell.classList.remove('invalid');
					setBaseHalfHover(input, undefined);
				};
				const commitInput = (): void => {
					const zoom = baseHalfCanvasZoomFromPercentInput(input.value);
					if (zoom === undefined) {
						const message = localize(
							'basehalf.canvas.zoomPercentageRange',
							"Enter a value from {0}% to {1}%.",
							Math.round(BASEHALF_CANVAS_MIN_ZOOM * 100),
							Math.round(BASEHALF_CANVAS_MAX_ZOOM * 100)
						);
						input.setAttribute('aria-invalid', 'true');
						inputShell.classList.add('invalid');
						setBaseHalfHover(input, message);
						input.select();
						return;
					}
					markInputValid();
					this.closeMenu(true);
					this.canvas.setZoom(zoom);
				};
				store.add(addDisposableListener(input, 'input', markInputValid));
				store.add(addDisposableListener(menu, 'keydown', event => {
					if (event.key === 'Escape') {
						event.preventDefault();
						event.stopPropagation();
						this.closeMenu(true);
						return;
					}
					if ((event.metaKey || event.ctrlKey) && !event.altKey
						&& (event.key === '=' || event.key === '+' || event.key === '-' || event.key === '0')) {
						event.preventDefault();
						event.stopPropagation();
						this.closeMenu(true);
						if (event.key === '0') {
							this.canvas.setZoom(1);
						} else {
							this.canvas.zoomBy(event.key === '-' ? -1 : 1);
						}
						return;
					}
					const enabledActionButtons = actionButtons.filter(button => !button.disabled);
					if (isHTMLInputElement(event.target)) {
						if (event.key === 'Enter') {
							event.preventDefault();
							commitInput();
						} else if (event.key === 'ArrowDown' && enabledActionButtons.length > 0) {
							event.preventDefault();
							enabledActionButtons[0].focus();
						} else if (event.key === 'ArrowUp' && enabledActionButtons.length > 0) {
							event.preventDefault();
							enabledActionButtons[enabledActionButtons.length - 1].focus();
						}
						return;
					}
					const target = isHTMLElement(event.target) && event.target.tagName === 'BUTTON'
						? event.target as HTMLButtonElement
						: undefined;
					const index = target ? enabledActionButtons.indexOf(target) : -1;
					if (index < 0) {
						return;
					}
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						const delta = event.key === 'ArrowDown' ? 1 : -1;
						enabledActionButtons[(index + delta + enabledActionButtons.length) % enabledActionButtons.length].focus();
					} else if (event.key === 'Home' || event.key === 'End') {
						event.preventDefault();
						enabledActionButtons[event.key === 'Home' ? 0 : enabledActionButtons.length - 1].focus();
					}
				}));
				store.add(addDisposableListener(menu, 'focusout', event => {
					const next = event.relatedTarget;
					if ((isHTMLElement(next) || isSVGElement(next))
						&& (menu.contains(next) || this.trigger.contains(next))) {
						return;
					}
					this.closeMenu(false);
				}));
				store.add(addDisposableListener(menu.ownerDocument, 'pointerdown', event => {
					const target = event.target;
					if ((isHTMLElement(target) || isSVGElement(target))
						&& (menu.contains(target) || this.trigger.contains(target))) {
						return;
					}
					this.closeMenu(false);
				}, true));

				this.menu = menu;
				this.menuInput = input;
				this.trigger.setAttribute('aria-controls', menu.id);
				this.updateMenu();
				focusZoomInput = () => {
					input.focus({ preventScroll: true });
					input.select();
				};
				store.add(toDisposable(() => {
					focusZoomInput = () => { };
					if (this.menu === menu) {
						this.menu = undefined;
						this.menuInput = undefined;
						this.menuInAction = undefined;
						this.menuOutAction = undefined;
						this.menuPresetActions = [];
					}
				}));
				return store;
			},
			onHide: data => {
				this.menuOpen = false;
				this.trigger.classList.remove('open');
				this.trigger.setAttribute('aria-expanded', 'false');
				this.trigger.removeAttribute('aria-controls');
				if ((data as { readonly restoreFocus?: boolean } | undefined)?.restoreFocus && this.trigger.isConnected) {
					this.trigger.focus({ preventScroll: true });
				}
			}
		};

		this.contextViewService.showContextView(delegate);
	}

	private closeMenu(restoreFocus: boolean): void {
		if (!this.menuOpen) {
			return;
		}
		this.contextViewService.hideContextView({ restoreFocus });
	}

	private update(): void {
		const percentage = Math.round(this.canvas.zoom * 100);
		this.trigger.textContent = `${percentage}%`;
		const zoomLabel = localize('basehalf.canvas.zoomMenuAtPercentage', "Zoom options, {0}%", percentage);
		this.trigger.setAttribute('aria-label', zoomLabel);
		this.updateMenu();
	}

	private updateMenu(): void {
		if (!this.menu) {
			return;
		}
		const zoom = this.canvas.zoom;
		if (this.menuOutAction) {
			this.menuOutAction.disabled = zoom <= BASEHALF_CANVAS_MIN_ZOOM;
		}
		if (this.menuInAction) {
			this.menuInAction.disabled = zoom >= BASEHALF_CANVAS_MAX_ZOOM;
		}
		for (const { button, zoom: targetZoom } of this.menuPresetActions) {
			const current = Math.abs(targetZoom - zoom) < 0.0001;
			button.classList.toggle('current', current);
			if (current) {
				button.setAttribute('aria-current', 'true');
			} else {
				button.removeAttribute('aria-current');
			}
		}
		if (this.menuInput && this.menuInput.ownerDocument.activeElement !== this.menuInput) {
			this.menuInput.value = formatBaseHalfCanvasZoomPercent(zoom);
		}
	}
}

/** The zoom a typed percentage names, or undefined when it is not a number in the zoom range. */
export function baseHalfCanvasZoomFromPercentInput(value: string): number | undefined {
	const match = /^(\d+(?:\.\d+)?)\s*%?$/.exec(value.trim());
	if (!match) {
		return undefined;
	}
	const zoom = Number(match[1]) / 100;
	if (!Number.isFinite(zoom) || zoom < BASEHALF_CANVAS_MIN_ZOOM || zoom > BASEHALF_CANVAS_MAX_ZOOM) {
		return undefined;
	}
	return roundZoom(zoom);
}

export function formatBaseHalfCanvasZoomPercent(zoom: number): string {
	return String(Number((roundZoom(zoom) * 100).toFixed(2)));
}

/** The canvas keeps its zoom to four decimals. */
function roundZoom(value: number): number {
	return Number(normalizeBaseHalfCanvasZoom(value).toFixed(4));
}

registerBaseHalfCanvasContribution(BaseHalfCanvasZoomControls.ID, BaseHalfCanvasZoomControls);
