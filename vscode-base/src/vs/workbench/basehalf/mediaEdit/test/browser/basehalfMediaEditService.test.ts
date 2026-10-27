/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath, relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfFileClonesService } from '../../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { IBaseHalfFileTimesService } from '../../../../../platform/basehalfFiles/common/basehalfFileTimes.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { FileSystemProviderCapabilities, IFileDeleteOptions } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationHandle, IPromptChoice, Severity } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IUndoRedoElement, UndoRedoGroup, UndoRedoSource } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { UndoRedoService } from '../../../../../platform/undoRedo/common/undoRedoService.js';
import { TestLifecycleService } from '../../../../test/common/workbenchTestServices.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../../canvas/common/basehalfCanvasEditing.js';
import { baseHalfNoMovedItems } from '../../../references/test/browser/basehalfReferenceTestFixtures.js';
import { IBaseHalfMovedItemsService } from '../../../workspace/common/basehalfMovedItemsService.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { BaseHalfMediaEditService } from '../../browser/basehalfMediaEditService.js';
import { parseBaseHalfEditRecord } from '../../common/basehalfEditRecord.js';
import { readBaseHalfIsoBmffFile } from '../../common/basehalfIsoBmffReader.js';
import { baseHalfTestByteSource, makeBaseHalfTestVideo } from './basehalfVideoTrimFixtures.js';

const WORKSPACE = URI.file('/workspace');
const VIDEO = joinPath(WORKSPACE, 'shots', 'shot.mp4');
const VIDEO_INFORMATION = joinPath(WORKSPACE, '.bh', 'mirror', 'shots', 'shot.mp4');
const VIDEO_FILE = { resource: VIDEO, workspaceFolder: WORKSPACE, relativePath: 'shots/shot.mp4' };
const SOUND = joinPath(WORKSPACE, 'takes', 'take.wav');
const SOUND_INFORMATION = joinPath(WORKSPACE, '.bh', 'mirror', 'takes', 'take.wav');
const SOUND_FILE = { resource: SOUND, workspaceFolder: WORKSPACE, relativePath: 'takes/take.wav' };
const CACHE = joinPath(WORKSPACE, '.bh', 'cache', 'edit');

/** A disk with a Trash: what goes there is listed, and leaves the disk. */
class TrashingFileSystemProvider extends InMemoryFileSystemProvider {
	readonly trashed: string[] = [];

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities | FileSystemProviderCapabilities.Trash;
	}

	override async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		if (opts.useTrash) {
			this.trashed.push(relativePath(WORKSPACE, resource)!);
		}
		return super.delete(resource, { ...opts, useTrash: false });
	}
}

/** The canvas undo of the window, which lists the names of the steps pushed to it. */
class RecordingUndoRedoService extends UndoRedoService {
	readonly labels: string[] = [];

	override pushElement(element: IUndoRedoElement, group?: UndoRedoGroup, source?: UndoRedoSource): void {
		this.labels.push(element.label);
		super.pushElement(element, group, source);
	}
}

/** Two seconds of a 16-bit mono WAV at 8 kHz, a saw of 2,000 samples. */
function makeWav(seconds = 2): Uint8Array {
	const rate = 8000;
	const samples = new Uint8Array(rate * seconds * 2);
	const view = new DataView(samples.buffer);
	for (let index = 0; index < rate * seconds; index++) {
		view.setInt16(index * 2, (index % 2000) - 1000, true);
	}
	const header = new Uint8Array(44);
	const head = new DataView(header.buffer);
	header.set(Array.from('RIFF\0\0\0\0WAVEfmt ', character => character.charCodeAt(0)));
	head.setUint32(4, 36 + samples.length, true);
	head.setUint32(16, 16, true);
	head.setUint16(20, 1, true);
	head.setUint16(22, 1, true);
	head.setUint32(24, rate, true);
	head.setUint32(28, rate * 2, true);
	head.setUint16(32, 2, true);
	head.setUint16(34, 16, true);
	header.set(Array.from('data', character => character.charCodeAt(0)), 36);
	head.setUint32(40, samples.length, true);
	const wav = new Uint8Array(44 + samples.length);
	wav.set(header);
	wav.set(samples, 44);
	return wav;
}

