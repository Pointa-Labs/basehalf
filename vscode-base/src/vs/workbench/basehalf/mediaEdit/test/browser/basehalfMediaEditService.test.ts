/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { dirname, isEqual, joinPath, relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfFileClonesService } from '../../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { FileSystemProviderCapabilities, IFileDeleteOptions, IFileStatWithPartialMetadata } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IBaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { IBaseHalfReferenceEditService } from '../../../references/common/basehalfReferenceEdit.js';
import { IBaseHalfKeptVersionsService } from '../../../workspace/browser/basehalfKeptVersions.js';
import { IBaseHalfMovedItemsService } from '../../../workspace/common/basehalfMovedItemsService.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { BaseHalfMediaEditService, baseHalfMediaVersion } from '../../browser/basehalfMediaEditService.js';
import { parseBaseHalfEditRecord } from '../../common/basehalfEditRecord.js';
import { readBaseHalfIsoBmffFile } from '../../common/basehalfIsoBmffReader.js';
import { baseHalfTestByteSource, makeBaseHalfTestVideo } from './basehalfVideoTrimFixtures.js';

const WORKSPACE = URI.file('/workspace');
const VIDEO = joinPath(WORKSPACE, 'shots', 'shot.mp4');
const CARD_INFORMATION = joinPath(WORKSPACE, '.bh', 'mirror', 'shots', 'shot.mp4');
const ORIGINAL = joinPath(CARD_INFORMATION, 'original.mp4');
const RECORD = joinPath(CARD_INFORMATION, 'edit.yaml');
const FILE = { resource: VIDEO, workspaceFolder: WORKSPACE, relativePath: 'shots/shot.mp4' };

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

/** A file service whose video changes once, right after the next stat of it. */
class ChangingFileService extends FileService {
	change: Uint8Array | undefined;

	override async stat(resource: URI): Promise<IFileStatWithPartialMetadata> {
		const stat = await super.stat(resource);
		const change = this.change;
		if (change && isEqual(resource, VIDEO)) {
			this.change = undefined;
			await this.writeFile(VIDEO, VSBuffer.wrap(change));
		}
		return stat;
	}
}

