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
import { IFileContent, IFileService, IFileStatWithPartialMetadata } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IBaseHalfPluginAdmissionService } from '../../../basehalf/common/basehalfPluginAdmissionService.js';
import { IBaseHalfProjectFileTransitionService } from '../../../basehalf/common/basehalfProjectFileTransitions.js';
import { createBaseHalfNodeDocument, IBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../../../basehalf/common/basehalfNodeDocument.js';
import { IBaseHalfVideoGenerationRecord, IBaseHalfVideoTask } from '../../../basehalf/common/basehalfVideoNode.js';
import { baseHalfNodeTestId } from '../../../basehalf/test/common/basehalfNodeTestFixtures.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { ExtHostBaseHalfShape, IBaseHalfExtensionIdentityDto } from '../../common/extHost.protocol.js';
import { MainThreadBaseHalf } from '../../browser/mainThreadBaseHalf.js';
import { IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';

suite('MainThreadBaseHalf', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('rejects node inspection before touching storage when the contributor is not admitted', async () => {
		let allowedIdentity: string | undefined;
		let existsCalls = 0;
		const admissionService = new class extends mock<IBaseHalfPluginAdmissionService>() {
			override isAllowedContributor(identity: { readonly extensionId: string }): boolean {
				allowedIdentity = identity.extensionId;
				return false;
			}
		};
		const fileService = new class extends mock<IFileService>() {
			override exists(): Promise<boolean> {
				existsCalls++;
				return Promise.resolve(true);
			}
		};
		const mainThread = disposables.add(createMainThread(admissionService, fileService));

		await assert.rejects(
			mainThread.$inspectCanvasNode(extensionIdentity(), URI.file('/workspace/clip.bhnode')),
			/not admitted/
		);
		assert.strictEqual(allowedIdentity, 'reviewed.workflow');
		assert.strictEqual(existsCalls, 0);
	});

	test('delegates admitted exact project-file transitions to the host transaction service', async () => {
		let received: Parameters<IBaseHalfProjectFileTransitionService['apply']>[0] | undefined;
		const transitionService = new class extends mock<IBaseHalfProjectFileTransitionService>() {
			override apply(transition: Parameters<IBaseHalfProjectFileTransitionService['apply']>[0]): Promise<void> {
				received = transition;
				return Promise.resolve();
			}
		};
		const mainThread = disposables.add(createMainThread(
			new class extends mock<IBaseHalfPluginAdmissionService>() { override isAllowedContributor(): boolean { return true; } },
			undefined!,
			undefined,
			transitionService
		));
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

	test('accepts only plain node resources inside the current workspace', async () => {
		let existsCalls = 0;
		const admissionService = new class extends mock<IBaseHalfPluginAdmissionService>() {
			override isAllowedContributor(): boolean { return true; }
		};
		const fileService = new class extends mock<IFileService>() {
			override exists(): Promise<boolean> {
				existsCalls++;
				return Promise.resolve(false);
			}
		};
		const workspaceContextService = new class extends mock<IWorkspaceContextService>() {
			override getWorkspaceFolder(resource: URI): IWorkspaceFolder | null {
				return resource.path.startsWith('/workspace/')
					? { uri: URI.file('/workspace'), name: 'workspace', index: 0, toResource: path => URI.joinPath(URI.file('/workspace'), path) }
					: null;
			}
		};
		const mainThread = disposables.add(createMainThread(admissionService, fileService, workspaceContextService));

		assert.strictEqual(await mainThread.$inspectCanvasNode(extensionIdentity(), URI.file('/workspace/clip.md')), undefined);
		assert.strictEqual(await mainThread.$inspectCanvasNode(extensionIdentity(), URI.file('/workspace/clip.bhnode').with({ query: 'view=raw' })), undefined);
		assert.strictEqual(await mainThread.$inspectCanvasNode(extensionIdentity(), URI.file('/outside/clip.bhnode')), undefined);
		assert.strictEqual(await mainThread.$inspectCanvasNode(extensionIdentity(), URI.file('/workspace/missing.bhnode')), undefined);
		assert.strictEqual(existsCalls, 1);
	});

	test('reports a Video node with a generated video as a result whose file is available', async () => {
		const node = videoNode({
			result: {
				source: 'generated',
				artifact: { kind: 'video', path: `outputs/${baseHalfNodeTestId(1)}/task-1.mp4`, size: 42 },
				generation: { taskId: 'task-1', remoteId: 'cgt-1', startedAt: '2026-10-15T08:00:00.000Z', completedAt: '2026-10-15T08:03:00.000Z', request: request() }
			}
		});
		const inspected = await inspect(node, new Set([`/workspace/outputs/${baseHalfNodeTestId(1)}/task-1.mp4`]));
		assert.deepStrictEqual(inspected && { ...inspected, result: inspected.result && { ...inspected.result, artifact: { ...inspected.result.artifact, resource: URI.revive(inspected.result.artifact.resource).path } } }, {
			id: baseHalfNodeTestId(1),
			kind: 'video',
			lifecycle: 'result',
			result: {
				source: 'attempt',
				attemptId: 'task-1',
				artifact: {
					id: 'task-1',
					outputId: 'generated',
					kind: 'video',
					resource: `/workspace/outputs/${baseHalfNodeTestId(1)}/task-1.mp4`,
					integrity: 'available',
					label: 'task-1.mp4'
				}
			},
			attempts: []
		});
	});

	test('reports an imported file as an imported result, and a missing file as missing', async () => {
		const node = videoNode({ result: { source: 'imported', artifact: { kind: 'video', path: 'assets/clip.mp4', size: 42 } } });
		const available = await inspect(node, new Set(['/workspace/assets/clip.mp4']));
		assert.deepStrictEqual([available?.lifecycle, available?.result?.source, available?.result?.artifact.integrity, available?.result?.artifact.outputId], ['result', 'imported', 'available', 'imported']);
		const missing = await inspect(node, new Set());
		assert.deepStrictEqual([missing?.lifecycle, missing?.result?.artifact.integrity], ['result', 'missing']);
	});

	test('reports a Video node without a video by its phase and with no result, so Sequence refuses it', async () => {
		const running: IBaseHalfVideoTask = { id: 'task-1', state: 'running', startedAt: '2026-10-15T08:00:00.000Z', remoteId: 'cgt-1', request: request() };
		const cases: readonly [IBaseHalfNodeDocument, string][] = [
			[videoNode({}), 'draft'],
			[videoNode({ task: { id: 'task-1', state: 'submitting', startedAt: '2026-10-15T08:00:00.000Z', request: request() } }), 'running'],
			[videoNode({ task: running }), 'running'],
			[videoNode({ task: { ...running, state: 'failed', endedAt: '2026-10-15T08:01:00.000Z', error: 'The key was refused.' } }), 'failed'],
			[videoNode({ task: { ...running, state: 'stopped', endedAt: '2026-10-15T08:01:00.000Z' } }), 'cancelled']
		];
		for (const [node, lifecycle] of cases) {
			const inspected = await inspect(node, new Set());
			assert.deepStrictEqual(inspected, { id: baseHalfNodeTestId(1), kind: 'video', lifecycle, attempts: [] });
		}
	});

	test('does not report a version 4 node', async () => {
		const legacy = JSON.stringify({ version: 4, id: baseHalfNodeTestId(1), kind: 'video', title: 'Clip', role: 'clip', prompt: '', upstream: [], attempts: [] });
		assert.strictEqual(await inspectSource(legacy, new Set()), undefined);
	});

	test('does not expose node bytes when the verified path changes during the read', async () => {
		const resource = URI.file('/workspace/clip.bhnode');
		const source = serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1), kind: 'video', title: 'Clip'
		}));
		let nodeRealpathCalls = 0;
		const fileService = new class extends mock<IFileService>() {
			override exists(): Promise<boolean> { return Promise.resolve(true); }
			override realpath(candidate: URI): Promise<URI> {
				if (candidate.path === '/workspace') {
					return Promise.resolve(candidate);
				}
				nodeRealpathCalls++;
				return Promise.resolve(nodeRealpathCalls === 1 ? candidate : URI.file('/outside/clip.bhnode'));
			}
			override stat(candidate: URI): Promise<IFileStatWithPartialMetadata> {
				return Promise.resolve(fileStat(candidate, source.length));
			}
			override readFile(candidate: URI): Promise<IFileContent> {
				return Promise.resolve(fileContent(candidate, source));
			}
		};
		const mainThread = disposables.add(createMainThread(
			new class extends mock<IBaseHalfPluginAdmissionService>() { override isAllowedContributor(): boolean { return true; } },
			fileService,
			workspaceContextService()
		));

		assert.strictEqual(await mainThread.$inspectCanvasNode(extensionIdentity(), resource), undefined);
		assert.strictEqual(nodeRealpathCalls, 2);
	});

	test('does not expose node bytes when file identity changes during the read', async () => {
		const resource = URI.file('/workspace/clip.bhnode');
		const source = serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1), kind: 'video', title: 'Clip'
		}));
		let statCalls = 0;
		const fileService = new class extends mock<IFileService>() {
			override exists(): Promise<boolean> { return Promise.resolve(true); }
			override realpath(candidate: URI): Promise<URI> { return Promise.resolve(candidate); }
			override stat(candidate: URI): Promise<IFileStatWithPartialMetadata> {
				statCalls++;
				return Promise.resolve(fileStat(candidate, source.length, statCalls === 1 ? 'before' : 'after'));
			}
			override readFile(candidate: URI): Promise<IFileContent> {
				return Promise.resolve(fileContent(candidate, source, 'after'));
			}
		};
		const mainThread = disposables.add(createMainThread(
			new class extends mock<IBaseHalfPluginAdmissionService>() { override isAllowedContributor(): boolean { return true; } },
			fileService,
			workspaceContextService()
		));

		assert.strictEqual(await mainThread.$inspectCanvasNode(extensionIdentity(), resource), undefined);
		assert.strictEqual(statCalls, 2);
	});

	test('does not expose node bytes when same-size content changes without an identity update', async () => {
		const resource = URI.file('/workspace/clip.bhnode');
		const first = serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1), kind: 'image', title: 'Frame'
		}));
		const second = serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1), kind: 'audio', title: 'Frame'
		}));
		assert.strictEqual(first.length, second.length);
		let readCalls = 0;
		const fileService = new class extends mock<IFileService>() {
			override exists(): Promise<boolean> { return Promise.resolve(true); }
			override realpath(candidate: URI): Promise<URI> { return Promise.resolve(candidate); }
			override stat(candidate: URI): Promise<IFileStatWithPartialMetadata> { return Promise.resolve(fileStat(candidate, first.length)); }
			override readFile(candidate: URI): Promise<IFileContent> {
				readCalls++;
				return Promise.resolve(fileContent(candidate, readCalls === 1 ? first : second));
			}
		};
		const mainThread = disposables.add(createMainThread(
			new class extends mock<IBaseHalfPluginAdmissionService>() { override isAllowedContributor(): boolean { return true; } },
			fileService,
			workspaceContextService()
		));

		assert.strictEqual(await mainThread.$inspectCanvasNode(extensionIdentity(), resource), undefined);
		assert.strictEqual(readCalls, 2);
	});

	test('rejects malformed UTF-8 node bytes before parsing', async () => {
		const resource = URI.file('/workspace/clip.bhnode');
		const value = VSBuffer.wrap(new Uint8Array([0xc3, 0x28]));
		const stat = fileStat(resource, value.byteLength);
		const content: IFileContent = { ...stat, value };
		const fileService = new class extends mock<IFileService>() {
			override exists(): Promise<boolean> { return Promise.resolve(true); }
			override realpath(candidate: URI): Promise<URI> { return Promise.resolve(candidate); }
			override stat(): Promise<IFileStatWithPartialMetadata> { return Promise.resolve(stat); }
			override readFile(): Promise<IFileContent> { return Promise.resolve(content); }
		};
		const mainThread = disposables.add(createMainThread(
			new class extends mock<IBaseHalfPluginAdmissionService>() { override isAllowedContributor(): boolean { return true; } },
			fileService,
			workspaceContextService()
		));

		assert.strictEqual(await mainThread.$inspectCanvasNode(extensionIdentity(), resource), undefined);
	});

	test('rejects a node whose resolved file escapes the workspace', async () => {
		const admissionService = new class extends mock<IBaseHalfPluginAdmissionService>() {
			override isAllowedContributor(): boolean { return true; }
		};
		const fileService = new class extends mock<IFileService>() {
			override exists(): Promise<boolean> { return Promise.resolve(true); }
			override realpath(resource: URI): Promise<URI | undefined> {
				return Promise.resolve(resource.path === '/workspace' ? resource : URI.file('/outside/clip.bhnode'));
			}
			override stat(resource: URI): Promise<IFileStatWithPartialMetadata> {
				return Promise.resolve({
					resource,
					name: 'link.bhnode',
					isFile: true,
					isDirectory: false,
					isSymbolicLink: false,
					mtime: 1,
					ctime: 1,
					etag: '1',
					size: 1,
					readonly: false,
					locked: false,
					executable: false
				});
			}
		};
		const workspaceContextService = new class extends mock<IWorkspaceContextService>() {
			override getWorkspaceFolder(): IWorkspaceFolder {
				return { uri: URI.file('/workspace'), name: 'workspace', index: 0, toResource: path => URI.joinPath(URI.file('/workspace'), path) };
			}
		};
		const mainThread = disposables.add(createMainThread(admissionService, fileService, workspaceContextService));

		assert.strictEqual(await mainThread.$inspectCanvasNode(extensionIdentity(), URI.file('/workspace/link.bhnode')), undefined);
	});

});