suite('BaseHalfMediaEditService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function setUp() {
		const fileService = disposables.add(new FileService(new NullLogService()));
		const provider = disposables.add(new TrashingFileSystemProvider());
		disposables.add(fileService.registerProvider(Schemas.file, provider));
		// A clone fails while `failing` says why, and waits while `held` holds it.
		const clones = {
			failing: undefined as string | undefined,
			held: undefined as Promise<void> | undefined,
			service: {
				_serviceBrand: undefined,
				clone: async (source: URI, target: URI) => {
					await clones.held;
					if (clones.failing) {
						throw new Error(clones.failing);
					}
					await fileService.copy(source, target, false);
				}
			} satisfies IBaseHalfFileClonesService
		};
		const fileTimesService: IBaseHalfFileTimesService = { _serviceBrand: undefined, touch: async () => { } };
		const notifications: string[] = [];
		const prompts: IPromptChoice[][] = [];
		const notificationService = new class extends TestNotificationService {
			override info(message: string): INotificationHandle {
				notifications.push(`info: ${message}`);
				return super.info(message);
			}
			override prompt(severity: Severity, message: string, choices: IPromptChoice[]): INotificationHandle {
				notifications.push(`${severity === Severity.Error ? 'error' : 'prompt'}: ${message} [${choices.map(choice => choice.label).join(', ')}]`);
				prompts.push(choices);
				return super.prompt(severity, message, choices);
			}
		};
		const deletes: string[] = [];
		const movedItems: IBaseHalfMovedItemsService = { ...baseHalfNoMovedItems, acceptWorkbenchDelete: (_workspaceFolder, path) => deletes.push(path) };
		const undoRedoService = new RecordingUndoRedoService(new TestDialogService(), new TestNotificationService());
		const lifecycleService = disposables.add(new TestLifecycleService());
		const service = disposables.add(new BaseHalfMediaEditService(
			fileService,
			clones.service,
			fileTimesService,
			new BaseHalfWorkspaceMutationCoordinator(),
			movedItems,
			undoRedoService,
			new TestConfigurationService({ files: { enableTrash: true } }),
			notificationService,
			lifecycleService,
			new NullLogService()
		));
		// No two changes of these tests are one step unless a test says so.
		service.setTimingsForTest({ rest: 1_000, merge: 0 });
		const bytesOf = async (resource: URI) => (await fileService.readFile(resource)).value.buffer;
		const same = (a: Uint8Array, b: Uint8Array) => VSBuffer.wrap(a).equals(VSBuffer.wrap(b));
		const recordOf = async (information: URI) => await fileService.exists(joinPath(information, 'edit.yaml'))
			? parseBaseHalfEditRecord((await fileService.readFile(joinPath(information, 'edit.yaml'))).value.toString())
			: undefined;
		const cacheNames = async () => ((await fileService.resolve(CACHE).catch(() => undefined))?.children ?? []).filter(child => child.isFile).map(child => child.name);
		const undo = () => Promise.resolve(undoRedoService.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE));
		const redo = () => Promise.resolve(undoRedoService.redo(BASEHALF_CANVAS_UNDO_REDO_SOURCE));
		return { fileService, service, clones, notifications, prompts, trashed: provider.trashed, deletes, undoRedoService, lifecycleService, bytesOf, same, recordOf, cacheNames, undo, redo };
	}

	async function framesOf(fileService: FileService, resource: URI): Promise<number> {
		const file = await readBaseHalfIsoBmffFile(baseHalfTestByteSource((await fileService.readFile(resource)).value.buffer), 'mp4');
		return file.video!.samples.length;
	}

	test('a change is one step of the canvas undo that the file follows once the choices rest: the first keeps the file as the original, and undo and redo put back the very bytes (D85)', async function () {
		this.timeout(60_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 60, fps: 30, sound: true });
		if (!bytes) {
			this.skip();
		}
		const { fileService, service, undoRedoService, notifications, trashed, bytesOf, same, recordOf, undo, redo, lifecycleService, cacheNames } = setUp();
		await fileService.writeFile(VIDEO, VSBuffer.wrap(bytes));
		service.setTimingsForTest({ rest: 20, merge: 0 });
		const state = await service.readEditState(VIDEO_FILE);

		service.change(VIDEO_FILE, state, { keep: [{ start: 0.5, end: 1.5 }] }, 'Trim shot.mp4');
		// The editor shows the change at once; the file waits for the choices to rest.
		const resting = { choices: service.choicesOf(VIDEO, state), writing: service.writing(VIDEO), file: same(await bytesOf(VIDEO), bytes) };
		await timeout(60);
		const writing = service.writing(VIDEO)?.state;
		await service.flush(VIDEO);
		const first = await bytesOf(VIDEO);
		const firstFrames = await framesOf(fileService, VIDEO);
		const firstRecord = await recordOf(VIDEO_INFORMATION);
		const original = same(await bytesOf(joinPath(VIDEO_INFORMATION, 'original.mp4')), bytes);

		// The next change is encoded from the original.
		service.change(VIDEO_FILE, state, { keep: [{ start: 0.2, end: 1.9 }] }, 'Trim shot.mp4');
		await service.flush(VIDEO);
		const second = await bytesOf(VIDEO);
		const secondFrames = await framesOf(fileService, VIDEO);

		await undo();
		const undone = service.choicesOf(VIDEO, state);
		await service.flush(VIDEO);
		const afterUndo = same(await bytesOf(VIDEO), first);
		await redo();
		await service.flush(VIDEO);
		const afterRedo = same(await bytesOf(VIDEO), second);

		service.revertToOriginal(VIDEO_FILE, state);
		await service.flush(VIDEO);
		const reverted = [same(await bytesOf(VIDEO), bytes), await fileService.exists(joinPath(VIDEO_INFORMATION, 'original.mp4')), await fileService.exists(joinPath(VIDEO_INFORMATION, 'edit.yaml'))];
		await undo();
		await service.flush(VIDEO);
		const revertUndone = [same(await bytesOf(VIDEO), second), same(await bytesOf(joinPath(VIDEO_INFORMATION, 'original.mp4')), bytes), (await recordOf(VIDEO_INFORMATION))?.keep];
		// Card Detail of the file, opened again, starts where the writes left it.
		const again = await service.readEditState(VIDEO_FILE);

		// The window closes: what it kept for undo goes.
		lifecycleService.fireShutdown();
		await Promise.all(lifecycleService.shutdownJoiners);

		assert.deepStrictEqual({
			resting,
			writing,
			firstFrames,
			firstRecord: firstRecord && [firstRecord.original, firstRecord.result.size === first.length, firstRecord.keep],
			original,
			// 1.7 s of the original's frames: the file held only 1 s of them.
			secondFrames,
			undone,
			afterUndo,
			afterRedo,
			reverted,
			revertUndone,
			again: [relativePath(WORKSPACE, again.source), again.record?.keep, service.choicesOf(VIDEO, again)],
			labels: undoRedoService.labels,
			trashed,
			notifications,
			cache: await cacheNames()
		}, {
			resting: { choices: { keep: [{ start: 0.5, end: 1.5 }] }, writing: undefined, file: true },
			writing: 'writing',
			firstFrames: 30,
			firstRecord: ['original.mp4', true, [{ start: 0.5, end: 1.5 }]],
			original: true,
			secondFrames: 51,
			undone: { keep: [{ start: 0.5, end: 1.5 }] },
			afterUndo: true,
			afterRedo: true,
			reverted: [true, false, false],
			revertUndone: [true, true, [{ start: 0.2, end: 1.9 }]],
			again: ['.bh/mirror/shots/shot.mp4/original.mp4', [{ start: 0.2, end: 1.9 }], { keep: [{ start: 0.2, end: 1.9 }] }],
			labels: ['Trim shot.mp4', 'Trim shot.mp4', 'Revert shot.mp4 to Original'],
			// Editing puts nothing in the Trash, and says nothing while it works.
			trashed: [],
			notifications: [],
			cache: []
		});
	});

	test('changes of one name within a moment are one step, choices that are no edit put the original back, and nothing is written while they rest (D85)', async () => {
		const { fileService, service, undoRedoService, bytesOf, same, recordOf, undo } = setUp();
		const wav = makeWav();
		await fileService.writeFile(SOUND, VSBuffer.wrap(wav));
		service.setTimingsForTest({ rest: 60_000, merge: 60_000 });
		const state = await service.readEditState(SOUND_FILE);
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 1.9 }] }, 'Trim take.wav');
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 1.8 }] }, 'Trim take.wav');
		// The same choices again are no change.
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 1.8 }] }, 'Trim take.wav');
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 0.5 }, { start: 1.5, end: 1.8 }] }, 'Cut take.wav');
		const resting = [await fileService.exists(joinPath(SOUND_INFORMATION, 'edit.yaml')), same(await bytesOf(SOUND), wav)];
		await service.flush(SOUND);
		const cut = await recordOf(SOUND_INFORMATION);
		const length = new DataView((await bytesOf(SOUND)).buffer).getUint32(40, true) / 2;
		await undo();
		const afterOne = service.choicesOf(SOUND, state);
		// The two trims were one step: one more undo is the whole sound.
		await undo();
		const afterTwo = service.choicesOf(SOUND, state);
		await service.flush(SOUND);
		assert.deepStrictEqual({
			labels: undoRedoService.labels,
			resting,
			cut: cut?.keep,
			length,
			afterOne,
			afterTwo,
			whole: [same(await bytesOf(SOUND), wav), await fileService.exists(joinPath(SOUND_INFORMATION, 'original.wav')), await fileService.exists(joinPath(SOUND_INFORMATION, 'edit.yaml'))],
			canUndo: undoRedoService.canUndo(BASEHALF_CANVAS_UNDO_REDO_SOURCE)
		}, {
			labels: ['Trim take.wav', 'Cut take.wav'],
			resting: [false, true],
			cut: [{ start: 0, end: 0.5 }, { start: 1.5, end: 1.8 }],
			length: 6400,
			afterOne: { keep: [{ start: 0, end: 1.8 }] },
			afterTwo: {},
			whole: [true, false, false],
			canUndo: false
		});
	});

	test('a file is written once at a time: a change while a write runs is written after it (D85)', async () => {
		const { fileService, service, clones, recordOf } = setUp();
		await fileService.writeFile(SOUND, VSBuffer.wrap(makeWav()));
		const state = await service.readEditState(SOUND_FILE);
		let release!: () => void;
		clones.held = new Promise(resolve => release = resolve);
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 1 }] }, 'Trim take.wav');
		const flushed = service.flush(SOUND);
		await timeout(10);
		const during = service.writing(SOUND)?.state;
		service.change(SOUND_FILE, state, { keep: [{ start: 0.5, end: 1 }] }, 'Trim take.wav');
		// The write that runs goes on, and the next waits for it.
		const stillOne = service.writing(SOUND)?.state;
		release();
		await flushed;
		assert.deepStrictEqual({
			during,
			stillOne,
			record: (await recordOf(SOUND_INFORMATION))?.keep,
			after: service.writing(SOUND)
		}, {
			during: 'writing',
			stillOne: 'writing',
			record: [{ start: 0.5, end: 1 }],
			after: undefined
		});
	});

	test('a write that finds the file changed outside BaseHalf writes nothing and drops what it did not write, and the steps before say so (D85)', async () => {
		const { fileService, service, notifications, recordOf, undo, bytesOf } = setUp();
		await fileService.writeFile(SOUND, VSBuffer.wrap(makeWav()));
		const state = await service.readEditState(SOUND_FILE);
		const dropped: string[] = [];
		disposables.add(service.onDidDropChoices(resource => dropped.push(relativePath(WORKSPACE, resource)!)));
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 1 }] }, 'Trim take.wav');
		await fileService.writeFile(SOUND, VSBuffer.fromString('another program wrote this'));
		await service.flush(SOUND);
		const file = VSBuffer.wrap(await bytesOf(SOUND)).toString();
		const record = await recordOf(SOUND_INFORMATION);
		await undo();
		assert.deepStrictEqual({ file, record, dropped, choices: service.choicesOf(SOUND, state), notifications }, {
			file: 'another program wrote this',
			record: undefined,
			dropped: ['takes/take.wav'],
			choices: {},
			notifications: ['info: \'take.wav\' changed meanwhile. Undo did not change it.']
		});
	});

	test('a write that fails leaves the file as it was and says why, under the editor or in a notification, and Try Again writes it (D85)', async () => {
		const { fileService, service, clones, notifications, prompts, recordOf, bytesOf, same } = setUp();
		const wav = makeWav();
		await fileService.writeFile(SOUND, VSBuffer.wrap(wav));
		const state = await service.readEditState(SOUND_FILE);
		clones.failing = 'the disk is full';
		// While Card Detail shows the file, the line under its editor says it.
		const shown = service.showFile(SOUND);
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 1 }] }, 'Trim take.wav');
		await service.flush(SOUND);
		const failed = [service.writing(SOUND), same(await bytesOf(SOUND), wav), await fileService.exists(joinPath(SOUND_INFORMATION, 'original.wav')), [...notifications]];
		shown.dispose();
		service.retry(SOUND);
		await service.flush(SOUND);
		const notified = [...notifications];
		clones.failing = undefined;
		prompts[0][0].run();
		await service.flush(SOUND);
		assert.deepStrictEqual({ failed, notified, record: (await recordOf(SOUND_INFORMATION))?.keep, writing: service.writing(SOUND) }, {
			failed: [{ state: 'failed', failure: 'the disk is full' }, true, false, []],
			notified: ['error: BaseHalf could not save the edit of take.wav: the disk is full [Try Again]'],
			record: [{ start: 0, end: 1 }],
			writing: undefined
		});
	});

	test('the record says the fingerprint of the file it made: a file another program changed is edited as it is, and its first change keeps it as the new original, the originals before to the Trash beside it (D85)', async () => {
		const { fileService, service, trashed, deletes, recordOf, bytesOf, same } = setUp();
		await fileService.writeFile(SOUND, VSBuffer.wrap(makeWav()));
		service.change(SOUND_FILE, await service.readEditState(SOUND_FILE), { keep: [{ start: 0, end: 1 }] }, 'Trim take.wav');
		await service.flush(SOUND);
		const record = (await recordOf(SOUND_INFORMATION))!;
		// Another program writes another take, a moment later.
		const other = makeWav(1.5);
		await timeout(5);
		await fileService.writeFile(SOUND, VSBuffer.wrap(other));
		// The original of the take when it was an MP3, and a file of the user's with the name it would take in the Trash.
		await fileService.writeFile(joinPath(SOUND_INFORMATION, 'original.mp3'), VSBuffer.fromString('the take when it was an MP3'));
		await fileService.writeFile(joinPath(WORKSPACE, 'takes', 'take original.mp3'), VSBuffer.fromString('a file of the user'));
		const changed = await service.readEditState(SOUND_FILE);
		service.change(SOUND_FILE, changed, { keep: [{ start: 0.2, end: 0.8 }] }, 'Trim take.wav');
		await service.flush(SOUND);
		assert.deepStrictEqual({
			result: [record.result.size, /^[0-9a-f]{64}$/.test(record.result.hash)],
			changed: [relativePath(WORKSPACE, changed.source), changed.record],
			newOriginal: same(await bytesOf(joinPath(SOUND_INFORMATION, 'original.wav')), other),
			record: (await recordOf(SOUND_INFORMATION))?.keep,
			trashed: trashed.sort(),
			deletes: deletes.sort(),
			usersFile: VSBuffer.wrap(await bytesOf(joinPath(WORKSPACE, 'takes', 'take original.mp3'))).toString()
		}, {
			result: [8000 * 2 + 44, true],
			changed: ['takes/take.wav', undefined],
			newOriginal: true,
			record: [{ start: 0.2, end: 0.8 }],
			// What the card information held of the edit before is of no version that the change makes.
			trashed: ['takes/take original 2.mp3', 'takes/take original.wav'],
			deletes: ['takes/take original 2.mp3', 'takes/take original.wav'],
			usersFile: 'a file of the user'
		});
	});

	test('a record that cannot be read is left as it is until the first change, which keeps it as a recovery copy (D85)', async () => {
		const { fileService, service, recordOf } = setUp();
		await fileService.writeFile(SOUND, VSBuffer.wrap(makeWav()));
		await fileService.writeFile(joinPath(SOUND_INFORMATION, 'edit.yaml'), VSBuffer.fromString('original: [the record'));
		const state = await service.readEditState(SOUND_FILE);
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 1 }] }, 'Trim take.wav');
		await service.flush(SOUND);
		const recovered = await fileService.resolve(joinPath(WORKSPACE, '.bh', 'cache', 'recovered', 'mirror', 'takes', 'take.wav'));
		const copy = recovered.children?.[0];
		assert.deepStrictEqual({
			record: state.record,
			recovered: copy && [/^edit\.[0-9a-f]{12}\.yaml$/.test(copy.name), (await fileService.readFile(copy.resource)).value.toString()],
			now: (await recordOf(SOUND_INFORMATION))?.keep
		}, {
			record: undefined,
			recovered: [true, 'original: [the record'],
			now: [{ start: 0, end: 1 }]
		});
	});

	test('the copy that an editor reads keeps the bytes it started from through writes and Revert to Original, and goes when it is let go (D85)', async () => {
		const { fileService, service, bytesOf, same } = setUp();
		const wav = makeWav();
		await fileService.writeFile(SOUND, VSBuffer.wrap(wav));
		const state = await service.readEditState(SOUND_FILE);
		const copy = await service.copySource(SOUND_FILE, state);
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 1 }] }, 'Trim take.wav');
		await service.flush(SOUND);
		// Card Detail opened again starts from the original, and its copy is the same bytes.
		const again = await service.readEditState(SOUND_FILE);
		const second = await service.copySource(SOUND_FILE, again);
		service.revertToOriginal(SOUND_FILE, again);
		await service.flush(SOUND);
		const kept = [same(await bytesOf(copy.resource), wav), same(await bytesOf(second.resource), wav)];
		copy.dispose();
		second.dispose();
		await timeout(0);
		assert.deepStrictEqual({ kept, gone: [await fileService.exists(copy.resource), await fileService.exists(second.resource)], source: relativePath(WORKSPACE, again.source) }, {
			kept: [true, true],
			gone: [false, false],
			source: '.bh/mirror/takes/take.wav/original.wav'
		});
	});

	test('a file moved, copied, or deleted holds what waits for its rest first, and a window that closes writes it (D85)', async () => {
		const { fileService, service, recordOf, lifecycleService } = setUp();
		await fileService.writeFile(SOUND, VSBuffer.wrap(makeWav()));
		service.setTimingsForTest({ rest: 60_000, merge: 0 });
		const state = await service.readEditState(SOUND_FILE);
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 1 }] }, 'Trim take.wav');
		await service.flushBelow([joinPath(WORKSPACE, 'shots')]);
		const elsewhere = await recordOf(SOUND_INFORMATION);
		await service.flushBelow([joinPath(WORKSPACE, 'takes')]);
		const below = (await recordOf(SOUND_INFORMATION))?.keep;
		service.change(SOUND_FILE, state, { keep: [{ start: 0, end: 0.5 }] }, 'Trim take.wav');
		lifecycleService.fireShutdown();
		await Promise.all(lifecycleService.shutdownJoiners);
		assert.deepStrictEqual({ elsewhere, below, closed: (await recordOf(SOUND_INFORMATION))?.keep }, {
			elsewhere: undefined,
			below: [{ start: 0, end: 1 }],
			closed: [{ start: 0, end: 0.5 }]
		});
	});

	test('a file of a format that is not edited, or that is gone or damaged, has no editor, and says why (D85)', async () => {
		const { fileService, service } = setUp();
		await fileService.writeFile(joinPath(WORKSPACE, 'shots', 'loop.gif'), VSBuffer.fromString('GIF89a'));
		const gif = await service.readEditState({ resource: joinPath(WORKSPACE, 'shots', 'loop.gif'), workspaceFolder: WORKSPACE, relativePath: 'shots/loop.gif' });
		const gone = await service.readEditState(VIDEO_FILE);
		await fileService.writeFile(VIDEO, VSBuffer.fromString('not a video'));
		const damaged = await service.readEditState(VIDEO_FILE);
		// A change of a file that can't be edited is no step.
		service.change(VIDEO_FILE, damaged, { keep: [{ start: 0, end: 1 }] }, 'Trim shot.mp4');
		assert.deepStrictEqual([gif.unavailable, gone.unavailable, damaged.unavailable?.startsWith('BaseHalf can\'t edit this video: '), service.writing(VIDEO)], [
			'BaseHalf can\'t edit GIF images',
			'BaseHalf can\'t edit this file: it could not be read.',
			true,
			undefined
		]);
	});
});
