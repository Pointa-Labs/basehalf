/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IFileService, IFileStatWithPartialMetadata } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IBaseHalfPluginAdmissionService } from '../../../basehalf/plugins/common/basehalfPluginAdmissionService.js';
import { IBaseHalfProjectFileTransitionService } from '../../../basehalf/plugins/common/basehalfProjectFileTransitions.js';
import { IBaseHalfGenerationMade } from '../../../basehalf/video/common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationCardSnapshot, IBaseHalfGenerationCardStore } from '../../../basehalf/video/common/basehalfVideoGeneration.js';
import { ExtHostBaseHalfShape, IBaseHalfExtensionIdentityDto } from '../../common/extHost.protocol.js';
import { MainThreadBaseHalf } from '../../browser/mainThreadBaseHalf.js';
import { IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';

suite('MainThreadBaseHalf', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('rejects card inspection before touching storage when the contributor is not admitted', async () => {
		let allowedIdentity: string | undefined;
		const workspace = new TestWorkspace();
		const mainThread = disposables.add(createMainThread(new class extends mock<IBaseHalfPluginAdmissionService>() {
			override isAllowedContributor(identity: { readonly extensionId: string }): boolean {
				allowedIdentity = identity.extensionId;
				return false;
			}
		}, workspace.fileService, workspace.contextService, undefined, workspace.cardStore));

		await assert.rejects(
			mainThread.$inspectGenerationCard(extensionIdentity(), URI.file('/workspace/shots/clip.mp4')),
			/not admitted/
		);
		assert.deepStrictEqual([allowedIdentity, workspace.touched], ['reviewed.workflow', 0]);
	});

	test('delegates admitted exact project-file transitions to the host transaction service', async () => {
		let received: Parameters<IBaseHalfProjectFileTransitionService['apply']>[0] | undefined;
		const transitionService = new class extends mock<IBaseHalfProjectFileTransitionService>() {
			override apply(transition: Parameters<IBaseHalfProjectFileTransitionService['apply']>[0]): Promise<void> {
				received = transition;
				return Promise.resolve();
			}
		};
		const mainThread = disposables.add(createMainThread(admitted(), undefined!, undefined, transitionService));
		await mainThread.$applyProjectFileTransition(
			extensionIdentity(),
			URI.file('/workspace/sequence.json'),
			VSBuffer.fromString('before'),
			VSBuffer.fromString('after'),
			'Reorder clips'
		);
		assert.strictEqual(received?.resource.path, '/workspace/sequence.json');
		assert.strictEqual(received?.expected.toString(), 'before');
		assert.strictEqual(received?.next.toString(), 'after');
		// Plugin-originated: never exempt from the upstream guard (D37).
		assert.strictEqual(received?.origin, undefined);
	});

	test('answers nothing, and reads nothing, for a resource that cannot be a generation card of the workspace', async () => {
		const workspace = new TestWorkspace();
		const mainThread = disposables.add(createMainThread(admitted(), workspace.fileService, workspace.contextService, undefined, workspace.cardStore));
		const answers = [];
		for (const resource of [
			URI.file('/workspace/notes.md'),
			// The retired node document is an ordinary file (D63).
			URI.file('/workspace/shots/clip.bhnode'),
			URI.file('/workspace/shots/clip.mp4').with({ query: 'view=raw' }),
			URI.file('/workspace/shots/clip.mp4').with({ scheme: 'untitled' }),
			URI.file('/outside/clip.mp4'),
			URI.file('/workspace/.bh/mirror/shots/clip.mp4')
		]) {
			answers.push(await mainThread.$inspectGenerationCard(extensionIdentity(), resource));
		}
		assert.deepStrictEqual({ answers, touched: workspace.touched }, { answers: [undefined, undefined, undefined, undefined, undefined, undefined], touched: 0 });
	});

	test('answers the kind, the file, and the id of the made.yaml of a generated video, a draft, and a file uploaded to a draft', async () => {
		const workspace = new TestWorkspace();
		workspace.addCard('shots/clip.mp4', { hasFile: true, made: made('20261019T080000-k3f9') });
		workspace.addCard('shots/next.mp4', { hasFile: false });
		workspace.addCard('frames/upload.png', { hasFile: true });
		const mainThread = disposables.add(createMainThread(admitted(), workspace.fileService, workspace.contextService, undefined, workspace.cardStore));
		assert.deepStrictEqual(await Promise.all(['shots/clip.mp4', 'shots/next.mp4', 'frames/upload.png'].map(path => mainThread.$inspectGenerationCard(extensionIdentity(), URI.file(`/workspace/${path}`)))), [
			{ kind: 'video', hasFile: true, generationId: '20261019T080000-k3f9' },
			{ kind: 'video', hasFile: false },
			{ kind: 'image', hasFile: true }
		]);
	});

	test('answers nothing for a file without generation information, a symbolic link, a path that resolves outside the workspace, and a card that cannot be read', async () => {
		const workspace = new TestWorkspace();
		workspace.files.add('/workspace/shots/imported.mp4');
		workspace.addCard('shots/link.mp4', { hasFile: true, made: made('a') });
		workspace.symbolicLinks.add('/workspace/shots/link.mp4');
		workspace.addCard('shots/escaped.mp4', { hasFile: true, made: made('b') });
		workspace.realpaths.set('/workspace/shots/escaped.mp4', '/outside/escaped.mp4');
		workspace.addCard('linked/draft.mp4', { hasFile: false });
		workspace.realpaths.set('/workspace/linked', '/outside/linked');
		workspace.addCard('shots/broken.mp4', { hasFile: true, made: made('c') });
		workspace.unreadable.add('/workspace/shots/broken.mp4');
		const mainThread = disposables.add(createMainThread(admitted(), workspace.fileService, workspace.contextService, undefined, workspace.cardStore));
		assert.deepStrictEqual(await Promise.all(['shots/imported.mp4', 'shots/link.mp4', 'shots/escaped.mp4', 'linked/draft.mp4', 'shots/broken.mp4'].map(path => mainThread.$inspectGenerationCard(extensionIdentity(), URI.file(`/workspace/${path}`)))), [
			undefined, undefined, undefined, undefined, undefined
		]);
		// Only the card store's readers decide a card; nothing is written.
		assert.deepStrictEqual(workspace.cardStoreCalls.filter(call => call.startsWith('read ')), ['read /workspace/shots/broken.mp4']);
	});
});

