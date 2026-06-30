/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { ITextEditorSelection } from '../../../platform/editor/common/editor.js';
import { BaseHalfCardDetailProjection } from './basehalfCardDetail.js';
import {
	BaseHalfNavigationResult,
	BaseHalfOpenSource,
	IBaseHalfCanvasNavigationService,
	IBaseHalfOpenResourceOptions
} from './basehalfCanvasNavigation.js';

type BaseHalfHandledNavigationResult = Extract<BaseHalfNavigationResult, { readonly handled: true }>;
type BaseHalfNavigationFallbackReason = Extract<BaseHalfNavigationResult, { readonly handled: false }>['reason'];

export type BaseHalfOpenRoutingFallbackReason =
	| BaseHalfNavigationFallbackReason
	| 'forcedVSCodeEditor';

export type BaseHalfOpenRoutingResult =
	| BaseHalfHandledNavigationResult
	| { readonly handled: false; readonly reason: BaseHalfOpenRoutingFallbackReason };

export interface IBaseHalfOpenRoutingOptions {
	readonly source: BaseHalfOpenSource;
	readonly selection?: ITextEditorSelection;
	readonly preserveFocus?: boolean;
	readonly pinned?: boolean;
	readonly projection?: BaseHalfCardDetailProjection;
	readonly sideBySide?: boolean;
	readonly forceVSCodeEditor?: boolean;
}

export type BaseHalfOpenRoutingDecision =
	| { readonly route: 'basehalf'; readonly options: IBaseHalfOpenResourceOptions }
	| { readonly route: 'vscode'; readonly reason: 'forcedVSCodeEditor' };

export function getBaseHalfOpenRoutingDecision(options: IBaseHalfOpenRoutingOptions): BaseHalfOpenRoutingDecision {
	if (options.forceVSCodeEditor) {
		return { route: 'vscode', reason: 'forcedVSCodeEditor' };
	}

	return {
		route: 'basehalf',
		options: {
			source: options.source,
			selection: options.selection,
			preserveFocus: options.preserveFocus,
			pinned: options.pinned,
			projection: options.projection
		}
	};
}

export async function tryOpenBaseHalfResource(
	canvasNavigationService: IBaseHalfCanvasNavigationService,
	resource: URI,
	options: IBaseHalfOpenRoutingOptions
): Promise<BaseHalfOpenRoutingResult> {
	const decision = getBaseHalfOpenRoutingDecision(options);
	if (decision.route === 'vscode') {
		return { handled: false, reason: decision.reason };
	}

	return canvasNavigationService.openResource(resource, decision.options);
}

export function shouldFallbackToVSCodeEditorAfterBaseHalfRouting(result: BaseHalfOpenRoutingResult): boolean {
	return !result.handled && result.reason !== 'blockedByDirtyEditor';
}
