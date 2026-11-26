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
import { dirname, joinPath, relativePath as getRelativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfFileLinkEntry, IBaseHalfFileLinksService } from '../../../../../platform/basehalfFiles/common/basehalfFileLinks.js';
import { ConfigurationTarget, IConfigurationChangeEvent } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, IPromptChoice, IPromptOptions, NoOpProgress, NotificationPriority, Severity } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { Workspace } from '../../../../../platform/workspace/common/workspace.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IRemoteAgentService } from '../../../../services/remote/common/remoteAgentService.js';
import { TestPathService } from '../../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, BaseHalfAgentSkillContribution, BaseHalfAgentSkillNotifier, BaseHalfAgentSkillService, IBaseHalfAgentSkillNotifier } from '../../browser/basehalfAgentSkill.contribution.js';
import { BASEHALF_AGENT_SKILL_MARKDOWN, BASEHALF_AGENT_SKILL_VERSION } from '../../common/basehalfAgentSkill.js';

const home = URI.file('/home/user');
const folder = URI.file('/work');
const copy = '.basehalf/agent-skill/basehalf';
const claude = '.claude/skills/basehalf';
const shared = '.agents/skills/basehalf';
const at = (path: string) => joinPath(home, ...path.split('/'));

/**
 * The links of the shared process over an in-memory file system: a link is a
 * path in a map, and a folder or a file is what the file system holds. As on
 * the disk, making a link creates its parent folders.
 */
class InMemoryLinks implements IBaseHalfFileLinksService {
	declare readonly _serviceBrand: undefined;
	readonly links = new Map<string, URI>();
	/** Paths that cannot be read, as a folder the user may not open. */
	readonly unreadable = new Set<string>();

	constructor(private readonly fileService: FileService) { }

	async inspect(resource: URI): Promise<BaseHalfFileLinkEntry> {
		if (this.unreadable.has(resource.path)) {
			throw new Error('EACCES: permission denied');
		}
		const target = this.links.get(resource.path);
		if (target) {
			return { kind: 'link', target };
		}
		if (!await this.fileService.exists(resource)) {
			return { kind: 'missing' };
		}
		return { kind: (await this.fileService.stat(resource)).isDirectory ? 'folder' : 'file' };
	}

	async link(resource: URI, target: URI): Promise<void> {
		if (!this.links.has(resource.path) && await this.fileService.exists(resource)) {
			throw new Error('A file or a folder is in the way');
		}
		await this.fileService.createFolder(dirname(resource));
		this.links.set(resource.path, target);
	}

	async unlink(resource: URI): Promise<boolean> {
		if (!this.links.has(resource.path) && await this.fileService.exists(resource)) {
			throw new Error('A file or a folder is not a link');
		}
		return this.links.delete(resource.path);
	}
}

interface IRecordedPrompt {
	readonly message: string;
	readonly choices: IPromptChoice[];
	readonly options: IPromptOptions | undefined;
	closed: boolean;
	close(): void;
}

class RecordingNotificationService extends TestNotificationService {
	readonly messages: string[] = [];
	readonly prompts: IRecordedPrompt[] = [];

	constructor(private readonly store: DisposableStore) {
		super();
	}

	override notify(notification: INotification): INotificationHandle {
		this.messages.push(String(notification.message));
		return super.notify(notification);
	}

