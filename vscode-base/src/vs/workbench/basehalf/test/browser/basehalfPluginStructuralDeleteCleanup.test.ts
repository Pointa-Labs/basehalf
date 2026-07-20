/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IFileService, IFileStatWithMetadata } from '../../../../platform/files/common/files.js';
import { UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { ActivationKind, IExtensionService } from '../../../services/extensions/common/extensions.js';
import { SourceTargetPair } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { BaseHalfPluginStructuralDeleteCleanupService, rollbackBaseHalfUncompletedDeleteCleanups, settleBaseHalfStagedDeleteCleanups } from '../../browser/basehalfPluginStructuralDeleteCleanup.js';
import { BaseHalfPluginStructuralCleanupService } from '../../common/basehalfPluginStructuralCleanup.js';
import { IBaseHalfProjectFileTransition, IBaseHalfProjectFileTransitionService, IBaseHalfStagedProjectFileTransition } from '../../common/basehalfProjectFileTransitions.js';
import { IBaseHalfWorkspaceMutationLease } from '../../common/basehalfWorkspaceMutation.js';

suite('BaseHalfPluginStructuralDeleteCleanupService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('stages every ordinary file delete and can join the caller file undo group', async () => {
		const one = URI.file('/workspace/one.bhnode');
		const two = URI.file('/workspace/two.bhnode');
		const sequence = URI.file('/workspace/video-sequence.json');
		const lease = {} as IBaseHalfWorkspaceMutationLease;
		let sequenceText = 'one,two';
		const cleanup = new BaseHalfPluginStructuralCleanupService();
		const descriptor = cleanup.registerDescriptor('pointa.video', 'pointa.video.membership', ['.bhnode']);
		const prepared: string[] = [];
		const provider = cleanup.registerProvider('pointa.video', {
			prepareDelete: async resource => {
				prepared.push(resource.path);
				return [{
					resource: sequence,
					expected: VSBuffer.fromString(sequenceText),
					next: VSBuffer.fromString(sequenceText.split(',').filter(value => value !== basename(resource).replace('.bhnode', '')).join(',')),
					label: 'Update Sequence'
				}];
			}
		});
		const committedGroups: (UndoRedoGroup | undefined)[] = [];
		const transitionService = new class extends mock<IBaseHalfProjectFileTransitionService>() {
			override async stage(transition: IBaseHalfProjectFileTransition, activeLease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfStagedProjectFileTransition> {
				assert.strictEqual(activeLease, lease);
				assert.strictEqual(transition.expected.toString(), sequenceText);
				sequenceText = transition.next.toString();
				return {
					changed: true,
					commit: group => { committedGroups.push(group); },
					accept: () => undefined,
					rollback: async () => { sequenceText = transition.expected.toString(); }
				};
			}
		};
		let activations = 0;
		const service = new BaseHalfPluginStructuralDeleteCleanupService(
			fileServiceFor([fileStat(one), fileStat(two)]),
			new class extends mock<IExtensionService>() {
				override async activateByEvent(_activationEvent: string, activationKind?: ActivationKind): Promise<void> {
					assert.strictEqual(activationKind, ActivationKind.Immediate);
					activations++;
				}
			},
			cleanup,
			transitionService,
			testWorkspaceContextService()
		);

		const staged = await service.stageDelete(deleteFiles(one, two), CancellationToken.None, lease);

		assert.deepStrictEqual(prepared, [one.path, two.path]);
		assert.deepStrictEqual(staged.map(entry => entry.ownerIndex), [0, 1]);
		assert.strictEqual(sequenceText, '');
		assert.strictEqual(activations, 1, 'one provider activation is shared by the whole delete batch');
		const group = new UndoRedoGroup();
		settleBaseHalfStagedDeleteCleanups(staged, 2, group);
		assert.deepStrictEqual(committedGroups, [group, group]);
		provider.dispose();
		descriptor.dispose();
	});

	test('keeps only the durable prefix when a delete batch partially completes', async () => {
		const lease = {} as IBaseHalfWorkspaceMutationLease;
		const committed: number[] = [];
		const accepted: number[] = [];
		const rolledBack: number[] = [];
		const staged = [0, 1].map(ownerIndex => ({
			ownerIndex,
			transition: {
				changed: true,
				commit: () => { committed.push(ownerIndex); },
				accept: () => { accepted.push(ownerIndex); },
				rollback: async activeLease => {
					assert.strictEqual(activeLease, lease);
					rolledBack.push(ownerIndex);
				}
			} satisfies IBaseHalfStagedProjectFileTransition
		}));

		await rollbackBaseHalfUncompletedDeleteCleanups(staged, 1, lease);
		settleBaseHalfStagedDeleteCleanups(staged, 1, undefined);

		assert.deepStrictEqual(rolledBack, [1]);
		assert.deepStrictEqual(accepted, [0]);
		assert.deepStrictEqual(committed, []);
	});

	test('finds matching folder descendants without touching reserved outputs or symlinks', async () => {
		const folder = URI.file('/workspace/shots');
		const one = URI.file('/workspace/shots/one.bhnode');
		const nested = URI.file('/workspace/shots/nested');
		const two = URI.file('/workspace/shots/nested/two.bhnode');
		const symlink = URI.file('/workspace/shots/linked.bhnode');
		const ordinary = URI.file('/workspace/shots/readme.md');
		const reserved = URI.file('/workspace/outputs');
		const frozen = URI.file('/workspace/outputs/frozen.bhnode');
		const stats = [
			fileStat(folder, true, [fileStat(one), fileStat(nested, true), fileStat(symlink, false, undefined, true), fileStat(ordinary), fileStat(reserved, true)]),
			fileStat(nested, true, [fileStat(two)]),
			fileStat(reserved, true, [fileStat(frozen)])
		];
		const cleanup = new BaseHalfPluginStructuralCleanupService();
		const descriptor = cleanup.registerDescriptor('pointa.video', 'pointa.video.membership', ['.bhnode']);
		const prepared: string[] = [];
		const provider = cleanup.registerProvider('pointa.video', {
			prepareDelete: async resource => { prepared.push(resource.path); return []; }
		});
		const resolved: string[] = [];
		const baseFileService = fileServiceFor(stats);
		const fileService = new class extends mock<IFileService>() {
			override async resolve(resource: URI): Promise<IFileStatWithMetadata> {
				resolved.push(resource.path);
				return baseFileService.resolve(resource, { resolveMetadata: true });
			}
		};
		const service = new BaseHalfPluginStructuralDeleteCleanupService(
			fileService,
			new class extends mock<IExtensionService>() {
				override async activateByEvent(): Promise<void> { }
			},
			cleanup,
			new class extends mock<IBaseHalfProjectFileTransitionService>() { },
			testWorkspaceContextService()
		);

		const staged = await service.stageDelete(deleteFiles(folder), CancellationToken.None, {} as IBaseHalfWorkspaceMutationLease);

		assert.deepStrictEqual(prepared, [one.path, two.path]);
		assert.deepStrictEqual(resolved, [folder.path, nested.path]);
		assert.deepStrictEqual(staged, []);
		provider.dispose();
		descriptor.dispose();
	});

	test('rolls back its staged prefix when later preparation fails', async () => {
		const one = URI.file('/workspace/one.bhnode');
		const two = URI.file('/workspace/two.bhnode');
		const sequence = URI.file('/workspace/video-sequence.json');
		const lease = {} as IBaseHalfWorkspaceMutationLease;
		let sequenceText = 'one,two';
		let stageIndex = 0;
		let rolledBack = false;
		const cleanup = new BaseHalfPluginStructuralCleanupService();
		const descriptor = cleanup.registerDescriptor('pointa.video', 'pointa.video.membership', ['.bhnode']);
		const provider = cleanup.registerProvider('pointa.video', {
			prepareDelete: async resource => [{
				resource: sequence,
				expected: VSBuffer.fromString(sequenceText),
				next: VSBuffer.fromString(sequenceText.split(',').filter(value => value !== basename(resource).replace('.bhnode', '')).join(',')),
				label: 'Update Sequence'
			}]
		});
		const transitionService = new class extends mock<IBaseHalfProjectFileTransitionService>() {
			override async stage(transition: IBaseHalfProjectFileTransition, activeLease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfStagedProjectFileTransition> {
				assert.strictEqual(activeLease, lease);
				if (stageIndex++ === 1) {
					throw new Error('second transition failed');
				}
				sequenceText = transition.next.toString();
				return {
					changed: true,
					commit: () => undefined,
					accept: () => undefined,
					rollback: async rollbackLease => {
						assert.strictEqual(rollbackLease, lease);
						sequenceText = transition.expected.toString();
						rolledBack = true;
					}
				};
			}
		};
		const service = new BaseHalfPluginStructuralDeleteCleanupService(
			fileServiceFor([fileStat(one), fileStat(two)]),
			new class extends mock<IExtensionService>() {
				override async activateByEvent(): Promise<void> { }
			},
			cleanup,
			transitionService,
			testWorkspaceContextService()
		);

		await assert.rejects(service.stageDelete(deleteFiles(one, two), CancellationToken.None, lease), /second transition failed/);
		assert.strictEqual(sequenceText, 'one,two');
		assert.strictEqual(rolledBack, true);
		provider.dispose();
		descriptor.dispose();
	});
});

