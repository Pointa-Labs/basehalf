/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { BrandedService, IConstructorSignature } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * The canvas as its features see it (docs/harness/code-organization.md, "The
 * canvas: a core and its features"). The canvas view implements it; a feature
 * gets it when the view creates the feature and uses nothing else of the view.
 */
export interface IBaseHalfCanvasView {
	/** The zoom of the canvas that is shown, between the lowest and the highest zoom. */
	readonly zoom: number;
	readonly onDidChangeZoom: Event<number>;
	setZoom(zoom: number): void;
	/** One zoom step in or out. */
	zoomBy(direction: -1 | 1): void;
	fitToScreen(): void;

	/** Whether a card that is moved snaps to the edges and centers of other cards. It does when the canvas starts. */
	setSnapEnabled(enabled: boolean): void;

	/**
	 * The group of view controls at the corner of the canvas. A feature appends
	 * its controls to it when it is created, after the controls of the view
	 * itself and those of features registered before it.
	 */
	readonly viewControls: HTMLElement;
	/**
	 * The view controls can no longer be used: Card Detail opened, no folder is
	 * shown, or an editor covers the canvas. What a control opened closes.
	 */
	readonly onDidHideViewControls: Event<void>;
}

/** A feature of the canvas, created once for the canvas view and disposed with it. */
export interface IBaseHalfCanvasContribution extends IDisposable { }

export interface IBaseHalfCanvasContributionContext {
	readonly canvas: IBaseHalfCanvasView;
}

export type BaseHalfCanvasContributionCtor = IConstructorSignature<IBaseHalfCanvasContribution, [IBaseHalfCanvasContributionContext]>;

export interface IBaseHalfCanvasContributionDescription {
	readonly id: string;
	readonly ctor: BaseHalfCanvasContributionCtor;
}

/**
 * Registers a feature of the canvas, as VS Code's code editor and terminal
 * register theirs (`registerEditorContribution`, `registerTerminalContribution`).
 * The canvas view creates each registered feature through dependency injection,
 * in the order of registration. Features live in `canvasContrib/<feature>/`,
 * which the canvas core never imports.
 */
export function registerBaseHalfCanvasContribution<Services extends BrandedService[]>(
	id: string,
	ctor: { new(context: IBaseHalfCanvasContributionContext, ...services: Services): IBaseHalfCanvasContribution }
): void {
	BaseHalfCanvasContributionRegistry.INSTANCE.register({ id, ctor: ctor as BaseHalfCanvasContributionCtor });
}

export namespace BaseHalfCanvasExtensionsRegistry {
	export function getCanvasContributions(): readonly IBaseHalfCanvasContributionDescription[] {
		return BaseHalfCanvasContributionRegistry.INSTANCE.getCanvasContributions();
	}
}

class BaseHalfCanvasContributionRegistry {
	static readonly INSTANCE = new BaseHalfCanvasContributionRegistry();

	private readonly contributions: IBaseHalfCanvasContributionDescription[] = [];

	register(description: IBaseHalfCanvasContributionDescription): void {
		if (this.contributions.some(contribution => contribution.id === description.id)) {
			throw new Error(`A canvas feature with the id ${description.id} is registered already.`);
		}
		this.contributions.push(description);
	}

	getCanvasContributions(): readonly IBaseHalfCanvasContributionDescription[] {
		return this.contributions.slice(0);
	}
}