	override prompt(_severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {
		const closed = this.store.add(new Emitter<void>());
		const prompt: IRecordedPrompt = {
			message, choices, options, closed: false, close: () => {
				if (!prompt.closed) {
					prompt.closed = true;
					closed.fire();
				}
			}
		};
		this.prompts.push(prompt);
		return {
			progress: new NoOpProgress(),
			onDidClose: closed.event,
			onDidChangeVisibility: Event.None,
			updateSeverity: () => { },
			updateMessage: () => { },
			updateActions: () => { },
			close: () => prompt.close()
		};
	}
}

suite('BaseHalfAgentSkill (install and offer)', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	async function createHarness(files: Record<string, string> = {}, options: { offerSkill?: boolean; workspace?: Workspace; storage?: InMemoryStorageService; links?: Record<string, string> } = {}) {
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(home);
		await fileService.createFolder(folder);
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(URI.file(path), VSBuffer.fromString(content));
		}
		const links = new InMemoryLinks(fileService);
		for (const [path, target] of Object.entries(options.links ?? {})) {
			links.links.set(at(path).path, at(target));
		}
		const storage = options.storage ?? disposables.add(new InMemoryStorageService());
		const notifications = new RecordingNotificationService(disposables);
		const configuration = new TestConfigurationService({ basehalf: { agents: { offerSkill: options.offerSkill ?? true } } });
		const focus = disposables.add(new Emitter<boolean>());
		const service = disposables.add(new BaseHalfAgentSkillService(fileService, links, new TestPathService(home), { getConnection: () => null } as IRemoteAgentService, new NullLogService()));
		const notifier = disposables.add(new BaseHalfAgentSkillNotifier(
			service,
			new TestContextService(options.workspace ?? testWorkspace(folder)),
			configuration,
			storage,
			notifications,
			fileService,
			{ onDidChangeFocus: focus.event } as unknown as IHostService,
			new NullLogService()
		));
		// The notifier looks for the skill as it starts.
		await timeout(0);
		const list = async (root: URI) => {
			const out: string[] = [];
			const stack = [root];
			while (stack.length) {
				const stat = await fileService.resolve(stack.pop()!);
				for (const child of stat.children ?? []) {
					if (child.isDirectory) {
						stack.push(child.resource);
					} else {
						out.push(getRelativePath(root, child.resource)!);
					}
				}
			}
			return out.sort();
		};
		return {
			fileService,
			links,
			service,
			notifier,
			notifications,
			storage,
			configuration,
			focus,
			list,
			read: async (path: string) => (await fileService.readFile(at(path))).value.toString(),
			write: (path: string, content: string) => fileService.writeFile(at(path), VSBuffer.fromString(content)),
			states: async () => (await service.inspect()).map(location => `${location.label}:${location.state}`),
			linkTargets: () => Object.fromEntries([...links.links].map(([path, target]) => [getRelativePath(home, URI.file(path)), getRelativePath(home, target)])),
			prompts: () => notifications.prompts.map(prompt => ({
				said: `${prompt.message.split('?')[0]}? [${prompt.choices.map(choice => choice.label).join(', ')}]`,
				sticky: prompt.options?.sticky,
				urgent: prompt.options?.priority === NotificationPriority.URGENT,
				closed: prompt.closed
			})),
			async choose(label: string) {
				const prompt = notifications.prompts[notifications.prompts.length - 1];
				prompt.choices.find(choice => choice.label === label)!.run();
				// A notification closes when one of its buttons is chosen.
				prompt.close();
				await timeout(10);
			}
		};
	}

	const withVersion = (version: number) => BASEHALF_AGENT_SKILL_MARKDOWN.replace(`version: "${BASEHALF_AGENT_SKILL_VERSION}"`, `version: "${version}"`);

	test('installs BaseHalf\'s own copy and links Claude Code\'s folder and the shared one to it, and writes nothing into the workspace', async () => {
		const harness = await createHarness({ '/work/note.md': '# N\n' });
		const before = await harness.states();
		const installed = await harness.service.install();

		assert.deepStrictEqual({
			before,
			installed: [installed.installed.map(target => target.label), installed.failed],
			after: await harness.states(),
			links: harness.linkTargets(),
			copyIsTheBundledText: await harness.read(`${copy}/SKILL.md`) === BASEHALF_AGENT_SKILL_MARKDOWN,
			files: await harness.list(home),
			installedFor: [await harness.service.isInstalledFor('claude'), await harness.service.isInstalledFor('shared')],
			workspace: await harness.list(folder)
		}, {
			before: ['Claude Code:missing', 'Codex:missing'],
			installed: [['Claude Code', 'Codex'], []],
			after: ['Claude Code:linked', 'Codex:linked'],
			links: { [claude]: copy, [shared]: copy },
			copyIsTheBundledText: true,
			files: [`${copy}/SKILL.md`],
			installedFor: [true, true],
			workspace: ['note.md']
		});
	});