function createMainThread(
	admissionService: IBaseHalfPluginAdmissionService,
	fileService: IFileService,
	workspaceContextService: IWorkspaceContextService = new class extends mock<IWorkspaceContextService>() {
		override getWorkspaceFolder(): IWorkspaceFolder | null { return null; }
	},
	projectFileTransitionService: IBaseHalfProjectFileTransitionService = undefined!,
): MainThreadBaseHalf {
	const proxy = new class extends mock<ExtHostBaseHalfShape>() { };
	const context = { getProxy: () => proxy } as unknown as IExtHostContext;
	const workingCopyService = new class extends mock<IWorkingCopyService>() {
		override isDirty(): boolean { return false; }
	};
	return new MainThreadBaseHalf(
		context,
		undefined!,
		undefined!,
		undefined!,
		undefined!,
		fileService,
		workspaceContextService,
		workingCopyService,
		projectFileTransitionService,
		undefined!,
		admissionService,
	);
}

/** Inspects `/workspace/clip.bhnode` holding `node`; `files` are the other files that exist. */
function inspect(node: IBaseHalfNodeDocument, files: ReadonlySet<string>) {
	return inspectSource(serializeBaseHalfNodeDocument(node), files);
}

async function inspectSource(source: string, files: ReadonlySet<string>) {
	const resource = URI.file('/workspace/clip.bhnode');
	const fileService = new class extends mock<IFileService>() {
		override exists(): Promise<boolean> { return Promise.resolve(true); }
		override realpath(candidate: URI): Promise<URI> { return Promise.resolve(candidate); }
		override stat(candidate: URI): Promise<IFileStatWithPartialMetadata> {
			if (candidate.path === resource.path) {
				return Promise.resolve(fileStat(candidate, source.length));
			}
			return files.has(candidate.path) ? Promise.resolve(fileStat(candidate, 42)) : Promise.reject(new Error('missing'));
		}
		override readFile(candidate: URI): Promise<IFileContent> {
			return Promise.resolve(fileContent(candidate, source));
		}
	};
	const mainThread = createMainThread(
		new class extends mock<IBaseHalfPluginAdmissionService>() { override isAllowedContributor(): boolean { return true; } },
		fileService,
		workspaceContextService()
	);
	try {
		return await mainThread.$inspectCanvasNode(extensionIdentity(), resource);
	} finally {
		mainThread.dispose();
	}
}

