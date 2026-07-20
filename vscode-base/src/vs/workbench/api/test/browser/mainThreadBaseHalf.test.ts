/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IFileContent, IFileService, IFileStatWithPartialMetadata } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IBaseHalfModelServiceService } from '../../../basehalf/common/basehalfModelServices.js';
import { IBaseHalfPluginAdmissionService } from '../../../basehalf/common/basehalfPluginAdmissionService.js';
import { IBaseHalfProjectFileTransitionService } from '../../../basehalf/common/basehalfProjectFileTransitions.js';
import { IBaseHalfCanvasRecipeRegistryService, IBaseHalfCanvasRecipeRuntimeProvider, IBaseHalfCanvasRecipeRuntimeService } from '../../../basehalf/common/basehalfCanvasRecipes.js';
import { IBaseHalfNodeExecutionService } from '../../../basehalf/browser/basehalfNodeExecutionService.js';
import { createBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../../../basehalf/common/basehalfNodeDocument.js';
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

	test('validates bounded selective inspection options before touching storage', async () => {
		let existsCalls = 0;
		const admissionService = new class extends mock<IBaseHalfPluginAdmissionService>() {
			override isAllowedContributor(): boolean { return true; }
		};
		const fileService = new class extends mock<IFileService>() {
			override exists(): Promise<boolean> {
				existsCalls++;
				return Promise.resolve(true);
			}
		};
		const mainThread = disposables.add(createMainThread(admissionService, fileService));

		await assert.rejects(mainThread.$inspectCanvasNode(extensionIdentity(), URI.file('/workspace/clip.bhnode'), {
			versionIds: Array.from({ length: 257 }, (_, index) => `run-${index}`)
		}), /at most 256 ids/);
		await assert.rejects(mainThread.$inspectCanvasNode(extensionIdentity(), URI.file('/workspace/clip.bhnode'), {
			versionIds: ['run-1', 'run-1']
		}), /duplicated/);
		await assert.rejects(mainThread.$inspectCanvasNode(extensionIdentity(), URI.file('/workspace/clip.bhnode'), {
			unknown: true
		} as never), /not supported/);
		assert.strictEqual(existsCalls, 0);
	});

	test('fresh-verifies only requested versions and Current instead of the full history', async () => {
		const resource = URI.file('/workspace/clip.bhnode');
		const revisions = Array.from({ length: 40 }, (_, index) => ({
			id: `revision-${index}`,
			source: 'imported' as const,
			createdAt: `2026-07-18T12:${String(index).padStart(2, '0')}:00.000Z`,
			artifacts: [{
				id: 'primary', outputId: 'primary', kind: 'video' as const,
				path: `outputs/revision-${index}/clip.mp4`, sha256: 'A'.repeat(43), size: index + 1
			}],
			primaryArtifactId: 'primary'
		}));
		const source = serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1), kind: 'video', title: 'Clip', role: 'clip', revisions,
			current: { source: 'imported', revisionId: 'revision-39', outputPaths: ['outputs/revision-39/clip.mp4'] }
		}));
		const admissionService = new class extends mock<IBaseHalfPluginAdmissionService>() {
			override isAllowedContributor(): boolean { return true; }
		};
		const fileService = new class extends mock<IFileService>() {
			override exists(): Promise<boolean> { return Promise.resolve(true); }
			override realpath(candidate: URI): Promise<URI> { return Promise.resolve(candidate); }
			override stat(candidate: URI): Promise<IFileStatWithPartialMetadata> {
				return Promise.resolve({
					resource: candidate, name: 'clip.bhnode', isFile: true, isDirectory: false, isSymbolicLink: false,
					mtime: 1, ctime: 1, etag: '1', size: source.length, readonly: false, locked: false, executable: false
				});
			}
				override readFile(): Promise<IFileContent> {
					return Promise.resolve(fileContent(resource, source));
				}
		};
		const workspaceContextService = new class extends mock<IWorkspaceContextService>() {
			override getWorkspaceFolder(): IWorkspaceFolder {
				return { uri: URI.file('/workspace'), name: 'workspace', index: 0, toResource: path => URI.joinPath(URI.file('/workspace'), path) };
			}
		};
		const verified: { readonly path: string; readonly fresh: boolean | undefined }[] = [];
		const nodeExecutionService = new class extends mock<IBaseHalfNodeExecutionService>() {
			override getActiveRun(): undefined { return undefined; }
			override getArtifactIntegrity(_workspaceFolder: URI, artifact: { readonly path: string }, options?: { readonly fresh?: boolean }): Promise<'available'> {
				verified.push({ path: artifact.path, fresh: options?.fresh });
				return Promise.resolve('available');
			}
		};
		const mainThread = disposables.add(createMainThread(admissionService, fileService, workspaceContextService, nodeExecutionService));

		const identityOnly = await mainThread.$inspectCanvasNode(extensionIdentity(), resource, { versionIds: [], includeCurrent: false });
		assert.deepStrictEqual(identityOnly?.versions, []);
		assert.strictEqual(identityOnly?.currentVersionId, 'revision-39');
		assert.strictEqual(verified.length, 0);

		const selected = await mainThread.$inspectCanvasNode(extensionIdentity(), resource, {
			versionIds: ['revision-3'], includeCurrent: true
		});
		assert.deepStrictEqual(selected?.versions.map(version => version.id), ['revision-3', 'revision-39']);
		assert.deepStrictEqual(verified, [
			{ path: 'outputs/revision-3/clip.mp4', fresh: true },
			{ path: 'outputs/revision-39/clip.mp4', fresh: true }
		]);

		verified.length = 0;
		const legacy = await mainThread.$inspectCanvasNode(extensionIdentity(), resource);
		assert.strictEqual(legacy?.versions.length, 40);
		assert.strictEqual(verified.length, 40);
		assert.strictEqual(verified.every(entry => entry.fresh === undefined), true);
	});

	test('does not expose node bytes when the verified path changes during the read', async () => {
		const resource = URI.file('/workspace/clip.bhnode');
		const source = serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1), kind: 'video', title: 'Clip', role: 'clip'
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
			id: baseHalfNodeTestId(1), kind: 'video', title: 'Clip', role: 'clip'
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
			id: baseHalfNodeTestId(1), kind: 'image', title: 'Frame', role: 'clip'
		}));
		const second = serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1), kind: 'video', title: 'Frame', role: 'clip'
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

	test('bounds the default large-history view and shares integrity-check concurrency across inspections', async () => {
		const resource = URI.file('/workspace/clip.bhnode');
		const recipe = { recipeId: 'reviewed.workflow.render', parameters: {}, inputBindings: [] };
		const artifact = (prefix: string, index: number) => ({
			id: 'primary', outputId: 'primary', kind: 'video' as const,
			path: `outputs/${prefix}-${index}/clip.mp4`, sha256: 'A'.repeat(43), size: index + 1
		});
		const runs = Array.from({ length: 1024 }, (_, index) => {
			const createdAt = new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString();
			const primary = artifact('run', index);
			return {
				id: `run-${index}`, status: 'succeeded' as const, createdAt, startedAt: createdAt, completedAt: createdAt,
				recipe, model: { source: 'local' as const }, inputs: [], artifacts: [primary],
				primaryArtifactId: primary.id, outputPaths: [primary.path]
			};
		});
		const revisions = Array.from({ length: 1024 }, (_, index) => {
			const primary = artifact('revision', index);
			return {
				id: `revision-${index}`, source: 'imported' as const,
				createdAt: new Date(Date.UTC(2026, 0, 1) + (1024 + index) * 1000).toISOString(),
				artifacts: [primary], primaryArtifactId: primary.id
			};
		});
		const source = serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1), kind: 'video', title: 'Clip', role: 'clip', recipe, runs, revisions,
			current: { source: 'run', runId: 'run-0', outputPaths: [runs[0].outputPaths[0]] }
		}));
		const fileService = new class extends mock<IFileService>() {
			override exists(): Promise<boolean> { return Promise.resolve(true); }
			override realpath(candidate: URI): Promise<URI> { return Promise.resolve(candidate); }
			override stat(candidate: URI): Promise<IFileStatWithPartialMetadata> { return Promise.resolve(fileStat(candidate, source.length)); }
			override readFile(candidate: URI): Promise<IFileContent> { return Promise.resolve(fileContent(candidate, source)); }
		};
		let integrityChecks = 0;
		let activeIntegrityChecks = 0;
		let peakIntegrityChecks = 0;
		const nodeExecutionService = new class extends mock<IBaseHalfNodeExecutionService>() {
			override getActiveRun(): undefined { return undefined; }
			override getArtifactIntegrity(): Promise<'available'> {
				integrityChecks++;
				activeIntegrityChecks++;
				peakIntegrityChecks = Math.max(peakIntegrityChecks, activeIntegrityChecks);
				return Promise.resolve().then(() => {
					activeIntegrityChecks--;
					return 'available';
				});
			}
		};
		const mainThread = disposables.add(createMainThread(
			new class extends mock<IBaseHalfPluginAdmissionService>() { override isAllowedContributor(): boolean { return true; } },
			fileService,
			workspaceContextService(),
			nodeExecutionService
		));

		const [first, second] = await Promise.all([
			mainThread.$inspectCanvasNode(extensionIdentity(), resource),
			mainThread.$inspectCanvasNode(extensionIdentity(), resource)
		]);
		assert.strictEqual(first?.versions.length, 256);
		assert.strictEqual(second?.versions.length, 256);
		assert.strictEqual(first?.versions.some(version => version.id === 'run-0'), true);
		assert.strictEqual(first?.versions.some(version => version.id === 'revision-1023'), true);
		assert.strictEqual(integrityChecks, 512);
		assert.strictEqual(activeIntegrityChecks, 0);
		assert.strictEqual(peakIntegrityChecks, 8);
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

	test('grants model credentials only to the matching active recipe execution', async () => {
		let runtimeProvider: IBaseHalfCanvasRecipeRuntimeProvider | undefined;
		let accessCalls = 0;
		let grantedSnapshot: Parameters<MainThreadBaseHalf['$getModelServiceAccess']>[1] | undefined;
		const proxy = new class extends mock<ExtHostBaseHalfShape>() {
			override $onDidChangeModelServices(): void { }
			override async $executeCanvasRecipe(_runHandle: string, _recipeId: string, request: Parameters<ExtHostBaseHalfShape['$executeCanvasRecipe']>[2]): Promise<ReturnType<ExtHostBaseHalfShape['$executeCanvasRecipe']> extends Promise<infer TResult> ? TResult : never> {
				assert.ok(request.modelService?.accessToken);
				grantedSnapshot = request.modelService;
				assert.ok(await mainThread.$getModelServiceAccess(extensionIdentity(), request.modelService));
				assert.strictEqual(await mainThread.$getModelServiceAccess(
					{ ...extensionIdentity(), id: new ExtensionIdentifier('other.workflow') },
					request.modelService
				), undefined);
				return { artifacts: [], primaryArtifactId: undefined };
			}
		};
		const recipeRegistry = new class extends mock<IBaseHalfCanvasRecipeRegistryService>() {
			override getRecipe(): never {
				return { id: 'reviewed.workflow.render', extensionId: 'reviewed.workflow' } as never;
			}
		};
		const recipeRuntime = new class extends mock<IBaseHalfCanvasRecipeRuntimeService>() {
			override registerExecutor(_recipeId: string, provider: IBaseHalfCanvasRecipeRuntimeProvider) {
				runtimeProvider = provider;
				return toDisposable(() => undefined);
			}
		};
		const modelServices = new class extends mock<IBaseHalfModelServiceService>() {
			override onDidChange = Event.None;
			override getAccess(): Promise<never> {
				accessCalls++;
				return Promise.resolve({ id: 'studio.images' } as never);
			}
		};
		const context = { getProxy: () => proxy } as unknown as IExtHostContext;
		const mainThread = disposables.add(new MainThreadBaseHalf(
			context, undefined!, undefined!, undefined!, undefined!, recipeRegistry, recipeRuntime,
			modelServices, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!,
			new class extends mock<IBaseHalfPluginAdmissionService>() { override isAllowedContributor(): boolean { return true; } }
		));
		mainThread.$registerCanvasRecipeExecutor({ id: { value: 'reviewed.workflow' } } as never, 'reviewed.workflow.render');
		assert.ok(runtimeProvider);
		await runtimeProvider.execute({
			runId: 'run-1', workspaceFolder: URI.file('/workspace'),
			node: { id: 'node-1', path: 'frame.bhnode', kind: 'image' },
			recipeId: 'reviewed.workflow.render', parameters: {}, modelServiceId: 'studio.images',
			modelService: {
				serviceId: 'studio.images', serviceLabel: 'Studio Images',
				connectionIdentity: `sha256:${'A'.repeat(43)}`, capability: 'image'
			},
			inputs: [], outputDirectory: URI.file('/workspace/outputs/run-1')
		}, { report() { } }, CancellationToken.None);
		assert.strictEqual(accessCalls, 1);
		assert.ok(grantedSnapshot);
		assert.strictEqual(await mainThread.$getModelServiceAccess(extensionIdentity(), grantedSnapshot), undefined);
	});

	test('retains an active model grant while a cancelled executor is still settling', async () => {
		let runtimeProvider: IBaseHalfCanvasRecipeRuntimeProvider | undefined;
		let requestSeen: Parameters<ExtHostBaseHalfShape['$executeCanvasRecipe']>[2] | undefined;
		let cancellationSeen: CancellationToken | undefined;
		let resolveExecutor: ((result: Awaited<ReturnType<ExtHostBaseHalfShape['$executeCanvasRecipe']>>) => void) | undefined;
		const executorResult = new Promise<Awaited<ReturnType<ExtHostBaseHalfShape['$executeCanvasRecipe']>>>(resolve => {
			resolveExecutor = resolve;
		});
		const proxy = new class extends mock<ExtHostBaseHalfShape>() {
			override $onDidChangeModelServices(): void { }
			override $executeCanvasRecipe(
				_runHandle: string,
				_recipeId: string,
				request: Parameters<ExtHostBaseHalfShape['$executeCanvasRecipe']>[2],
				cancellation: CancellationToken
			): Promise<Awaited<ReturnType<ExtHostBaseHalfShape['$executeCanvasRecipe']>>> {
				requestSeen = request;
				cancellationSeen = cancellation;
				return executorResult;
			}
		};
		const recipeRegistry = new class extends mock<IBaseHalfCanvasRecipeRegistryService>() {
			override getRecipe(): never {
				return { id: 'reviewed.workflow.render', extensionId: 'reviewed.workflow' } as never;
			}
		};
		const recipeRuntime = new class extends mock<IBaseHalfCanvasRecipeRuntimeService>() {
			override registerExecutor(_recipeId: string, provider: IBaseHalfCanvasRecipeRuntimeProvider) {
				runtimeProvider = provider;
				return toDisposable(() => undefined);
			}
		};
		const modelServices = new class extends mock<IBaseHalfModelServiceService>() {
			override onDidChange = Event.None;
			override getAccess(): Promise<never> {
				return Promise.resolve({ id: 'studio.images' } as never);
			}
		};
		const context = { getProxy: () => proxy } as unknown as IExtHostContext;
		const mainThread = disposables.add(new MainThreadBaseHalf(
			context, undefined!, undefined!, undefined!, undefined!, recipeRegistry, recipeRuntime,
			modelServices, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!,
			new class extends mock<IBaseHalfPluginAdmissionService>() { override isAllowedContributor(): boolean { return true; } }
		));
		mainThread.$registerCanvasRecipeExecutor({ id: { value: 'reviewed.workflow' } } as never, 'reviewed.workflow.render');
		assert.ok(runtimeProvider);
		const cancellation = disposables.add(new CancellationTokenSource());
		const execution = runtimeProvider.execute({
			runId: 'run-1', workspaceFolder: URI.file('/workspace'),
			node: { id: 'node-1', path: 'frame.bhnode', kind: 'image' },
			recipeId: 'reviewed.workflow.render', parameters: {}, modelServiceId: 'studio.images',
			modelService: {
				serviceId: 'studio.images', serviceLabel: 'Studio Images',
				connectionIdentity: `sha256:${'A'.repeat(43)}`, capability: 'image'
			},
			inputs: [], outputDirectory: URI.file('/workspace/outputs/run-1')
		}, { report() { } }, cancellation.token);
		let settled = false;
		void execution.then(() => { settled = true; }, () => { settled = true; });
		await Promise.resolve();
		assert.ok(requestSeen?.modelService);

		cancellation.cancel();
		await Promise.resolve();
		assert.strictEqual(cancellationSeen?.isCancellationRequested, true);
		assert.strictEqual(settled, false);
		assert.ok(await mainThread.$getModelServiceAccess(extensionIdentity(), requestSeen.modelService));

		assert.ok(resolveExecutor);
		resolveExecutor({ artifacts: [] });
		await execution;
		assert.strictEqual(settled, true);
		assert.strictEqual(await mainThread.$getModelServiceAccess(extensionIdentity(), requestSeen.modelService), undefined);
	});
});

