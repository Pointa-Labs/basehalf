/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BASEHALF_PLUGIN_STRUCTURAL_CLEANUP_MAX_TRANSITIONS, BaseHalfPluginStructuralCleanupService } from '../../common/basehalfPluginStructuralCleanup.js';

suite('BaseHalfPluginStructuralCleanupService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('activates exact reviewed descriptors and returns cloned transitions', async () => {
		const service = new BaseHalfPluginStructuralCleanupService();
		const descriptor = service.registerDescriptor('pointa.video', 'pointa.video.sequence-membership', ['.bhnode']);
		const expected = VSBuffer.fromString('before');
		const provider = service.registerProvider('pointa.video', {
			prepareDelete: () => Promise.resolve([{
				resource: URI.file('/workspace/sequence.json'),
				expected,
				next: VSBuffer.fromString('after'),
				label: 'Remove membership'
			}])
		});

		assert.deepStrictEqual(service.activationEvents(URI.file('/workspace/clip.bhnode')), ['onBaseHalfStructuralCleanup:pointa.video.sequence-membership']);
		assert.deepStrictEqual(service.activationEvents(URI.file('/workspace/clip.mp4')), []);
		const transitions = await service.prepareDelete(URI.file('/workspace/clip.bhnode'), CancellationToken.None);
		assert.strictEqual(transitions.length, 1);
		assert.notStrictEqual(transitions[0].expected, expected);
		assert.strictEqual(transitions[0].expected.toString(), 'before');

		provider.dispose();
		descriptor.dispose();
	});

	test('rejects competing changes to the same domain document', async () => {
		const service = new BaseHalfPluginStructuralCleanupService();
		const registrations = [];
		for (const id of ['one.plugin', 'two.plugin']) {
			registrations.push(service.registerDescriptor(id, `${id}.cleanup`, ['.bhnode']));
			registrations.push(service.registerProvider(id, {
				prepareDelete: () => Promise.resolve([{
					resource: URI.file('/workspace/sequence.json'),
					expected: VSBuffer.fromString('before'),
					next: VSBuffer.fromString(id),
					label: 'Cleanup'
				}])
			}));
		}
		await assert.rejects(service.prepareDelete(URI.file('/workspace/clip.bhnode'), CancellationToken.None), /More than one/);
		for (const registration of registrations) {
			registration.dispose();
		}
	});

	test('invokes only providers whose extension owns a matching descriptor', async () => {
		const service = new BaseHalfPluginStructuralCleanupService();
		const calls: string[] = [];
		const registrations = [
			service.registerDescriptor('one.plugin', 'one.plugin.node-cleanup', ['.bhnode']),
			service.registerDescriptor('two.plugin', 'two.plugin.media-cleanup', ['.mp4']),
			service.registerProvider('one.plugin', {
				prepareDelete: () => {
					calls.push('one.plugin');
					return Promise.resolve([]);
				}
			}),
			service.registerProvider('two.plugin', {
				prepareDelete: () => {
					calls.push('two.plugin');
					return Promise.resolve([]);
				}
			})
		];

		await service.prepareDelete(URI.file('/workspace/clip.bhnode'), CancellationToken.None);
		assert.deepStrictEqual(calls, ['one.plugin']);

		for (const registration of registrations) {
			registration.dispose();
		}
	});

	test('accepts the public transition limit and rejects one more', async () => {
		const createTransitions = (count: number) => Array.from({ length: count }, (_, index) => ({
			resource: URI.file(`/workspace/sequence-${index}.json`),
			expected: VSBuffer.fromString('before'),
			next: VSBuffer.fromString('after'),
			label: 'Cleanup'
		}));
		const service = new BaseHalfPluginStructuralCleanupService();
		const descriptor = service.registerDescriptor('one.plugin', 'one.plugin.cleanup', ['.bhnode']);
		let count = BASEHALF_PLUGIN_STRUCTURAL_CLEANUP_MAX_TRANSITIONS;
		const provider = service.registerProvider('one.plugin', {
			prepareDelete: () => Promise.resolve(createTransitions(count))
		});

		const accepted = await service.prepareDelete(URI.file('/workspace/clip.bhnode'), CancellationToken.None);
		assert.strictEqual(accepted.length, BASEHALF_PLUGIN_STRUCTURAL_CLEANUP_MAX_TRANSITIONS);
		count++;
		await assert.rejects(
			service.prepareDelete(URI.file('/workspace/clip.bhnode'), CancellationToken.None),
			/too many structural cleanup changes/
		);

		provider.dispose();
		descriptor.dispose();
	});

	test('cancellation after a provider response rejects instead of returning partial cleanup', async () => {
		const service = new BaseHalfPluginStructuralCleanupService();
		const source = new CancellationTokenSource();
		const descriptor = service.registerDescriptor('one.plugin', 'one.plugin.cleanup', ['.bhnode']);
		const registration = service.registerProvider('one.plugin', {
			prepareDelete: async () => {
				source.cancel();
				return [{
					resource: URI.file('/workspace/sequence.json'),
					expected: VSBuffer.fromString('before'),
					next: VSBuffer.fromString('after'),
					label: 'Cleanup'
				}];
			}
		});
		await assert.rejects(
			service.prepareDelete(URI.file('/workspace/clip.bhnode'), source.token),
			error => isCancellationError(error)
		);
		registration.dispose();
		descriptor.dispose();
		source.dispose();
	});
});