function createMainThread(
	admissionService: IBaseHalfPluginAdmissionService,
	fileService: IFileService,
	workspaceContextService: IWorkspaceContextService = new class extends mock<IWorkspaceContextService>() {
		override getWorkspaceFolder(): IWorkspaceFolder | null { return null; }
	},
	projectFileTransitionService: IBaseHalfProjectFileTransitionService = undefined!,
	generationCardStore: IBaseHalfGenerationCardStore = undefined!
): MainThreadBaseHalf {
	const proxy = new class extends mock<ExtHostBaseHalfShape>() { };
	const context = { getProxy: () => proxy } as unknown as IExtHostContext;
	return new MainThreadBaseHalf(
		context,
		undefined!,
		undefined!,
		undefined!,
		undefined!,
		fileService,
		workspaceContextService,
		generationCardStore,
		projectFileTransitionService,
		undefined!,
		admissionService,
	);
}

function admitted(): IBaseHalfPluginAdmissionService {
	return new class extends mock<IBaseHalfPluginAdmissionService>() { override isAllowedContributor(): boolean { return true; } };
}

/**
 * A workspace folder `/workspace` with files, symbolic links, real paths, and
 * the generation cards a card store reports. Counts every look at storage.
 */
class TestWorkspace {
	readonly files = new Set<string>();
	readonly symbolicLinks = new Set<string>();
	readonly realpaths = new Map<string, string>();
	readonly unreadable = new Set<string>();
	readonly cardStoreCalls: string[] = [];
	private readonly cards = new Map<string, Omit<IBaseHalfGenerationCardSnapshot, 'resource' | 'path'>>();
	touched = 0;