	test('replaces an earlier copy and a link to anywhere else, and leaves what holds files of the user\'s own as it is', async () => {
		// Claude Code's folder holds only BaseHalf's earlier text; the shared one
		// holds it beside a file of the user's own.
		const earlier = await createHarness({
			[`/home/user/${claude}/SKILL.md`]: withVersion(8),
			[`/home/user/${shared}/SKILL.md`]: withVersion(8),
			[`/home/user/${shared}/notes.txt`]: 'mine'
		});
		const before = await earlier.states();
		await earlier.notifier.install();

		// A skill of the user's own that has the same name.
		const ownSkill = '---\nname: basehalf-notes\ndescription: "My notes."\n---\n\nMine.\n';
		const own = await createHarness({ [`/home/user/${claude}/SKILL.md`]: ownSkill });
		await own.service.install();

		const otherLink = await createHarness({}, { links: { [claude]: 'my-skills/basehalf' } });
		const otherLinkBefore = await otherLink.states();
		await otherLink.service.install();

		// A file at Claude Code's entry, and a file where the shared folder belongs.
		const blocked = await createHarness({ '/home/user/.agents': 'not a folder', [`/home/user/${claude}`]: 'a file' });
		await blocked.notifier.install();

		assert.deepStrictEqual({
			before,
			after: await earlier.states(),
			files: await earlier.list(home),
			told: earlier.notifications.messages,
			ownSkill: { states: await own.states(), kept: await own.read(`${claude}/SKILL.md`) === ownSkill },
			otherLink: [otherLinkBefore, await otherLink.states()],
			// Plain reasons only: no path, no error text of the system.
			blocked: blocked.notifications.messages
		}, {
			before: ['Claude Code:copy', 'Codex:copy'],
			after: ['Claude Code:linked', 'Codex:copy'],
			files: [`${shared}/SKILL.md`, `${shared}/notes.txt`, `${copy}/SKILL.md`],
			told: ['The BaseHalf skill could not be installed for Codex: a folder of that name holds files of your own'],
			ownSkill: { states: ['Claude Code:copy', 'Codex:linked'], kept: true },
			otherLink: [['Claude Code:other', 'Codex:missing'], ['Claude Code:linked', 'Codex:linked']],
			blocked: [
				'The BaseHalf skill could not be installed for Claude Code: a file of that name is in the way',
				'The BaseHalf skill could not be installed for Codex: The disk reported a problem.'
			]
		});
	});

	test('counts a location that cannot be read as other, which decides nothing for the other location', async () => {
		const harness = await createHarness({}, { links: { [claude]: copy } });
		harness.links.unreadable.add(at(shared).path);
		await harness.notifier.offer();

		assert.deepStrictEqual(
			{ states: await harness.states(), installedFor: await harness.service.isInstalledFor('claude'), pending: harness.notifier.pendingOffer, offered: harness.prompts().length },
			{ states: ['Claude Code:linked', 'Codex:other'], installedFor: true, pending: undefined, offered: 0 }
		);
	});

	test('keeps BaseHalf\'s own copy at the bundled text while a link is there, and never writes over a higher version', async () => {
		const harness = await createHarness();
		const file = `${copy}/SKILL.md`;
		await harness.service.refresh();
		const withoutLink = await harness.list(home);
		await harness.service.install();

		await harness.write(file, withVersion(Number(BASEHALF_AGENT_SKILL_VERSION) - 1));
		await harness.service.refresh();
		const afterLower = await harness.read(file) === BASEHALF_AGENT_SKILL_MARKDOWN;

		await harness.fileService.del(at(file));
		await harness.service.refresh();
		const afterMissing = await harness.read(file) === BASEHALF_AGENT_SKILL_MARKDOWN;

		const higher = withVersion(Number(BASEHALF_AGENT_SKILL_VERSION) + 1);
		await harness.write(file, higher);
		await harness.service.refresh();
		const afterHigher = await harness.read(file) === higher;
		await harness.service.install();
		const afterInstallOverHigher = await harness.read(file) === higher;

		assert.deepStrictEqual(
			{ withoutLink, afterLower, afterMissing, afterHigher, afterInstallOverHigher, states: await harness.states() },
			{ withoutLink: [], afterLower: true, afterMissing: true, afterHigher: true, afterInstallOverHigher: true, states: ['Claude Code:linked', 'Codex:linked'] }
		);
	});

