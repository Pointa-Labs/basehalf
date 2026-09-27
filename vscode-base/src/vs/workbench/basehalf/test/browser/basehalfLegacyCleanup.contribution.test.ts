/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { INotificationHandle, IPromptChoice, IPromptOptions, NoOpNotification, Severity } from '../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { InMemoryStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { UriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import {
	BASEHALF_CLEANUP_AGENT_GUIDES_KEPT_STORAGE_KEY,
	BASEHALF_CLEANUP_MIRROR_NOTICE_STORAGE_KEY,
	BaseHalfLegacyCleanupNotifier
} from '../../browser/basehalfLegacyCleanup.contribution.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfOpenResourceOptions } from '../../common/basehalfCanvasNavigation.js';
import {
	IBaseHalfAgentGuide,
	IBaseHalfAgentGuideRemovalReport,
	IBaseHalfAgentGuideScan,
	IBaseHalfLegacyCleanupReport,
	IBaseHalfLegacyCleanupService
} from '../../common/basehalfLegacyCleanup.js';
import { IBaseHalfLegacyMigrationGate } from '../../common/basehalfLegacyMigrationGate.js';

interface IRecordedNotification {
	readonly severity: Severity;
	readonly message: string;
	readonly choices: IPromptChoice[];
	readonly options?: IPromptOptions;
	readonly handle: TestHandle;
}

class TestHandle extends NoOpNotification {
	private readonly closeEmitter = new Emitter<void>();
	override readonly onDidClose = this.closeEmitter.event;
	closed = false;

	override close(): void {
		if (!this.closed) {
			this.closed = true;
			this.closeEmitter.fire();
		}
	}

	dispose(): void {
		this.closeEmitter.dispose();
	}
}

class RecordingNotificationService extends TestNotificationService {
	readonly notifications: IRecordedNotification[] = [];

	constructor(private readonly store: DisposableStore) {
		super();
	}

	override info(message: string): INotificationHandle {
		return this.prompt(Severity.Info, message, []);
	}

