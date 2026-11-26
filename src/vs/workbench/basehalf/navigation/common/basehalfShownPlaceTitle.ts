/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename, dirname, isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { ITextFileService, TextFileEditorModelState } from '../../../services/textfile/common/textfiles.js';
import { baseHalfItemDisplayName } from '../../workspace/common/basehalfItems.js';
import { IBaseHalfCanvasNavigationService } from './basehalfCanvasNavigation.js';
import { baseHalfShownCanvasFolder, baseHalfShownFile, onDidChangeBaseHalfShownPlace } from './basehalfShownPlace.js';

export const IBaseHalfShownPlaceTitleService = createDecorator<IBaseHalfShownPlaceTitleService>('baseHalfShownPlaceTitleService');

/** What the title of the window says of the shown place (the shown place and the workbench, "The title of the window"). */
export interface IBaseHalfShownPlaceTitle {
	/** The file that Card Detail shows; none while a canvas is shown. */
	readonly file: URI | undefined;
	/** The name BaseHalf shows for that file, a note without its extension; empty while a canvas is shown. */
	readonly name: string;
	/** The folder whose canvas is shown, also under Card Detail. */
	readonly folder: URI;
	/** Whether the file holds changes that are not about to be saved, as an editor of the base says it of its file. */
	readonly unsaved: boolean;
}

export interface IBaseHalfShownPlaceTitleService {
	readonly _serviceBrand: undefined;
	/** The place, or what `unsaved` says, may be another. */
	readonly onDidChange: Event<void>;
	/** Nothing while an editor of the base covers the canvas, which then names the window, and before a place is shown. */
	readonly title: IBaseHalfShownPlaceTitle | undefined;
}

export class BaseHalfShownPlaceTitleService extends Disposable implements IBaseHalfShownPlaceTitleService {

	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeEmitter = this._register(new Emitter<void>());
	readonly onDidChange = this.onDidChangeEmitter.event;

	constructor(
		@IBaseHalfCanvasNavigationService private readonly navigationService: IBaseHalfCanvasNavigationService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService
	) {
		super();
		this._register(onDidChangeBaseHalfShownPlace(this.navigationService)(() => this.onDidChangeEmitter.fire()));
		const files = this.textFileService.files;
		const ofShownFile = (resource: URI) => {
			const file = baseHalfShownFile(this.navigationService);
			if (file && isEqual(file, resource)) {
				this.onDidChangeEmitter.fire();
			}
		};
		this._register(files.onDidChangeDirty(model => ofShownFile(model.resource)));
		this._register(files.onDidSaveError(model => ofShownFile(model.resource)));
		this._register(files.onDidSave(event => ofShownFile(event.model.resource)));
		this._register(files.onDidRevert(model => ofShownFile(model.resource)));
		this._register(this.filesConfigurationService.onDidChangeAutoSaveConfiguration(() => this.onDidChangeEmitter.fire()));
	}

	get title(): IBaseHalfShownPlaceTitle | undefined {
		const file = baseHalfShownFile(this.navigationService);
		const folder = baseHalfShownCanvasFolder(this.navigationService) ?? (file ? dirname(file) : undefined);
		if (!folder) {
			return undefined;
		}
		return {
			file,
			name: file ? baseHalfItemDisplayName(basename(file), false) : '',
			folder,
			unsaved: !!file && this.isUnsaved(file)
		};
	}

	/**
	 * The base's rule for the mark of unsaved changes of a file (`FileEditorInput`): the file holds changes, and
	 * they are not about to be saved. A file that saves itself after a short delay is about to be saved unless
	 * its last save failed or met a change on the disk.
	 */
	private isUnsaved(file: URI): boolean {
		const model = this.textFileService.files.get(file);
		if (!model?.isDirty()) {
			return false;
		}
		if (model.hasState(TextFileEditorModelState.CONFLICT) || model.hasState(TextFileEditorModelState.ERROR)) {
			return true;
		}
		return !this.filesConfigurationService.hasShortAutoSaveDelay(file);
	}
}

registerSingleton(IBaseHalfShownPlaceTitleService, BaseHalfShownPlaceTitleService, InstantiationType.Delayed);
