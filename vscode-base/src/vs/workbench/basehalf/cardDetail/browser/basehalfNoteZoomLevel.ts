/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { BASEHALF_NOTE_ZOOM_STORAGE_KEY, normalizeBaseHalfNoteZoom } from '../common/basehalfNoteZoom.js';

/**
 * The level of notes for the page of one projection in Card Detail, kept in
 * the profile's storage. It keeps the level the page reports once a gesture
 * rests, and hands the page the levels that other projections and windows
 * keep, never the one the page reported itself: arriving after the page may
 * have zoomed on, that one would take it back (zoom and outline of a note,
 * rule 8).
 */
export class BaseHalfNoteZoomLevel extends Disposable {
	private reporting = false;

	constructor(
		private readonly storageService: IStorageService,
		onDidChangeElsewhere: (level: number) => void
	) {
		super();
		// The storage tells of a change before `store` returns.
		this._register(storageService.onDidChangeValue(StorageScope.PROFILE, BASEHALF_NOTE_ZOOM_STORAGE_KEY, this._store)(() => {
			if (!this.reporting) {
				onDidChangeElsewhere(this.level);
			}
		}));
	}

	/** The level a note opens at. */
	get level(): number {
		return normalizeBaseHalfNoteZoom(this.storageService.get(BASEHALF_NOTE_ZOOM_STORAGE_KEY, StorageScope.PROFILE));
	}

	/** Keeps the level the page reported once its gesture rested. */
	report(level: number): void {
		this.reporting = true;
		try {
			this.storageService.store(BASEHALF_NOTE_ZOOM_STORAGE_KEY, normalizeBaseHalfNoteZoom(level), StorageScope.PROFILE, StorageTarget.MACHINE);
		} finally {
			this.reporting = false;
		}
	}
}