	test('removes the links, an earlier copy, and its own copy, and leaves a link to anywhere else and the files of the user\'s own', async () => {
		const harness = await createHarness({ [`/home/user/${shared}/SKILL.md`]: withVersion(8), [`/home/user/${shared}/notes.txt`]: 'mine' });
		await harness.service.install();
		// A temporary file that a write which ended halfway left.
		await harness.write(`${copy}/SKILL.md.basehalf-tmp-1`, 'half');
		const removed = await harness.service.remove();
		const afterRemove = { links: harness.linkTargets(), files: await harness.list(home), agentSkillFolder: await harness.fileService.exists(at('.basehalf/agent-skill')) };
		const again = await harness.service.remove();

		const ownSkill = '---\nname: basehalf-notes\n---\n\nMine.\n';
		const others = await createHarness({ [`/home/user/${shared}/SKILL.md`]: ownSkill }, { links: { [claude]: 'my-skills/basehalf' } });
		const othersRemoved = await others.service.remove();

		assert.deepStrictEqual({
			removed,
			afterRemove,
			again,
			others: { removed: othersRemoved, links: others.linkTargets(), ownSkillKept: await others.read(`${shared}/SKILL.md`) === ownSkill }
		}, {
			removed: true,
			afterRemove: { links: {}, files: [`${shared}/notes.txt`], agentSkillFolder: false },
			again: false,
			others: { removed: false, links: { [claude]: 'my-skills/basehalf' }, ownSkillKept: true }
		});
	});

	test('brings its own copy up to date when the window starts and whenever it gains focus', async () => {
		const harness = await createHarness({ [`/home/user/${copy}/SKILL.md`]: withVersion(8) }, { links: { [claude]: copy } });
		const offered: string[] = [];
		disposables.add(new BaseHalfAgentSkillContribution(
			new TestContextService(testWorkspace(folder)),
			{ offer: async () => { offered.push('offer'); } } as IBaseHalfAgentSkillNotifier,
			harness.service,
			{ onDidChangeFocus: harness.focus.event } as unknown as IHostService,
			new NullLogService()
		));
		await timeout(10);
		const atStart = await harness.read(`${copy}/SKILL.md`) === BASEHALF_AGENT_SKILL_MARKDOWN;
		await harness.write(`${copy}/SKILL.md`, withVersion(9));
		harness.focus.fire(false);
		await timeout(10);
		const afterBlur = await harness.read(`${copy}/SKILL.md`) === withVersion(9);
		harness.focus.fire(true);
		await timeout(10);
		const afterFocus = await harness.read(`${copy}/SKILL.md`) === BASEHALF_AGENT_SKILL_MARKDOWN;

		assert.deepStrictEqual({ atStart, afterBlur, afterFocus, offered }, { atStart: true, afterBlur: true, afterFocus: true, offered: ['offer'] });
	});

	test('offers the skill in a notification that stays until it is answered, once per window, and again when the status bar asks', async () => {
		const harness = await createHarness();
		await harness.notifier.offer();
		await harness.notifier.offer();
		const atStart = { prompts: harness.prompts(), pending: harness.notifier.pendingOffer };
		await harness.notifier.showOffer();
		const asked = harness.prompts();
		await harness.choose('Install');

		assert.deepStrictEqual({
			atStart,
			saysItIsKeptUpToDate: harness.notifications.prompts[0].message.endsWith('and BaseHalf keeps it up to date.'),
			asked,
			pending: harness.notifier.pendingOffer,
			states: await harness.states(),
			messages: harness.notifications.messages
		}, {
			saysItIsKeptUpToDate: true,
			atStart: {
				prompts: [{ said: 'Install the BaseHalf skill for your agents? [Install, Not Now, Don\'t Ask Again]', sticky: true, urgent: false, closed: false }],
				pending: 'install'
			},
			// The offer the status bar asks for replaces the one that is open, and shows also while Do Not Disturb is on.
			asked: [
				{ said: 'Install the BaseHalf skill for your agents? [Install, Not Now, Don\'t Ask Again]', sticky: true, urgent: false, closed: true },
				{ said: 'Install the BaseHalf skill for your agents? [Install, Not Now, Don\'t Ask Again]', sticky: true, urgent: true, closed: false }
			],
			pending: undefined,
			states: ['Claude Code:linked', 'Codex:linked'],
			messages: ['The BaseHalf skill is installed for Claude Code and Codex, and BaseHalf keeps it up to date. Agent sessions you start from now on can use it. To take it away, use Remove Agent Skill in the Command Palette.']
		});
	});

