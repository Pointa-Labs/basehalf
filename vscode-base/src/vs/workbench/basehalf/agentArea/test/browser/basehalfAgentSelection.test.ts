/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { IStatusbarEntry, IStatusbarService } from '../../../../services/statusbar/browser/statusbar.js';
import { TestContextService, TestLifecycleService } from '../../../../test/common/workbenchTestServices.js';
import { baseHalfAgentSelectionResource, BaseHalfAgentSelectionService, BaseHalfAgentSelectionStatusContribution } from '../../browser/basehalfAgentSelection.contribution.js';
import { BASEHALF_SHOW_AGENT_SKILL_OFFER_COMMAND_ID, IBaseHalfAgentSkillNotifier } from '../../browser/basehalfAgentSkill.contribution.js';
import { BaseHalfAgentSelection, baseHalfAgentSelectionFor, IBaseHalfAgentSelectionInput, IBaseHalfAgentSelectionService, serializeBaseHalfAgentSelection } from '../../common/basehalfAgentSelection.js';
import { BaseHalfAgentSkillOffer, BaseHalfAgentSkillState, BASEHALF_AGENT_SKILL_TARGETS, IBaseHalfAgentSkillService } from '../../common/basehalfAgentSkill.js';

suite('BaseHalfAgentSelectionService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const notes = URI.file('/work/notes');
	const marked = URI.file('/work/source');

	async function setup(store: DisposableStore, states: BaseHalfAgentSkillState[], before?: (fileService: FileService) => Promise<void>) {
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.file, store.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(notes);
		await fileService.createFolder(marked);
		await fileService.writeFile(URI.joinPath(marked, '.basehalf-no-workspace-setup'), VSBuffer.fromString(''));
		await before?.(fileService);
		// Writes of the record can be made to fail, as on a full disk.
		const writes = { fail: false };
		const files = new Proxy(fileService, {
			get(target, property, receiver) {
				if (property === 'writeFile' && writes.fail) {
					return async () => { throw new Error('No space left on the device'); };
				}
				const value = Reflect.get(target, property, receiver);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});
		const skillChanged = store.add(new Emitter<void>());
		const skill = {
			states,
			_serviceBrand: undefined,
			available: true,
			onDidChange: skillChanged.event,
			inspect: async () => BASEHALF_AGENT_SKILL_TARGETS.map((target, index) => ({ ...target, resource: URI.file(`/home/${index}`), state: skill.states[index] })),
		};
		const focus = store.add(new Emitter<boolean>());
		const lifecycle = store.add(new TestLifecycleService());
		const service = store.add(new BaseHalfAgentSelectionService(
			files,
			skill as unknown as IBaseHalfAgentSkillService,
			{ onDidChangeFocus: focus.event } as unknown as IHostService,
			lifecycle,
			new TestContextService(testWorkspace(notes, marked)),
			new NullLogService()
		));
		const read = async (folder: URI) => {
			try {
				return (await fileService.readFile(baseHalfAgentSelectionResource(folder))).value.toString();
			} catch {
				return undefined;
			}
		};
		const setSkill = async (next: BaseHalfAgentSkillState[]) => {
			skill.states = next;
			skillChanged.fire();
			await timeout(0);
		};
		// The skill is read when the service starts.
		await timeout(0);
		return { fileService, service, lifecycle, read, setSkill, writes };
	}

	const input = (workspaceFolder: URI, cards: IBaseHalfAgentSelectionInput['cards'] = []): IBaseHalfAgentSelectionInput => ({
		workspaceFolder,
		workspaceFolderName: 'notes',
		folderPath: '.',
		cards
	});
	const recordOf = (value: IBaseHalfAgentSelectionInput) => serializeBaseHalfAgentSelection(baseHalfAgentSelectionFor(value));

	test('writes the record only while the skill is linked for an agent, after BaseHalf\'s ignore file', async () => {
		const store = disposables.add(new DisposableStore());
		const { fileService, service, read, setSkill } = await setup(store, ['missing', 'missing']);
		const selected = input(notes, [{ path: 'untitled.md', isFolder: false }]);
		const steps: unknown[] = [];

		service.update(selected);
		await service.flush();
		steps.push({ record: await read(notes), shown: service.current });

		await setSkill(['missing', 'linked']);
		await service.flush();
		steps.push({
			record: await read(notes),
			shown: service.current,
			ignoreFile: (await fileService.readFile(URI.joinPath(notes, '.bh', '.gitignore'))).value.toString().includes('/cache/')
		});

		// An earlier release's copy is not the installed skill until it is a link.
		await setSkill(['copy', 'missing']);
		await service.flush();
		steps.push({ record: await read(notes), shown: service.current });

		assert.deepStrictEqual(steps, [
			{ record: undefined, shown: undefined },
			{ record: recordOf(selected), shown: { selected: 'card', path: 'untitled.md', isFolder: false }, ignoreFile: true },
			{ record: undefined, shown: undefined },
		]);
	});

	test('keeps one record, in the workspace folder of the selection, and none in a marked folder', async () => {
		const store = disposables.add(new DisposableStore());
		const { service, read } = await setup(store, ['linked', 'linked']);
		const steps: unknown[] = [];
		const snapshot = async () => steps.push({ notes: await read(notes), marked: await read(marked), shown: service.current?.selected });

		service.update(input(notes));
		await service.flush();
		await snapshot();

		service.update(input(marked));
		await service.flush();
		await snapshot();

		const twoCards = input(notes, [{ path: 'a.md', isFolder: false }, { path: 'week 1', isFolder: true }]);
		service.update(twoCards);
		await service.flush();
		await snapshot();

		service.update(undefined);
		await service.flush();
		await snapshot();

		assert.deepStrictEqual(steps, [
			{ notes: recordOf(input(notes)), marked: undefined, shown: 'folder' },
			{ notes: undefined, marked: undefined, shown: undefined },
			{ notes: recordOf(twoCards), marked: undefined, shown: 'cards' },
			{ notes: undefined, marked: undefined, shown: undefined },
		]);
	});

	test('removes a record that a closed window left once the skill is missing, and keeps none after a failed write', async () => {
		const store = disposables.add(new DisposableStore());
		const leftover = recordOf(input(notes, [{ path: 'old.md', isFolder: false }]));
		const missing = await setup(store, ['missing', 'missing'], async fileService => {
			await fileService.writeFile(baseHalfAgentSelectionResource(notes), VSBuffer.fromString(leftover));
		});
		await missing.service.flush();
		const afterStart = await missing.read(notes);

		const installed = await setup(store, ['linked', 'missing']);
		installed.service.update(input(notes));
		await installed.service.flush();
		const written = await installed.read(notes);
		installed.writes.fail = true;
		installed.service.update(input(notes, [{ path: 'b.md', isFolder: false }]));
		await installed.service.flush();

		assert.deepStrictEqual(
			{ afterStart, written, afterFailedWrite: await installed.read(notes), shown: installed.service.current },
			{ afterStart: undefined, written: recordOf(input(notes)), afterFailedWrite: undefined, shown: undefined }
		);
	});

	test('removes its record when the window closes, but not a record another window wrote since', async () => {
		const store = disposables.add(new DisposableStore());
		const first = await setup(store, ['linked', 'missing']);
		first.service.update(input(notes));
		await first.service.flush();
		const before = await first.read(notes);
		first.lifecycle.fireShutdown();
		await Promise.all(first.lifecycle.shutdownJoiners);
		const afterOwnClose = await first.read(notes);

		const second = await setup(store, ['linked', 'missing']);
		second.service.update(input(notes));
		await second.service.flush();
		const other = recordOf(input(notes, [{ path: 'b.md', isFolder: false }]));
		await second.fileService.writeFile(baseHalfAgentSelectionResource(notes), VSBuffer.fromString(other));
		second.lifecycle.fireShutdown();
		await Promise.all(second.lifecycle.shutdownJoiners);

		assert.deepStrictEqual(
			{ before, afterOwnClose, afterAnotherWindowWrote: await second.read(notes) },
			{ before: recordOf(input(notes)), afterOwnClose: undefined, afterAnotherWindowWrote: other }
		);
	});
});

