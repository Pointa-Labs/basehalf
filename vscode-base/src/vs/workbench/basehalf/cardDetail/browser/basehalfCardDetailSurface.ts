/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextEditorSelection } from '../../../../platform/editor/common/editor.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfAgentSelectionDocumentText, IBaseHalfAgentSelectionText } from '../../agentArea/common/basehalfAgentSelection.js';
import { IBaseHalfDocumentSelection } from '../../documents/common/basehalfDocumentBranch.js';
import { BaseHalfMarkdownFormatCommand } from '../../markdown/common/basehalfMarkdownFormatting.js';
import { IBaseHalfCardDetailState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfCardDetailProjection } from '../common/basehalfCardDetail.js';

/**
 * Lifecycle contract for a projection hosted in BaseHalf's center surface.
 * Providers own only the body; Card Detail chrome and navigation remain core.
 */
export interface IBaseHalfCardDetailSurfaceInstance extends IDisposable {
	open(state: IBaseHalfCardDetailState): Promise<void>;
	activate(state: IBaseHalfCardDetailState): void;
	/** The file was opened again in the view that shows it, perhaps with other options. */
	update?(state: IBaseHalfCardDetailState): void;
	applySelection(selection: ITextEditorSelection | undefined): void;
	setVisible(visible: boolean): void;
	/** Takes the keyboard where the projection last had it (opening and closing Card Detail, "The keyboard"). */
	focus?(): void;
	setStructuralFrozen?(frozen: boolean): void;
	/**
	 * Card Detail fades in with what the projection draws once `open` has
	 * resolved (opening and closing Card Detail). A projection that does not
	 * say so shows itself after the transition: the browser holds a transition
	 * up for the first frame of a webview that has just started, such as an
	 * editor of a note (2 s, measured 2026-10-23).
	 */
	readonly drawsInTransitions?: boolean;
}

/** What the header of Card Detail says of the file's saving. */
export type BaseHalfCardDetailSaveStatus = 'saving' | 'saved' | 'error';

/**
 * What a projection reaches of the Card Detail that shows it: the header's
 * save status and its places for a projection's actions, what agents see
 * selected, and what the canvas under Card Detail does for a projection. The
 * view that hosts Card Detail makes one for each projection it shows.
 */
export interface IBaseHalfCardDetailHost {
	/** Says in the header that the file is being saved, is saved, or failed to save; `undefined` says nothing. */
	setSaveStatus(status: BaseHalfCardDetailSaveStatus | undefined): void;
	/** What agents can see selected in this projection, `undefined` when nothing is (the selection agents can see). */
	setSelectionForAgents(selected: IBaseHalfAgentSelectionText | IBaseHalfAgentSelectionDocumentText | undefined): void;
	/** Closes Card Detail. */
	close(): void;
	/** Where the header holds Edit and Done of a video, an image, or a sound (editing media). */
	readonly modeActions: HTMLElement;
	/** Where the header holds Revert to Original, after the file's name (D120). */
	readonly editActions: HTMLElement;
	/** Closes the popover of the badge editor of the card that Card Detail shows. */
	closeBadgePopover(): void;
	/** The format commands that the file's card held for Card Detail; each is given once. */
	takeFormatCommands(): readonly BaseHalfMarkdownFormatCommand[];
	/** Makes a note that grows from a passage of a PDF or a book (Grow Branch). */
	createDocumentBranch(resource: URI, selection: IBaseHalfDocumentSelection): Promise<void>;
	/** The user worked in the projection, which counts as working on the canvas. */
	noteUserInteraction(): void;
}

/**
 * How a projection is drawn. A projection's own folder registers it, as
 * Changes and Sequence do; Card Detail creates it in `parent` with the host
 * it reaches.
 */
export interface IBaseHalfCardDetailSurfaceProvider {
	create(parent: HTMLElement, state: IBaseHalfCardDetailState, host: IBaseHalfCardDetailHost): IBaseHalfCardDetailSurface;
}

export interface IBaseHalfCardDetailSurface {
	readonly host: HTMLElement;
	readonly instance: IBaseHalfCardDetailSurfaceInstance;
}

export const IBaseHalfCardDetailSurfaceRegistryService = createDecorator<IBaseHalfCardDetailSurfaceRegistryService>('baseHalfCardDetailSurfaceRegistryService');

export interface IBaseHalfCardDetailSurfaceRegistryService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeProviders: Event<BaseHalfCardDetailProjection>;

	registerProvider(projection: BaseHalfCardDetailProjection, provider: IBaseHalfCardDetailSurfaceProvider): IDisposable;
	hasProvider(projection: BaseHalfCardDetailProjection): boolean;
	create(projection: BaseHalfCardDetailProjection, parent: HTMLElement, state: IBaseHalfCardDetailState, host: IBaseHalfCardDetailHost): IBaseHalfCardDetailSurface;
}

export class BaseHalfCardDetailSurfaceRegistryService extends Disposable implements IBaseHalfCardDetailSurfaceRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly providers = new Map<BaseHalfCardDetailProjection, IBaseHalfCardDetailSurfaceProvider>();
	private readonly _onDidChangeProviders = this._register(new Emitter<BaseHalfCardDetailProjection>());
	readonly onDidChangeProviders = this._onDidChangeProviders.event;

	registerProvider(projection: BaseHalfCardDetailProjection, provider: IBaseHalfCardDetailSurfaceProvider): IDisposable {
		if (this.providers.has(projection)) {
			throw new Error(`A BaseHalf card detail surface provider for '${projection}' is already registered.`);
		}
		this.providers.set(projection, provider);
		this._onDidChangeProviders.fire(projection);
		return toDisposable(() => {
			if (this.providers.get(projection) === provider) {
				this.providers.delete(projection);
				this._onDidChangeProviders.fire(projection);
			}
		});
	}

	hasProvider(projection: BaseHalfCardDetailProjection): boolean {
		return this.providers.has(projection);
	}

	create(projection: BaseHalfCardDetailProjection, parent: HTMLElement, state: IBaseHalfCardDetailState, host: IBaseHalfCardDetailHost): IBaseHalfCardDetailSurface {
		const provider = this.providers.get(projection);
		if (!provider) {
			throw new Error(`No BaseHalf card detail surface provider is registered for '${projection}'.`);
		}
		return provider.create(parent, state, host);
	}
}

registerSingleton(IBaseHalfCardDetailSurfaceRegistryService, BaseHalfCardDetailSurfaceRegistryService, InstantiationType.Delayed);