	readonly contextService = new class extends mock<IWorkspaceContextService>() {
		override getWorkspaceFolder(resource: URI): IWorkspaceFolder | null {
			return resource.path.startsWith('/workspace/')
				? { uri: URI.file('/workspace'), name: 'workspace', index: 0, toResource: path => URI.joinPath(URI.file('/workspace'), path) }
				: null;
		}
	};

	readonly fileService: IFileService;
	readonly cardStore: IBaseHalfGenerationCardStore;

	constructor() {
		const workspace = this;
		this.fileService = new class extends mock<IFileService>() {
			override async stat(resource: URI): Promise<IFileStatWithPartialMetadata> {
				workspace.touched++;
				const isFile = workspace.files.has(resource.path);
				const isDirectory = resource.path === '/workspace' || [...workspace.files].some(path => path.startsWith(`${resource.path}/`)) || [...workspace.cards.keys()].some(path => path.startsWith(`${resource.path}/`));
				if (!isFile && !isDirectory) {
					throw new Error('missing');
				}
				return fileStat(resource, isFile, workspace.symbolicLinks.has(resource.path));
			}
			override async realpath(resource: URI): Promise<URI> {
				workspace.touched++;
				const mapped = workspace.realpaths.get(resource.path);
				return mapped ? URI.file(mapped) : resource;
			}
		};
		this.cardStore = new class extends mock<IBaseHalfGenerationCardStore>() {
			override async isGenerationCard(resource: URI): Promise<boolean> {
				workspace.touched++;
				workspace.cardStoreCalls.push(`is ${resource.path}`);
				return workspace.cards.has(resource.path);
			}
			override async read(resource: URI): Promise<IBaseHalfGenerationCardSnapshot> {
				workspace.touched++;
				workspace.cardStoreCalls.push(`read ${resource.path}`);
				const card = workspace.cards.get(resource.path);
				if (!card || workspace.unreadable.has(resource.path)) {
					throw new Error(`${resource.path} is not an image or video card.`);
				}
				return { resource, path: resource.path.slice('/workspace/'.length), ...card };
			}
		};
	}

	/** A card at `path`: with its file, or a draft. */
	addCard(path: string, card: { readonly hasFile: boolean; readonly made?: IBaseHalfGenerationMade }): void {
		const resource = `/workspace/${path}`;
		if (card.hasFile) {
			this.files.add(resource);
		}
		this.cards.set(resource, {
			kind: /\.(?:png|jpg)$/.test(path) ? 'image' : 'video',
			hasFile: card.hasFile,
			info: { prompt: 'A slow orbit.' },
			infoReadable: true,
			...(card.made ? { made: card.made } : {}),
			upstream: []
		});
	}
}

function made(id: string): IBaseHalfGenerationMade {
	return {
		id,
		startedAt: '2026-10-19T08:00:00.000Z',
		finishedAt: '2026-10-19T08:02:10.000Z',
		provider: 'acme',
		region: 'east',
		model: 'acme-motion-2',
		providerModel: 'acme-motion-2-e-260101',
		mode: 'frames',
		params: { resolution: '720p', duration: 5 },
		prompt: 'A slow orbit.',
		inputs: []
	};
}

function fileStat(resource: URI, isFile: boolean, isSymbolicLink: boolean): IFileStatWithPartialMetadata {
	return {
		resource,
		name: resource.path.split('/').pop() ?? '',
		isFile,
		isDirectory: !isFile,
		isSymbolicLink,
		mtime: 1,
		ctime: 1,
		etag: '1',
		size: 1,
		readonly: false,
		locked: false,
		executable: false
	};
}

function extensionIdentity(): IBaseHalfExtensionIdentityDto {
	return {
		id: new ExtensionIdentifier('reviewed.workflow'),
		version: '1.2.3',
		location: URI.file('/extensions/reviewed-workflow'),
		isBuiltin: false,
		isUnderDevelopment: false,
	};
}