suite('BaseHalfMediaEditService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function setUp() {
		const fileService = disposables.add(new ChangingFileService(new NullLogService()));
		const provider = disposables.add(new TrashingFileSystemProvider());
		disposables.add(fileService.registerProvider(Schemas.file, provider));
		// The steps of exact undo: what each changes, creates (+), and removes (-), and what it made.
		const steps: string[] = [];
		// What each step that changes files in place says becomes of its versions when the window closes.
		const closes: (string | undefined)[] = [];
		const path = (resource: URI) => relativePath(WORKSPACE, resource);
		const keptVersions: Partial<IBaseHalfKeptVersionsService> = {
			replaceFiles: async (changes, options) => {
				closes.push(options.whenClosed);
				const told: string[] = [];
				for (const change of changes) {
					const present = await fileService.exists(change.resource);
					if (change.contents === null) {
						await fileService.del(change.resource);
					} else if (URI.isUri(change.contents)) {
						await fileService.createFolder(dirname(change.resource));
						await fileService.move(change.contents, change.resource, true);
					} else {
						await fileService.writeFile(change.resource, change.contents);
					}
					told.push(`${change.contents === null ? '-' : present ? '' : '+'}${path(change.resource)}`);
				}
				steps.push(`${options.label}: ${told.join(', ')}`);
			},
			recordMade: (items, options) => {
				steps.push(`${options.label}: made ${items.map(path).join(', ')}`);
			}
		};
		const clones: Partial<IBaseHalfFileClonesService> = {
			clone: async (source, target) => {
				await fileService.copy(source, target, false);
			}
		};
		const canvasMirror: Partial<IBaseHalfCanvasMirrorService> = { readCanvas: async () => null };
		const connections: string[] = [];
		const referenceEdit: Partial<IBaseHalfReferenceEditService> = {
			add: async (node, entry) => {
				connections.push(`${entry} → ${node.relativePath}`);
				return { stores: [], changed: true };
			}
		};
		const coordinator: Partial<IBaseHalfWorkspaceMutationCoordinator> = {
			runExclusive: (_workspace, task) => task({ workspaceKeys: [], release: () => { } } as IBaseHalfWorkspaceMutationLease)
		};
		// What following moved items was told is gone and no move to recognize.
		const deletes: string[] = [];
		const movedItems: Partial<IBaseHalfMovedItemsService> = { acceptWorkbenchDelete: (_workspace, deleted) => deletes.push(deleted) };
		const notifications: string[] = [];
		const notificationService: Partial<INotificationService> = {
			info: message => {
				notifications.push(`info: ${message}`);
			},
			error: message => {
				notifications.push(`error: ${message}`);
			}
		};
		const service = disposables.add(new BaseHalfMediaEditService(
			fileService,
			keptVersions as IBaseHalfKeptVersionsService,
			clones as IBaseHalfFileClonesService,
			canvasMirror as IBaseHalfCanvasMirrorService,
			referenceEdit as IBaseHalfReferenceEditService,
			coordinator as IBaseHalfWorkspaceMutationCoordinator,
			movedItems as IBaseHalfMovedItemsService,
			new TestConfigurationService({ explorer: { incrementalNaming: 'simple' } }),
			{} as IDialogService,
			notificationService as INotificationService,
			new NullLogService()
		));
		return { fileService, service, steps, closes, connections, notifications, trashed: provider.trashed, deletes };
	}

	async function framesOf(fileService: FileService, resource: URI): Promise<{ readonly frames: number; readonly sound: boolean }> {
		const file = await readBaseHalfIsoBmffFile(baseHalfTestByteSource((await fileService.readFile(resource)).value.buffer), 'mp4');
		return { frames: file.video!.samples.length, sound: !!file.audio?.samples.length };
	}

	test('Done keeps the file as it was as the original, with the record; the next edit starts from the original; Revert puts it back (D84)', async function () {
		this.timeout(60_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 60, fps: 30, sound: true });
		if (!bytes) {
			this.skip();
		}
		const { fileService, service, steps, closes, notifications, trashed } = setUp();
		await fileService.writeFile(VIDEO, VSBuffer.wrap(bytes));

		const first = await service.readEditState(FILE);
		await service.save(FILE, first, { keep: [{ start: 0.5, end: 1.5 }] });
		const editedSize = (await fileService.stat(VIDEO)).size;
		const afterFirst = await framesOf(fileService, VIDEO);
		const record = parseBaseHalfEditRecord((await fileService.readFile(RECORD)).value.toString());
		const originalKept = (await fileService.readFile(ORIGINAL)).value.buffer;

		// Card Detail shows the file: the end of the next step is shown there, not in a notification.
		const shown = service.showFile(VIDEO);
		const second = await service.readEditState(FILE);
		await service.save(FILE, second, { keep: [{ start: 0.2, end: 1.9 }] });
		const afterSecond = await framesOf(fileService, VIDEO);
		const third = await service.readEditState(FILE);
		const version = baseHalfMediaVersion(await fileService.stat(VIDEO));
		const last = service.lastSave(VIDEO, version);
		await service.revert(FILE, third);
		shown.dispose();

		assert.deepStrictEqual({
			first: [first.source.path, first.record, first.video?.file.video?.samples.length],
			afterFirst,
			record: record && { original: record.original, size: record.result.size, keep: record.keep },
			originalKept: VSBuffer.wrap(originalKept).equals(VSBuffer.wrap(bytes)),
			second: [second.source.path, second.record?.keep, second.video?.file.video?.samples.length],
			// 1.7 s of the original's frames: the edited file held only 1 s of them.
			afterSecond,
			third: third.record?.keep,
			last: last && [last.kind, last.soundDropped],
			reverted: VSBuffer.wrap((await fileService.readFile(VIDEO)).value.buffer).equals(VSBuffer.wrap(bytes)),
			leftInCardInformation: await fileService.exists(ORIGINAL) || await fileService.exists(RECORD),
			leftInCache: ((await fileService.resolve(joinPath(WORKSPACE, '.bh', 'cache', 'edit'))).children ?? []).map(child => child.name),
			steps,
			closes,
			trashed,
			notifications,
			running: service.runningSave(VIDEO)
		}, {
			first: [VIDEO.path, undefined, 60],
			afterFirst: { frames: 30, sound: true },
			record: { original: 'original.mp4', size: editedSize, keep: [{ start: 0.5, end: 1.5 }] },
			originalKept: true,
			second: [ORIGINAL.path, [{ start: 0.5, end: 1.5 }], 60],
			afterSecond: { frames: 51, sound: true },
			third: [{ start: 0.2, end: 1.9 }],
			last: ['edit', false],
			reverted: true,
			leftInCardInformation: false,
			leftInCache: [],
			steps: [
				'Edit shot.mp4: shots/shot.mp4, +.bh/mirror/shots/shot.mp4/edit.yaml, +.bh/mirror/shots/shot.mp4/original.mp4',
				'Edit shot.mp4: shots/shot.mp4, .bh/mirror/shots/shot.mp4/edit.yaml',
				'Revert shot.mp4: shots/shot.mp4, -.bh/mirror/shots/shot.mp4/original.mp4, -.bh/mirror/shots/shot.mp4/edit.yaml'
			],
			// What the steps keep is deleted when the window closes: the original holds what the Trash would.
			closes: ['delete', 'delete', 'delete'],
			trashed: [],
			notifications: ['info: Edited shot.mp4.'],
			running: undefined
		});
	});

	test('the record says the fingerprint of the file it made: a file another program changed is edited as it is, and Done keeps it as the new original (D84)', async function () {
		this.timeout(60_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 45, fps: 30, sound: false });
		const other = await makeBaseHalfTestVideo({ frames: 36, fps: 30, sound: false });
		if (!bytes || !other) {
			this.skip();
		}
		const { fileService, service, steps, trashed, deletes } = setUp();
		await fileService.writeFile(VIDEO, VSBuffer.wrap(bytes));
		await service.save(FILE, await service.readEditState(FILE), { keep: [{ start: 0, end: 1 }] });
		const editedSize = (await fileService.stat(VIDEO)).size;
		const record = parseBaseHalfEditRecord((await fileService.readFile(RECORD)).value.toString())!;
		await fileService.writeFile(VIDEO, VSBuffer.wrap(other));
		const changed = await service.readEditState(FILE);
		await service.save(FILE, changed, { keep: [{ start: 0.2, end: 1.2 }] });
		assert.deepStrictEqual({
			result: [record.result.size, /^[0-9a-f]{64}$/.test(record.result.hash)],
			changed: [changed.source.path, changed.record],
			newOriginal: VSBuffer.wrap((await fileService.readFile(ORIGINAL)).value.buffer).equals(VSBuffer.wrap(other)),
			frames: await framesOf(fileService, VIDEO),
			steps: steps.slice(1),
			trashed,
			deletes
		}, {
			result: [editedSize, true],
			changed: [VIDEO.path, undefined],
			newOriginal: true,
			frames: { frames: 30, sound: false },
			// The original before is of no version that the step changes: it went to the Trash beside the file.
			steps: ['Edit shot.mp4: shots/shot.mp4, .bh/mirror/shots/shot.mp4/edit.yaml, +.bh/mirror/shots/shot.mp4/original.mp4'],
			trashed: ['shots/shot original.mp4'],
			deletes: ['shots/shot original.mp4']
		});
	});

	test('Done on a file whose record cannot be read keeps the record as a recovery copy, and sends each original there, of any extension, to the Trash beside the file under a free name (D84)', async function () {
		this.timeout(60_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 45, fps: 30, sound: false });
		if (!bytes) {
			this.skip();
		}
		const { fileService, service, steps, closes, trashed } = setUp();
		await fileService.writeFile(VIDEO, VSBuffer.wrap(bytes));
		await fileService.writeFile(RECORD, VSBuffer.fromString('original: [the record'));
		await fileService.writeFile(joinPath(CARD_INFORMATION, 'original.mov'), VSBuffer.fromString('the video when it was a MOV'));
		// A file of the user's has the name the original would take.
		await fileService.writeFile(joinPath(WORKSPACE, 'shots', 'shot original.mov'), VSBuffer.fromString('a file of the user'));
		const state = await service.readEditState(FILE);
		await service.save(FILE, state, { keep: [{ start: 0, end: 1 }] });
		const recovered = await fileService.resolve(joinPath(WORKSPACE, '.bh', 'cache', 'recovered', 'mirror', 'shots', 'shot.mp4'));
		const copy = recovered.children?.[0];
		assert.deepStrictEqual({
			record: state.record,
			trashed,
			recovered: copy && [/^edit\.[0-9a-f]{12}\.yaml$/.test(copy.name), (await fileService.readFile(copy.resource)).value.toString()],
			usersFile: (await fileService.readFile(joinPath(WORKSPACE, 'shots', 'shot original.mov'))).value.toString(),
			cardInformation: ((await fileService.resolve(CARD_INFORMATION)).children ?? []).map(child => child.name).sort(),
			steps,
			closes
		}, {
			record: undefined,
			trashed: ['shots/shot original 2.mov'],
			recovered: [true, 'original: [the record'],
			usersFile: 'a file of the user',
			cardInformation: ['edit.yaml', 'original.mp4'],
			steps: ['Edit shot.mp4: shots/shot.mp4, .bh/mirror/shots/shot.mp4/edit.yaml, +.bh/mirror/shots/shot.mp4/original.mp4'],
			closes: ['delete']
		});
	});

	test('Save as New writes the edit into a new file named as Duplicate names a copy, connected from the file, as one made step; the file stays as it was (D84)', async function () {
		this.timeout(60_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 60, fps: 30, sound: false });
		if (!bytes) {
			this.skip();
		}
		const { fileService, service, steps, connections, notifications } = setUp();
		await fileService.writeFile(VIDEO, VSBuffer.wrap(bytes));
		const state = await service.readEditState(FILE);
		const saved = await service.saveAsNew(FILE, state, { keep: [{ start: 1, end: 2 }] });
		const again = await service.saveAsNew(FILE, state, { mute: true, keep: [{ start: 0, end: 1 }] });
		const noEdit = await service.saveAsNew(FILE, state, {}).then(() => undefined, (error: Error) => error.message);
		assert.deepStrictEqual({
			saved: [relativePath(WORKSPACE, saved.resource), saved.kind, saved.version === state.version],
			again: relativePath(WORKSPACE, again.resource),
			frames: await framesOf(fileService, saved.resource),
			fileAsItWas: VSBuffer.wrap((await fileService.readFile(VIDEO)).value.buffer).equals(VSBuffer.wrap(bytes)),
			records: [await fileService.exists(RECORD), await fileService.exists(joinPath(WORKSPACE, '.bh', 'mirror', 'shots', 'shot copy.mp4', 'edit.yaml'))],
			connections,
			steps,
			notifications,
			noEdit
		}, {
			saved: ['shots/shot copy.mp4', 'new', true],
			again: 'shots/shot copy 2.mp4',
			frames: { frames: 30, sound: false },
			fileAsItWas: true,
			records: [false, false],
			connections: ['shots/shot.mp4 → shots/shot copy.mp4', 'shots/shot.mp4 → shots/shot copy 2.mp4'],
			steps: ['Save shot copy.mp4: made shots/shot copy.mp4', 'Save shot copy 2.mp4: made shots/shot copy 2.mp4'],
			notifications: ['info: Saved shot copy.mp4.', 'info: Saved shot copy 2.mp4.'],
			noEdit: 'make an edit first.'
		});
	});

	test('Done of choices that keep the whole original reverts an edited file, and a muted video has no sound (D84)', async function () {
		this.timeout(60_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 45, fps: 30, sound: true });
		if (!bytes) {
			this.skip();
		}
		const { fileService, service, steps } = setUp();
		await fileService.writeFile(VIDEO, VSBuffer.wrap(bytes));
		await service.save(FILE, await service.readEditState(FILE), { mute: true });
		const muted = await framesOf(fileService, VIDEO);
		const record = parseBaseHalfEditRecord((await fileService.readFile(RECORD)).value.toString());
		await service.save(FILE, await service.readEditState(FILE), {});
		assert.deepStrictEqual({
			muted,
			record: record && [record.mute, record.keep],
			reverted: VSBuffer.wrap((await fileService.readFile(VIDEO)).value.buffer).equals(VSBuffer.wrap(bytes)),
			steps: steps.map(step => step.split(':')[0])
		}, {
			muted: { frames: 45, sound: false },
			record: [true, undefined],
			reverted: true,
			steps: ['Edit shot.mp4', 'Revert shot.mp4']
		});
	});

	test('a file that changes while it is edited is not replaced, and the save says why (D84)', async function () {
		this.timeout(60_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 45, fps: 30, sound: false });
		if (!bytes) {
			this.skip();
		}
		const { fileService, service, steps, notifications } = setUp();
		await fileService.writeFile(VIDEO, VSBuffer.wrap(bytes));
		// The same video with a box of free space after it: another size.
		const changed = new Uint8Array(bytes.length + 8);
		changed.set(bytes);
		changed.set([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65], bytes.length);
		const state = await service.readEditState(FILE);
		fileService.change = changed;
		await fileService.stat(VIDEO);
		const failure = await service.save(FILE, state, { keep: [{ start: 0, end: 1 }] }).then(() => undefined, (error: Error) => error.message);
		assert.deepStrictEqual({
			failure,
			steps,
			size: (await fileService.stat(VIDEO)).size,
			kept: await fileService.exists(ORIGINAL),
			notifications
		}, {
			failure: 'the file changed meanwhile.',
			steps: [],
			size: changed.length,
			kept: false,
			notifications: ['error: BaseHalf could not save the edit of shot.mp4: the file changed meanwhile.']
		});
	});

	test('a sound keeps its parts joined in its own format, its original kept, and Revert puts it back (D84)', async () => {
		const { fileService, service, steps } = setUp();
		const rate = 8000;
		const samples = new Uint8Array(rate * 2 * 2);
		const view = new DataView(samples.buffer);
		for (let index = 0; index < rate * 2; index++) {
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
		const sound = joinPath(WORKSPACE, 'takes', 'take.wav');
		const file = { resource: sound, workspaceFolder: WORKSPACE, relativePath: 'takes/take.wav' };
		await fileService.writeFile(sound, VSBuffer.wrap(wav));
		const state = await service.readEditState(file);
		await service.save(file, state, { keep: [{ start: 0, end: 0.5 }, { start: 1.5, end: 2 }] });
		const edited = (await fileService.readFile(sound)).value.buffer;
		const record = parseBaseHalfEditRecord((await fileService.readFile(joinPath(WORKSPACE, '.bh', 'mirror', 'takes', 'take.wav', 'edit.yaml'))).value.toString());
		const again = await service.readEditState(file);
		await service.revert(file, again);
		assert.deepStrictEqual({
			state: [state.kind, state.sound?.format, state.sound?.duration],
			length: new DataView(edited.buffer, edited.byteOffset).getUint32(40, true) / 2,
			// The second part starts at sample 12000, faded in: its 40th sample is at full level.
			joined: new DataView(edited.buffer, edited.byteOffset + 44).getInt16((4000 + 40) * 2, true),
			record: record?.keep,
			again: [again.source.path.endsWith('/original.wav'), again.record?.keep?.length],
			reverted: VSBuffer.wrap((await fileService.readFile(sound)).value.buffer).equals(VSBuffer.wrap(wav)),
			steps: steps.map(step => step.split(':')[0])
		}, {
			state: ['sound', 'wav', 2],
			length: 8000,
			joined: (12040 % 2000) - 1000,
			record: [{ start: 0, end: 0.5 }, { start: 1.5, end: 2 }],
			again: [true, 2],
			reverted: true,
			steps: ['Edit take.wav', 'Revert take.wav']
		});
	});

	test('a file of a format that is not edited, or that is gone, says why Edit is not offered (D84)', async () => {
		const { fileService, service } = setUp();
		await fileService.writeFile(joinPath(WORKSPACE, 'shots', 'loop.gif'), VSBuffer.fromString('GIF89a'));
		const gif = await service.readEditState({ resource: joinPath(WORKSPACE, 'shots', 'loop.gif'), workspaceFolder: WORKSPACE, relativePath: 'shots/loop.gif' });
		const gone = await service.readEditState(FILE);
		await fileService.writeFile(VIDEO, VSBuffer.fromString('not a video'));
		const damaged = await service.readEditState(FILE);
		assert.deepStrictEqual([gif.unavailable, gone.unavailable, damaged.unavailable?.startsWith('BaseHalf can\'t edit this video: ')], [
			'BaseHalf can\'t edit GIF images',
			'BaseHalf can\'t edit this file: it could not be read.',
			true
		]);
	});
});
