/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export interface IBaseHalfVideoModelConnectionReturnTarget {
	readonly kind: 'videoModel';
	readonly sceneKey: string;
	readonly nodePath: string;
	/** Immutable logical node identity; a path may be deleted and reused while settings are open. */
	readonly documentId: string;
	readonly recipeId: string;
	readonly catalogId: string;
	readonly modelKey: {
		readonly provider: string;
		readonly deployment: string;
		readonly region: string;
		readonly modelId: string;
		readonly revision: string;
	};
}

export type BaseHalfModelConnectionReturnTarget = IBaseHalfVideoModelConnectionReturnTarget;

export interface IBaseHalfModelConnectionIntent {
	readonly requestId: string;
	readonly specId: string;
	readonly returnTarget?: BaseHalfModelConnectionReturnTarget;
}

export interface IBaseHalfModelConnectionCompletion {
	readonly intent: IBaseHalfModelConnectionIntent;
	readonly serviceId: string;
}

export const IBaseHalfModelConnectionNavigationService = createDecorator<IBaseHalfModelConnectionNavigationService>('baseHalfModelConnectionNavigationService');

/**
 * Coordinates the one transient trip from a locked model row to the application
 * connection editor and back. Intents deliberately remain in memory: project
 * files, settings, history, and crash recovery must never contain UI navigation
 * state or a pending model choice.
 */
export interface IBaseHalfModelConnectionNavigationService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeIntent: Event<IBaseHalfModelConnectionIntent | undefined>;
	readonly onDidComplete: Event<IBaseHalfModelConnectionCompletion>;
	readonly intent: IBaseHalfModelConnectionIntent | undefined;
	begin(specId: string, returnTarget?: BaseHalfModelConnectionReturnTarget): IBaseHalfModelConnectionIntent;
	completeRequest(requestId: string, specId: string, serviceId: string): boolean;
	cancel(requestId: string): boolean;
}

/**
 * Completes only the request captured before an asynchronous connection check.
 * An absent capture must never fall through to whichever intent is current when
 * the check finishes.
 */
export function completeCapturedBaseHalfModelConnectionRequest(
	service: Pick<IBaseHalfModelConnectionNavigationService, 'completeRequest'>,
	requestId: string | undefined,
	specId: string,
	serviceId: string
): boolean {
	return requestId !== undefined && service.completeRequest(requestId, specId, serviceId);
}

export class BaseHalfModelConnectionNavigationService extends Disposable implements IBaseHalfModelConnectionNavigationService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeIntent = this._register(new Emitter<IBaseHalfModelConnectionIntent | undefined>());
	readonly onDidChangeIntent = this._onDidChangeIntent.event;
	private readonly _onDidComplete = this._register(new Emitter<IBaseHalfModelConnectionCompletion>());
	readonly onDidComplete = this._onDidComplete.event;

	private currentIntent: IBaseHalfModelConnectionIntent | undefined;

	get intent(): IBaseHalfModelConnectionIntent | undefined {
		return this.currentIntent;
	}

	begin(specId: string, returnTarget?: BaseHalfModelConnectionReturnTarget): IBaseHalfModelConnectionIntent {
		const normalizedSpecId = specId.trim().toLowerCase();
		if (!normalizedSpecId) {
			throw new Error('A model connection intent requires a provider connection specification.');
		}
		const intent: IBaseHalfModelConnectionIntent = Object.freeze({
			requestId: generateUuid(),
			specId: normalizedSpecId,
			...(returnTarget ? { returnTarget: freezeReturnTarget(returnTarget) } : {})
		});
		this.currentIntent = intent;
		this._onDidChangeIntent.fire(intent);
		return intent;
	}

	completeRequest(requestId: string, specId: string, serviceId: string): boolean {
		const intent = this.currentIntent;
		const normalizedSpecId = specId.trim().toLowerCase();
		const normalizedServiceId = serviceId.trim().toLowerCase();
		if (!intent
			|| intent.requestId !== requestId
			|| intent.specId !== normalizedSpecId
			|| intent.specId !== normalizedServiceId) {
			return false;
		}
		this.currentIntent = undefined;
		this._onDidChangeIntent.fire(undefined);
		this._onDidComplete.fire(Object.freeze({ intent, serviceId: normalizedServiceId }));
		return true;
	}

	cancel(requestId: string): boolean {
		const intent = this.currentIntent;
		if (!intent || intent.requestId !== requestId) {
			return false;
		}
		this.currentIntent = undefined;
		this._onDidChangeIntent.fire(undefined);
		return true;
	}
}

function freezeReturnTarget(target: BaseHalfModelConnectionReturnTarget): BaseHalfModelConnectionReturnTarget {
	return Object.freeze({
		...target,
		modelKey: Object.freeze({ ...target.modelKey })
	});
}

registerSingleton(IBaseHalfModelConnectionNavigationService, BaseHalfModelConnectionNavigationService, InstantiationType.Delayed);
