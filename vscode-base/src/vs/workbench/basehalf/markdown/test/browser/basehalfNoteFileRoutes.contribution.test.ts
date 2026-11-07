/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBulkEditService, ResourceFileEdit } from '../../../../../editor/browser/services/bulkEditService.js';
import { IBaseHalfFileClonesService } from '../../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IUndoRedoService, UndoRedoSource } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { BulkEditService } from '../../../../contrib/bulkEdit/browser/bulkEditService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { IBaseHalfMovedItemsService } from '../../../upkeep/common/basehalfMovedItemsService.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../../canvas/common/basehalfCanvasEditing.js';
import { BaseHalfNoteFileRoutesContribution } from '../../browser/basehalfNoteFileRoutes.contribution.js';

const FOLDER = URI.file('/workspace');

suite('BaseHalfNoteFileRoutesContribution', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function open(files: Record<string, string>) {
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(joinPath(FOLDER, ...path.split('/')), VSBuffer.fromString(content));
		}
		const configuration = new TestConfigurationService({ files: { autoSave: 'off' } });
		const instantiationService = workbenchInstantiationService({ fileService: () => fileService, configurationService: () => configuration }, disposables);
		instantiationService.stub(IWorkspaceContextService, new TestContextService(testWorkspace(FOLDER)));
		const bulkEdit = instantiationService.createInstance(BulkEditService);
		instantiationService.stub(IBulkEditService, bulkEdit);
		// The comparison of moved items never ends here: only moves are corrected.
		instantiationService.stub(IBaseHalfMovedItemsService, { whenCompared: () => new Promise<void>(() => { }), onDidRecognize: Event.None } as Partial<IBaseHalfMovedItemsService> as IBaseHalfMovedItemsService);
		instantiationService.stub(IBaseHalfFileClonesService, { clone: (source: URI, target: URI) => fileService.copy(source, target, false).then(() => undefined) } as Partial<IBaseHalfFileClonesService> as IBaseHalfFileClonesService);
		const asked: string[] = [];
		const dialogs = instantiationService.get(IDialogService);
		dialogs.prompt = async prompt => {
			asked.push(prompt.message);
			return { result: undefined };
		};
		dialogs.confirm = async confirmation => {
			asked.push(confirmation.message);
			return { confirmed: false };
		};
		disposables.add(instantiationService.createInstance(BaseHalfNoteFileRoutesContribution));
		const textFileService = instantiationService.get(ITextFileService);
		const text = (path: string) => textFileService.files.get(joinPath(FOLDER, ...path.split('/')))?.textEditorModel?.getValue();
		// What an editor would show: the note's model, or its file once no model is left.
		const shown = async (path: string) => text(path) ?? (await fileService.readFile(joinPath(FOLDER, ...path.split('/')))).value.toString();
		const move = (from: string, to: string, source: UndoRedoSource | undefined) => bulkEdit.apply([new ResourceFileEdit(joinPath(FOLDER, ...from.split('/')), joinPath(FOLDER, ...to.split('/')))], { undoRedoSource: source, label: 'Move' });
		const close = async () => {
			// The editors' notes go with the test.
			await new Promise(resolve => setTimeout(resolve, 0));
			for (const model of textFileService.files.models) {
				model.dispose();
			}
		};
		// Saved as BaseHalf writes a note no editor holds, before the user goes on.
		const saved = async (path: string) => {
			for (let wait = 0; wait < 100 && textFileService.isDirty(joinPath(FOLDER, ...path.split('/'))); wait++) {
				await new Promise(resolve => setTimeout(resolve, 10));
			}
		};
		return { fileService, textFileService, undoRedo: instantiationService.get(IUndoRedoService), asked, text, shown, move, saved, close };
	}

	test('an open note moved to another depth in BaseHalf has its routes corrected in the step of the move: an editor\'s undo leaves the correction, and one undo where the move was made takes both back, asking nothing (files in notes, rule 29)', async () => {
		const workspace = await open({
			'notes/n.md': '# N\n\n![x](../.bh/attachments/aaaaaaaaaa/x.png)\n',
			'notes/deep/other.md': '',
			'.bh/attachments/aaaaaaaaaa/x.png': 'x',
		});
		await workspace.textFileService.files.resolve(joinPath(FOLDER, 'notes', 'n.md'));
		const files = new UndoRedoSource();

		await workspace.move('notes/n.md', 'notes/deep/n.md', files);
		const moved = workspace.text('notes/deep/n.md');
		await workspace.saved('notes/deep/n.md');
		await workspace.undoRedo.undo(joinPath(FOLDER, 'notes', 'deep', 'n.md'));
		const afterEditorUndo = await workspace.shown('notes/deep/n.md');
		await workspace.undoRedo.undo(files);
		const back = workspace.text('notes/n.md');
		const there = await workspace.fileService.exists(joinPath(FOLDER, 'notes', 'deep', 'n.md'));
		await workspace.close();

		assert.deepStrictEqual({ moved, afterEditorUndo, back, there, asked: workspace.asked }, {
			moved: '# N\n\n![x](../../.bh/attachments/aaaaaaaaaa/x.png)\n',
			afterEditorUndo: '# N\n\n![x](../../.bh/attachments/aaaaaaaaaa/x.png)\n',
			back: '# N\n\n![x](../.bh/attachments/aaaaaaaaaa/x.png)\n',
			there: false,
			asked: [],
		});
	});

	test('a redo of a move brings the correction again with it, the undo of both comes again, and neither writes a correction of its own or asks anything (files in notes, rule 29)', async () => {
		const workspace = await open({
			'notes/n.md': '# N\n\n![x](../.bh/attachments/aaaaaaaaaa/x.png)\n',
			'notes/deep/other.md': '',
			'.bh/attachments/aaaaaaaaaa/x.png': 'x',
		});
		await workspace.textFileService.files.resolve(joinPath(FOLDER, 'notes', 'n.md'));
		const files = new UndoRedoSource();

		await workspace.move('notes/n.md', 'notes/deep/n.md', files);
		await workspace.saved('notes/deep/n.md');
		await workspace.undoRedo.undo(files);
		const back = workspace.text('notes/n.md');
		await workspace.undoRedo.redo(files);
		const again = workspace.text('notes/deep/n.md');
		await workspace.undoRedo.undo(files);
		const backAgain = workspace.text('notes/n.md');
		// The notes that appeared are read once their folder is quiet: their links lead somewhere.
		await new Promise(resolve => setTimeout(resolve, 400));
		const result = {
			back,
			again,
			backAgain,
			there: await workspace.fileService.exists(joinPath(FOLDER, 'notes', 'deep', 'n.md')),
			redo: workspace.undoRedo.canRedo(files),
			correctionsOfTheirOwn: workspace.undoRedo.canUndo(BASEHALF_CANVAS_UNDO_REDO_SOURCE),
			asked: workspace.asked,
		};
		await workspace.close();

		assert.deepStrictEqual(result, {
			back: '# N\n\n![x](../.bh/attachments/aaaaaaaaaa/x.png)\n',
			again: '# N\n\n![x](../../.bh/attachments/aaaaaaaaaa/x.png)\n',
			backAgain: '# N\n\n![x](../.bh/attachments/aaaaaaaaaa/x.png)\n',
			there: false,
			redo: true,
			correctionsOfTheirOwn: false,
			asked: [],
		});
	});

	test('a move made without an undo source, as an extension makes one, gives the correction none: an editor\'s Command-Z of the note takes back both, and asks nothing (files in notes, rule 29)', async () => {
		const workspace = await open({
			'notes/n.md': '# N\n\n![x](../.bh/attachments/aaaaaaaaaa/x.png)\n',
			'notes/deep/other.md': '',
			'.bh/attachments/aaaaaaaaaa/x.png': 'x',
		});
		await workspace.textFileService.files.resolve(joinPath(FOLDER, 'notes', 'n.md'));

		await workspace.move('notes/n.md', 'notes/deep/n.md', undefined);
		const moved = workspace.text('notes/deep/n.md');
		await workspace.undoRedo.undo(joinPath(FOLDER, 'notes', 'deep', 'n.md'));
		const back = workspace.text('notes/n.md');
		const there = await workspace.fileService.exists(joinPath(FOLDER, 'notes', 'deep', 'n.md'));
		await workspace.close();

		assert.deepStrictEqual({ moved, back, there, asked: workspace.asked }, {
			moved: '# N\n\n![x](../../.bh/attachments/aaaaaaaaaa/x.png)\n',
			back: '# N\n\n![x](../.bh/attachments/aaaaaaaaaa/x.png)\n',
			there: false,
			asked: [],
		});
	});

	test('a note no editor holds, moved in BaseHalf into another home, links clones in that home\'s store, written to the disk, in the step of the move (files in notes, rule 31)', async () => {
		const workspace = await open({
			'notes/n.md': '![x](../.bh/attachments/aaaaaaaaaa/x.png)\n',
			'repo/.git/HEAD': '',
			'.bh/attachments/aaaaaaaaaa/x.png': 'x',
		});
		const files = new UndoRedoSource();

		await workspace.move('notes/n.md', 'repo/n.md', files);
		const linked = /\]\((?<href>[^)]*)\)/.exec(workspace.text('repo/n.md') ?? '')?.groups?.href ?? '';
		// Saved as BaseHalf writes a note no editor holds.
		for (let wait = 0; wait < 100 && workspace.textFileService.isDirty(joinPath(FOLDER, 'repo', 'n.md')); wait++) {
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		const onDisk = (await workspace.fileService.readFile(joinPath(FOLDER, 'repo', 'n.md'))).value.toString();
		await workspace.close();

		assert.deepStrictEqual({
			linked: linked.replace(/attachments\/[a-z0-9]{10}\//, 'attachments/<new>/'),
			clone: (await workspace.fileService.readFile(joinPath(FOLDER, 'repo', ...linked.split('/')))).value.toString(),
			onDisk: onDisk === `![x](${linked})\n`,
			original: await workspace.fileService.exists(joinPath(FOLDER, '.bh', 'attachments', 'aaaaaaaaaa', 'x.png')),
		}, {
			linked: '.bh/attachments/<new>/x.png',
			clone: 'x',
			onDisk: true,
			original: true,
		});
	});
});
