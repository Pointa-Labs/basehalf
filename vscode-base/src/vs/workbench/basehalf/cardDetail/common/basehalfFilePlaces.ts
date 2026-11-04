/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';

export const IBaseHalfFilePlacesService = createDecorator<IBaseHalfFilePlacesService>('baseHalfFilePlacesService');

/**
 * The first line that a file's card or view shows (code cards, "The place"). A file has
 * one while the window is open, whichever surface moved it last, as an editor keeps its
 * view state. A file at its first line has none, so that this holds only what was moved.
 */
export interface IBaseHalfFilePlacesService {
	readonly _serviceBrand: undefined;
	/** A surface moved a file's place. `from` is the surface, which already stands there. */
	readonly onDidChange: Event<{ readonly resource: URI; readonly from: object }>;
	placeOf(resource: URI): number | undefined;
	setPlace(resource: URI, line: number, from: object): void;
}

export class BaseHalfFilePlacesService extends Disposable implements IBaseHalfFilePlacesService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<{ readonly resource: URI; readonly from: object }>());
	readonly onDidChange = this._onDidChange.event;

	private readonly places: ResourceMap<number>;

	constructor(@IUriIdentityService uriIdentityService: IUriIdentityService) {
		super();
		this.places = new ResourceMap<number>(uri => uriIdentityService.extUri.getComparisonKey(uri));
	}

	placeOf(resource: URI): number | undefined {
		return this.places.get(resource);
	}

	setPlace(resource: URI, line: number, from: object): void {
		const place = Math.max(1, Math.floor(line));
		if ((this.places.get(resource) ?? 1) === place) {
			return;
		}
		if (place === 1) {
			this.places.delete(resource);
		} else {
			this.places.set(resource, place);
		}
		this._onDidChange.fire({ resource, from });
	}
}

registerSingleton(IBaseHalfFilePlacesService, BaseHalfFilePlacesService, InstantiationType.Delayed);
