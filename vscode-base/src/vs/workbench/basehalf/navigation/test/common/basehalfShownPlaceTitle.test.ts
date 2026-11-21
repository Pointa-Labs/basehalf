/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IResolvedTextFileEditorModel, ITextFileEditorModel, ITextFileEditorModelManager, ITextFileSaveEvent, ITextFileService, TextFileEditorModelState } from '../../../../services/textfile/common/textfiles.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCanvasNavigationState } from '../../common/basehalfCanvasNavigation.js';
import { BaseHalfShownPlaceTitleService } from '../../common/basehalfShownPlaceTitle.js';

suite('BaseHalf: what the title of the window says of the shown place', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const WORKSPACE = URI.file('/workspace');
	const FOLDER = URI.file('/workspace/drafts');
	const NOTE = URI.file('/workspace/drafts/Plan.md');
	const CODE = URI.file('/workspace/drafts/add.ts');

	const canvas: IBaseHalfCanvasNavigationState = {
		canvasFolder: { resource: FOLDER, workspaceFolder: WORKSPACE, relativePath: 'drafts', source: 'explorer' },
		cardDetail: undefined
	};
	const cardDetailOf = (resource: URI, relativePath: string): IBaseHalfCanvasNavigationState => ({
		canvasFolder: canvas.canvasFolder,
		cardDetail: { resource, workspaceFolder: WORKSPACE, relativePath, source: 'quickAccess', projection: 'rich' }
	});

	function setUp() {
		const didChangeState = store.add(new Emitter<IBaseHalfCanvasNavigationState>());
		const didChangeSurfaceActive = store.add(new Emitter<boolean>());
		const navigation = new class extends mock<IBaseHalfCanvasNavigationService>() {
			override readonly onDidChangeState = didChangeState.event;
			override readonly onDidChangeSurfaceActive = didChangeSurfaceActive.event;
			override isSurfaceActive = true;
			override state: IBaseHalfCanvasNavigationState = { canvasFolder: undefined, cardDetail: undefined };
		};
		// The one text file the window holds, as far as the title asks: whether it holds changes, and how its last save went.
		const file = { resource: NOTE, dirty: false, state: TextFileEditorModelState.SAVED };
		const model: ITextFileEditorModel = new class extends mock<ITextFileEditorModel>() {
			override get resource() { return file.resource; }
			override isDirty(): this is IResolvedTextFileEditorModel { return file.dirty; }
			override hasState(state: TextFileEditorModelState) { return file.state === state; }
		};
		const didChangeDirty = store.add(new Emitter<ITextFileEditorModel>());
		const textFiles = new class extends mock<ITextFileService>() {
			override readonly files = new class extends mock<ITextFileEditorModelManager>() {
				override readonly onDidChangeDirty = didChangeDirty.event;
				override readonly onDidSaveError = Event.None;
				override readonly onDidSave: Event<ITextFileSaveEvent> = Event.None;
				override readonly onDidRevert = Event.None;
				override get(resource: URI) { return resource.toString() === file.resource.toString() ? model : undefined; }
			};
		};
		const saving = { shortDelay: true };
		const filesConfiguration = new class extends mock<IFilesConfigurationService>() {
			override readonly onDidChangeAutoSaveConfiguration = Event.None;
			override hasShortAutoSaveDelay() { return saving.shortDelay; }
		};
		const service = store.add(new BaseHalfShownPlaceTitleService(navigation, textFiles, filesConfiguration));
		let changes = 0;
		store.add(service.onDidChange(() => changes++));
		const read = () => {
			const title = service.title;
			return title ? { file: title.file?.path, name: title.name, folder: title.folder.path, unsaved: title.unsaved } : undefined;
		};
		return { navigation, file, saving, model, didChangeDirty, didChangeState, didChangeSurfaceActive, read, changes: () => changes };
	}

	test('a canvas is named by its folder, and a file in Card Detail by the name BaseHalf shows for it, over that folder', () => {
		const { navigation, read } = setUp();
		const nothing = read();
		navigation.state = canvas;
		const onCanvas = read();
		navigation.state = cardDetailOf(NOTE, 'drafts/Plan.md');
		const note = read();
		navigation.state = cardDetailOf(CODE, 'drafts/add.ts');
		const code = read();
		// A file that opens over no canvas of its own, as one of another workspace folder, stands in its own folder.
		navigation.state = { canvasFolder: undefined, cardDetail: cardDetailOf(NOTE, 'drafts/Plan.md').cardDetail };
		const withoutCanvas = read();
		navigation.isSurfaceActive = false;
		const covered = read();
		assert.deepStrictEqual({ nothing, onCanvas, note, code, withoutCanvas, covered }, {
			nothing: undefined,
			onCanvas: { file: undefined, name: '', folder: '/workspace/drafts', unsaved: false },
			note: { file: '/workspace/drafts/Plan.md', name: 'Plan', folder: '/workspace/drafts', unsaved: false },
			code: { file: '/workspace/drafts/add.ts', name: 'add.ts', folder: '/workspace/drafts', unsaved: false },
			withoutCanvas: { file: '/workspace/drafts/Plan.md', name: 'Plan', folder: '/workspace/drafts', unsaved: false },
			covered: undefined
		});
	});

	test('a file that saves itself shows no unsaved changes, unless its save failed or met a change on the disk', () => {
		const { navigation, file, saving, read } = setUp();
		navigation.state = cardDetailOf(NOTE, 'drafts/Plan.md');
		const unsaved = () => read()!.unsaved;
		file.dirty = true;
		file.state = TextFileEditorModelState.DIRTY;
		const aboutToBeSaved = unsaved();
		file.state = TextFileEditorModelState.ERROR;
		const saveFailed = unsaved();
		file.state = TextFileEditorModelState.CONFLICT;
		const changedOnTheDisk = unsaved();
		file.state = TextFileEditorModelState.DIRTY;
		saving.shortDelay = false;
		const savedOnlyWhenTold = unsaved();
		file.dirty = false;
		file.state = TextFileEditorModelState.SAVED;
		const saved = unsaved();
		assert.deepStrictEqual({ aboutToBeSaved, saveFailed, changedOnTheDisk, savedOnlyWhenTold, saved },
			{ aboutToBeSaved: false, saveFailed: true, changedOnTheDisk: true, savedOnlyWhenTold: true, saved: false });
	});

	test('a change of the place is told, and of the changes of the shown file, and of no other file', () => {
		const { navigation, file, model, didChangeDirty, didChangeState, didChangeSurfaceActive, changes } = setUp();
		navigation.state = cardDetailOf(NOTE, 'drafts/Plan.md');
		didChangeState.fire(navigation.state);
		const afterPlace = changes();
		didChangeDirty.fire(model);
		const afterShownFile = changes();
		file.resource = CODE;
		didChangeDirty.fire(model);
		const afterOtherFile = changes();
		didChangeSurfaceActive.fire(false);
		assert.deepStrictEqual({ afterPlace, afterShownFile, afterOtherFile, afterCovered: changes() }, { afterPlace: 1, afterShownFile: 2, afterOtherFile: 2, afterCovered: 3 });
	});
});
