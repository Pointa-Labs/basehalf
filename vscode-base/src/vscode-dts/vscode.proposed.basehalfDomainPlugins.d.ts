/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export namespace basehalf {
		export interface CardProjectionView {
			readonly webview: Webview;
			/** Whether the projection is currently visible in BaseHalf's card detail surface. */
			readonly visible: boolean;
			/** Event fired when {@link CardProjectionView.visible visibility} has changed. */
			readonly onDidChangeVisibility: Event<void>;
			/** Event fired when the card projection is permanently disposed. */
			readonly onDidDispose: Event<void>;
			/**
			 * Marks whether the projection contains changes that are not yet in
			 * the user-owned project file. Dirty projections block BaseHalf
			 * navigation until the plugin saves or discards those changes.
			 */
			setDirty(dirty: boolean): void;
		}

		export interface CardProjectionProvider {
			resolveCardProjection(resource: Uri, view: CardProjectionView, token: CancellationToken): ProviderResult<void>;
		}

		export interface CardProjectionProviderOptions {
			readonly retainContextWhenHidden?: boolean;
		}

		/**
		 * Registers the runtime provider for a projection declared through
		 * `contributes.basehalfCardProjections` in this extension's manifest.
		 */
		export function registerCardProjectionProvider(
			projectionId: string,
			provider: CardProjectionProvider,
			options?: CardProjectionProviderOptions
		): Disposable;
	}
}
