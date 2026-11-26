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

/** Where a file stands: the first line that shows, and in a view larger than a card what was being read there. */
export interface IBaseHalfFilePlace {
	readonly top: number;
	readonly focus?: number;
}

export const IBaseHalfFilePlacesService = createDecorator<IBaseHalfFilePlacesService>('baseHalfFilePlacesService');

/**
 * Where a file's card or view stands (code cards, "The place"). A file has one place while
 * the window is open, whichever surface moved it last, as an editor keeps its view state.
 * A file at its first line has none, so that this holds only what was moved.
 */
export interface IBaseHalfFilePlacesService {
	readonly _serviceBrand: undefined;
	/** A surface moved a file's place. `from` is the surface, which already stands there. */
	readonly onDidChange: Event<{ readonly resource: URI; readonly from: object }>;
	placeOf(resource: URI): IBaseHalfFilePlace | undefined;
	setPlace(resource: URI, place: IBaseHalfFilePlace, from: object): void;
}

export class BaseHalfFilePlacesService extends Disposable implements IBaseHalfFilePlacesService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<{ readonly resource: URI; readonly from: object }>());
	readonly onDidChange = this._onDidChange.event;

	private readonly places: ResourceMap<IBaseHalfFilePlace>;

	constructor(@IUriIdentityService uriIdentityService: IUriIdentityService) {
		super();
		this.places = new ResourceMap<IBaseHalfFilePlace>(uri => uriIdentityService.extUri.getComparisonKey(uri));
	}

	placeOf(resource: URI): IBaseHalfFilePlace | undefined {
		return this.places.get(resource);
	}

	setPlace(resource: URI, place: IBaseHalfFilePlace, from: object): void {
		const top = Math.max(1, Math.floor(place.top));
		const known = this.places.get(resource);
		if ((known?.top ?? 1) === top && known?.focus === place.focus) {
			return;
		}
		if (top === 1 && place.focus === undefined) {
			this.places.delete(resource);
		} else {
			this.places.set(resource, place.focus === undefined ? { top } : { top, focus: place.focus });
		}
		this._onDidChange.fire({ resource, from });
	}
}

registerSingleton(IBaseHalfFilePlacesService, BaseHalfFilePlacesService, InstantiationType.Delayed);