	override prompt(severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {
		const handle = new TestHandle();
		this.store.add({ dispose: () => handle.dispose() });
		this.notifications.push({ severity, message, choices, options, handle });
		return handle;
	}

	choose(notification: IRecordedNotification, label: string): void {
		const choice = notification.choices.find(candidate => candidate.label === label);
		assert.ok(choice, `no choice ${label}`);
		choice.run();
		if (!choice.keepOpen) {
			notification.handle.close();
		}
	}
}

suite('BaseHalfLegacyCleanupNotifier', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const workspace = URI.file('/work');
	const guide = (file: IBaseHalfAgentGuide['file'], moveToTrash: boolean): IBaseHalfAgentGuide => ({
		workspaceFolder: workspace,
		resource: URI.joinPath(workspace, ...file.split('/')),
		file,
		selection: { startLineNumber: 3, startColumn: 1, endLineNumber: 9, endColumn: 28 },
		moveToTrash
	});

	interface ISetup {
		readonly storage?: InMemoryStorageService;
		readonly guides?: readonly IBaseHalfAgentGuide[];
		readonly cleanup?: IBaseHalfLegacyCleanupReport;
		readonly removal?: IBaseHalfAgentGuideRemovalReport;
		readonly gate?: Promise<void>;
		readonly git?: boolean;
	}

	function createNotifier(setup: ISetup = {}) {
		const store = disposables.add(new DisposableStore());
		const storage = setup.storage ?? disposables.add(new InMemoryStorageService());
		const notifications = new RecordingNotificationService(store);
		const removals: IBaseHalfAgentGuide[][] = [];
		const opened: { readonly resource: string; readonly options: IBaseHalfOpenResourceOptions }[] = [];
		const edited: string[] = [];
		const commands: string[] = [];
		const folder: IWorkspaceFolder = { uri: workspace, name: 'work', index: 0, toResource: path => URI.joinPath(workspace, path) };
		const contextService = {
			getWorkspace: () => ({ id: 'test', folders: [folder] }),
			getWorkspaceFolder: () => folder
		} as Partial<IWorkspaceContextService> as IWorkspaceContextService;
		const cleanupService = {
			cleanWorkspaceFolder: async () => setup.cleanup ?? { importedViewports: 0, removedFiles: [], removedDirectories: [], kept: [], failed: [] },
			findAgentGuides: async (): Promise<IBaseHalfAgentGuideScan> => ({ guides: setup.guides ?? [] }),
			removeAgentGuideSections: async (guides: readonly IBaseHalfAgentGuide[]) => {
				removals.push([...guides]);
				return setup.removal ?? { removed: [...guides], trashed: guides.filter(item => item.moveToTrash), skipped: [], notTrashed: [] };
			}
		} as Partial<IBaseHalfLegacyCleanupService> as IBaseHalfLegacyCleanupService;
		const gate = { whenMigrationPromptSettled: () => setup.gate ?? Promise.resolve() } as Partial<IBaseHalfLegacyMigrationGate> as IBaseHalfLegacyMigrationGate;
		const fileService = {
			onDidChangeFileSystemProviderRegistrations: Event.None,
			onDidChangeFileSystemProviderCapabilities: Event.None,
			hasProvider: () => true,
			hasCapability: () => true,
			exists: async (resource: URI) => !!setup.git && resource.path === '/work/.git'
		} as Partial<IFileService> as IFileService;
		const commandService = {
			executeCommand: async (id: string) => {
				commands.push(id);
				return undefined;
			}
		} as Partial<ICommandService> as ICommandService;
		const navigationService = {
			openCardDetail: async (resource: URI, options: IBaseHalfOpenResourceOptions) => {
				opened.push({ resource: resource.path, options });
				return { handled: false, reason: 'superseded' } as const;
			}
		} as Partial<IBaseHalfCanvasNavigationService> as IBaseHalfCanvasNavigationService;
		const editorService = {
			openEditor: async (input: { readonly resource: URI }) => {
				edited.push(input.resource.path);
				return undefined;
			}
		} as unknown as IEditorService;
		const notifier = store.add(new BaseHalfLegacyCleanupNotifier(
			contextService,
			cleanupService,
			gate,
			notifications,
			storage,
			store.add(new UriIdentityService(fileService)),
			fileService,
			commandService,
			navigationService,
			editorService,
			new NullLogService()
		));
		return { notifier, notifications, storage, removals, opened, edited, commands };
	}

	const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

	test('offers removal only when a BaseHalf section exists, after the migration prompt settled', async () => {
		const none = createNotifier();
		await none.notifier.offerAgentGuideRemoval();
		assert.strictEqual(none.notifications.notifications.length, 0);

		const gate = new DeferredPromise<void>();
		const withGuides = createNotifier({ guides: [guide('CLAUDE.md', false), guide('AGENTS.md', true)], gate: gate.p });
		const offered = withGuides.notifier.offerAgentGuideRemoval();
		await flush();
		assert.strictEqual(withGuides.notifications.notifications.length, 0);

		gate.complete();
		await offered;
		const [notice] = withGuides.notifications.notifications;
		assert.deepStrictEqual({
			count: withGuides.notifications.notifications.length,
			severity: notice.severity,
			message: notice.message,
			choices: notice.choices.map(choice => [choice.label, !!choice.keepOpen]),
			sticky: notice.options?.sticky
		}, {
			count: 1,
			severity: Severity.Info,
			message: 'Earlier BaseHalf versions added agent instructions to CLAUDE.md, AGENTS.md. They point agents at files BaseHalf no longer uses. Remove them? AGENTS.md will be moved to the trash.',
			choices: [['Remove', false], ['Show', true], ['Keep', false]],
			sticky: true
		});
	});

	test('Remove reports the result and names each skipped file with its reason and an Open action', async () => {
		const claude = guide('CLAUDE.md', false);
		const agents = guide('AGENTS.md', true);
		const copilot = guide('.github/copilot-instructions.md', true);
		const { notifier, notifications, removals, edited } = createNotifier({
			guides: [claude, agents, copilot],
			removal: {
				removed: [agents, copilot],
				trashed: [agents],
				skipped: [{ guide: claude, reason: 'dirty' }],
				notTrashed: [{ guide: copilot, reason: 'trashUnavailable' }]
			}
		});
		await notifier.offerAgentGuideRemoval();

		notifications.choose(notifications.notifications[0], 'Remove');
		await flush();
		const reports = notifications.notifications.slice(1);
		notifications.choose(reports[1], 'Open');
		await flush();

		assert.deepStrictEqual({
			removals: removals.map(batch => batch.map(item => item.file)),
			reports: reports.map(report => [report.severity, report.message, report.choices.map(choice => choice.label)]),
			edited
		}, {
			removals: [['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md']],
			reports: [
				[Severity.Info, 'Removed the BaseHalf section from 2 files (1 moved to the trash).', []],
				[Severity.Warning, 'CLAUDE.md was not changed: it has unsaved changes', ['Open']],
				[Severity.Warning, 'The BaseHalf section was removed from .github/copilot-instructions.md, but the file was not moved to the trash: the trash is not available', ['Open']]
			],
			edited: ['/work/CLAUDE.md']
		});
	});

	test('Show opens each file in the Source projection with the BaseHalf section selected', async () => {
		const { notifier, notifications, opened, edited } = createNotifier({ guides: [guide('CLAUDE.md', false), guide('AGENTS.md', true)] });
		await notifier.offerAgentGuideRemoval();

		notifications.choose(notifications.notifications[0], 'Show');
		await flush();

		assert.deepStrictEqual({
			opened: opened.map(item => [item.resource, item.options.projection, item.options.selection]),
			fallback: edited,
			stillOpen: !notifications.notifications[0].handle.closed
		}, {
			opened: [
				['/work/CLAUDE.md', 'source', { startLineNumber: 3, startColumn: 1, endLineNumber: 9, endColumn: 28 }],
				['/work/AGENTS.md', 'source', { startLineNumber: 3, startColumn: 1, endLineNumber: 9, endColumn: 28 }]
			],
			fallback: ['/work/CLAUDE.md', '/work/AGENTS.md'],
			stillOpen: true
		});
	});

	test('Keep suppresses the notification for that folder on this machine, but not the command', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const first = createNotifier({ storage, guides: [guide('CLAUDE.md', false)] });
		await first.notifier.offerAgentGuideRemoval();
		first.notifications.choose(first.notifications.notifications[0], 'Keep');

		const nextSession = createNotifier({ storage, guides: [guide('CLAUDE.md', false)] });
		await nextSession.notifier.offerAgentGuideRemoval();
		await nextSession.notifier.removeOldAgentInstructions();

		assert.deepStrictEqual({
			kept: JSON.parse(storage.get(BASEHALF_CLEANUP_AGENT_GUIDES_KEPT_STORAGE_KEY, StorageScope.WORKSPACE) ?? '[]'),
			firstRemovals: first.removals.length,
			nextSessionOffers: nextSession.notifications.notifications.filter(item => item.message.startsWith('Earlier BaseHalf versions')).length,
			commandRemovals: nextSession.removals.map(batch => batch.map(item => item.file))
		}, {
			kept: [workspace.toString()],
			firstRemovals: 0,
			nextSessionOffers: 0,
			commandRemovals: [['CLAUDE.md']]
		});
	});