suite('BaseHalfAgentSelectionStatusContribution', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('shows a selection with no command, the unanswered offer with the command that shows it, and nothing otherwise', () => {
		const store = disposables.add(new DisposableStore());
		const selectionChanged = store.add(new Emitter<BaseHalfAgentSelection | undefined>());
		const offerChanged = store.add(new Emitter<void>());
		const selection: { current: BaseHalfAgentSelection | undefined; onDidChange: Event<BaseHalfAgentSelection | undefined> } = { current: undefined, onDidChange: selectionChanged.event };
		const notifier: { pendingOffer: BaseHalfAgentSkillOffer | undefined; onDidChangePendingOffer: Event<void> } = { pendingOffer: undefined, onDidChangePendingOffer: offerChanged.event };
		const added: string[] = [];
		let shown: IStatusbarEntry | undefined;
		const statusbar = {
			addEntry: (entry: IStatusbarEntry) => {
				added.push(entry.command ? 'offer' : 'selection');
				shown = entry;
				return { update: (next: IStatusbarEntry) => { shown = next; }, dispose: () => { shown = undefined; } };
			}
		};
		store.add(new BaseHalfAgentSelectionStatusContribution(
			selection as unknown as IBaseHalfAgentSelectionService,
			notifier as unknown as IBaseHalfAgentSkillNotifier,
			statusbar as unknown as IStatusbarService,
			{ onDidChangePartVisibility: Event.None } as unknown as IWorkbenchLayoutService
		));
		const describe = () => shown ? { text: shown.text, command: shown.command, content: shown.content?.textContent } : undefined;
		const steps: unknown[] = [describe()];
		notifier.pendingOffer = 'install';
		offerChanged.fire();
		steps.push(describe());
		selection.current = { selected: 'card', path: 'README.md', isFolder: false };
		selectionChanged.fire(selection.current);
		steps.push(describe());
		selection.current = undefined;
		selectionChanged.fire(undefined);
		steps.push(describe());
		notifier.pendingOffer = undefined;
		offerChanged.fire();
		steps.push(describe());

		const offer = { text: '$(eye-closed) Agents can\'t see your selection', command: BASEHALF_SHOW_AGENT_SKILL_OFFER_COMMAND_ID, content: undefined };
		assert.deepStrictEqual({ steps, added }, {
			steps: [undefined, offer, { text: '', command: undefined, content: 'README' }, offer, undefined],
			// Each kind of entry is added anew: an entry keeps the content it was added with.
			added: ['offer', 'selection', 'offer']
		});
	});
});