function createMainThread(
	admissionService: IBaseHalfPluginAdmissionService,
	fileService: IFileService,
	workspaceContextService: IWorkspaceContextService = new class extends mock<IWorkspaceContextService>() {
		override getWorkspaceFolder(): IWorkspaceFolder | null { return null; }
	},
	nodeExecutionService: IBaseHalfNodeExecutionService = undefined!,
	projectFileTransitionService: IBaseHalfProjectFileTransitionService = undefined!,
): MainThreadBaseHalf {
	const proxy = new class extends mock<ExtHostBaseHalfShape>() {
		override $onDidChangeModelServices(): void { }
	};
	const context = { getProxy: () => proxy } as unknown as IExtHostContext;
	const modelServiceService = new class extends mock<IBaseHalfModelServiceService>() {
		override onDidChange = Event.None;
	};
	const workingCopyService = new class extends mock<IWorkingCopyService>() {
		override isDirty(): boolean { return false; }
	};
	return new MainThreadBaseHalf(
		context,
		undefined!,
		undefined!,
		undefined!,
		undefined!,
		undefined!,
		undefined!,
		modelServiceService,
		nodeExecutionService,
		fileService,
		workspaceContextService,
		workingCopyService,
		projectFileTransitionService,
		undefined!,
		admissionService,
	);
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