	test('closing without a choice shows the notification again next session, not again in this one', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const first = createNotifier({ storage, guides: [guide('CLAUDE.md', false)] });
		await first.notifier.offerAgentGuideRemoval();
		first.notifications.notifications[0].handle.close();
		await first.notifier.offerAgentGuideRemoval();

		const nextSession = createNotifier({ storage, guides: [guide('CLAUDE.md', false)] });
		await nextSession.notifier.offerAgentGuideRemoval();

		assert.deepStrictEqual({
			thisSession: first.notifications.notifications.length,
			nextSession: nextSession.notifications.notifications.length,
			kept: storage.get(BASEHALF_CLEANUP_AGENT_GUIDES_KEPT_STORAGE_KEY, StorageScope.WORKSPACE)
		}, {
			thisSession: 1,
			nextSession: 1,
			kept: undefined
		});
	});

	test('discloses removed .bh files once per folder on this machine, offering Source Control in a git repository', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const cleanup: IBaseHalfLegacyCleanupReport = { importedViewports: 1, removedFiles: ['.bh/current_focus.yaml', '.bh/mirror/focus.yaml', '.bh/agent-harness/index.md'], removedDirectories: [], kept: [], failed: [] };
		const first = createNotifier({ storage, cleanup, git: true });
		await first.notifier.cleanFolder(workspace);
		first.notifications.choose(first.notifications.notifications[0], 'Show in Source Control');
		await flush();

		const later = createNotifier({ storage, cleanup, git: true });
		await later.notifier.cleanFolder(workspace);

		const noGit = createNotifier({ cleanup });
		await noGit.notifier.cleanFolder(workspace);

		const marked = createNotifier({ cleanup: { ...cleanup, skipped: 'marker' } });
		await marked.notifier.cleanFolder(workspace);

		const notice = first.notifications.notifications[0];
		assert.deepStrictEqual({
			message: notice.message,
			severity: notice.severity,
			choices: notice.choices.map(choice => choice.label),
			commands: first.commands,
			told: JSON.parse(storage.get(BASEHALF_CLEANUP_MIRROR_NOTICE_STORAGE_KEY, StorageScope.WORKSPACE) ?? '[]'),
			later: later.notifications.notifications.length,
			noGitChoices: noGit.notifications.notifications.map(item => item.choices.length),
			marked: marked.notifications.notifications.length
		}, {
			message: 'BaseHalf removed 3 files that earlier versions created in .bh/ (focus and agent-harness files). Your notes and canvas layout were not changed.',
			severity: Severity.Info,
			choices: ['Show in Source Control'],
			commands: ['workbench.view.scm'],
			told: [workspace.toString()],
			later: 0,
			noGitChoices: [0],
			marked: 0
		});
	});
});