function deleteFiles(...resources: URI[]): readonly SourceTargetPair[] {
	return resources.map(target => ({ target }));
}

function fileStat(resource: URI, directory = false, children?: IFileStatWithMetadata[], symbolicLink = false): IFileStatWithMetadata {
	return {
		resource,
		name: basename(resource),
		isFile: !directory,
		isDirectory: directory,
		isSymbolicLink: symbolicLink,
		mtime: 0,
		ctime: 0,
		etag: '',
		size: 0,
		readonly: false,
		locked: false,
		executable: false,
		children
	};
}

function fileServiceFor(stats: readonly IFileStatWithMetadata[]): IFileService {
	const byResource = new Map(stats.map(stat => [stat.resource.toString(), stat]));
	return new class extends mock<IFileService>() {
		override async resolve(resource: URI): Promise<IFileStatWithMetadata> {
			const stat = byResource.get(resource.toString());
			if (!stat) {
				throw new Error(`Unexpected resolve: ${resource.path}`);
			}
			return stat;
		}
	};
}

function testWorkspaceContextService(): IWorkspaceContextService {
	return new class extends mock<IWorkspaceContextService>() {
		override getWorkspaceFolder(resource: URI): IWorkspaceFolder | null {
			if (resource.path === '/workspace' || resource.path.startsWith('/workspace/')) {
				return {
					uri: URI.file('/workspace'),
					name: 'workspace',
					index: 0,
					toResource: relativePath => URI.joinPath(URI.file('/workspace'), relativePath)
				};
			}
			return null;
		}
	};
}