	test('offers Update for earlier copies, nothing once a link is there or the offer does not apply, and no more after Don\'t Ask Again or a removal', async () => {
		const offersOf = async (files: Record<string, string>, options: Parameters<typeof createHarness>[1] = {}) => {
			const harness = await createHarness(files, options);
			await harness.notifier.offer();
			return { said: harness.prompts().map(prompt => prompt.said), pending: harness.notifier.pendingOffer };
		};

		const declined = await createHarness();
		await declined.notifier.offer();
		await declined.choose('Don\'t Ask Again');
		const afterDecline = { pending: declined.notifier.pendingOffer, stored: declined.storage.getBoolean(BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, StorageScope.APPLICATION) };

		const removedAndBack = await createHarness();
		await removedAndBack.notifier.install();
		await removedAndBack.notifier.remove();
		const afterRemove = { pending: removedAndBack.notifier.pendingOffer, stored: removedAndBack.storage.getBoolean(BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, StorageScope.APPLICATION), told: removedAndBack.notifications.messages.at(-1) };
		// Install Agent Skill installs after an answer, and forgets it.
		await removedAndBack.notifier.install();
		const afterInstallAgain = { states: await removedAndBack.states(), stored: removedAndBack.storage.getBoolean(BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, StorageScope.APPLICATION, false) };

		assert.deepStrictEqual({
			earlierCopies: await offersOf({ [`/home/user/${claude}/SKILL.md`]: withVersion(8), [`/home/user/${shared}/SKILL.md`]: withVersion(8) }),
			linked: await offersOf({}, { links: { [claude]: copy } }),
			settingOff: await offersOf({}, { offerSkill: false }),
			markedWorkspace: await offersOf({ '/work/.basehalf-no-workspace-setup': '' }),
			noFolder: await offersOf({}, { workspace: new Workspace('empty', [], false, null, () => false) }),
			afterDecline,
			nextWindowAfterDecline: await offersOf({}, { storage: declined.storage }),
			afterRemove,
			afterInstallAgain
		}, {
			earlierCopies: { said: ['Update the BaseHalf skill for your agents? [Update, Not Now, Don\'t Ask Again]'], pending: 'update' },
			linked: { said: [], pending: undefined },
			settingOff: { said: [], pending: undefined },
			markedWorkspace: { said: [], pending: undefined },
			noFolder: { said: [], pending: undefined },
			afterDecline: { pending: undefined, stored: true },
			nextWindowAfterDecline: { said: [], pending: undefined },
			afterRemove: { pending: undefined, stored: true, told: 'The BaseHalf skill was removed. BaseHalf won\'t offer it again; Install Agent Skill brings it back.' },
			afterInstallAgain: { states: ['Claude Code:linked', 'Codex:linked'], stored: false }
		});
	});

	test('keeps the unanswered offer that the status bar shows current, and closes an open offer once it is answered elsewhere', async () => {
		const harness = await createHarness();
		await harness.notifier.offer();
		const seen: (string | undefined)[] = [harness.notifier.pendingOffer];
		disposables.add(harness.notifier.onDidChangePendingOffer(() => seen.push(harness.notifier.pendingOffer)));

		// Installed by the command while the offer is open.
		await harness.service.install();
		await timeout(0);
		const openOfferClosed = harness.notifications.prompts[0].closed;
		// Removed by another window, which does not answer for this one: seen
		// when this window gains focus.
		harness.links.links.clear();
		await timeout(0);
		const beforeFocus = harness.notifier.pendingOffer;
		harness.focus.fire(true);
		await timeout(0);
		// Another window's Don't Ask Again counts at once, and so does its Install Agent Skill.
		harness.storage.store(BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		await timeout(0);
		harness.storage.remove(BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, StorageScope.APPLICATION);
		await timeout(0);
		// Turned off for the workspace.
		await harness.configuration.setUserConfiguration('basehalf.agents.offerSkill', false);
		const changed: IConfigurationChangeEvent = {
			source: ConfigurationTarget.WORKSPACE,
			affectedKeys: new Set(['basehalf.agents.offerSkill']),
			change: { keys: ['basehalf.agents.offerSkill'], overrides: [] },
			affectsConfiguration: key => key === 'basehalf.agents.offerSkill'
		};
		harness.configuration.onDidChangeConfigurationEmitter.fire(changed);
		await timeout(0);

		assert.deepStrictEqual(
			{ seen, openOfferClosed, beforeFocus },
			{ seen: ['install', undefined, 'install', undefined, 'install', undefined], openOfferClosed: true, beforeFocus: undefined }
		);
	});
});