function videoNode(fields: Pick<IBaseHalfNodeDocument, 'task' | 'result'>): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({ id: baseHalfNodeTestId(1), kind: 'video', title: 'Clip', prompt: 'A slow orbit.', ...fields });
}

function request(): IBaseHalfVideoGenerationRecord {
	return { provider: 'acme', region: 'east', model: 'acme-motion-2', providerModel: 'acme-motion-2-e-260101', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true }, prompt: 'A slow orbit.', inputs: [] };
}

function workspaceContextService(): IWorkspaceContextService {
	return new class extends mock<IWorkspaceContextService>() {
		override getWorkspaceFolder(): IWorkspaceFolder {
			return { uri: URI.file('/workspace'), name: 'workspace', index: 0, toResource: path => URI.joinPath(URI.file('/workspace'), path) };
		}
	};
}

function fileStat(resource: URI, size: number, identity = '1'): IFileStatWithPartialMetadata {
	const timestamp = identity === 'after' ? 2 : 1;
	return {
		resource,
		name: resource.path.split('/').pop() ?? '',
		isFile: true,
		isDirectory: false,
		isSymbolicLink: false,
		mtime: timestamp,
		ctime: timestamp,
		etag: identity,
		size,
		readonly: false,
		locked: false,
		executable: false
	};
}

function fileContent(resource: URI, source: string, identity = '1'): IFileContent {
	const stat = fileStat(resource, source.length, identity);
	return {
		resource: stat.resource,
		name: stat.name,
		mtime: stat.mtime,
		ctime: stat.ctime,
		etag: stat.etag,
		size: stat.size,
		readonly: stat.readonly,
		locked: stat.locked,
		executable: stat.executable,
		value: VSBuffer.fromString(source)
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
