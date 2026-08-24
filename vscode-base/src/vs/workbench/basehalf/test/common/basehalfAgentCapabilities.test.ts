/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BaseHalfAgentCapabilityRegistryService,
	IBaseHalfAgentCapabilityContribution,
	validateBaseHalfAgentCapabilityContribution,
	validateBaseHalfAgentOperationParameters,
	validateBaseHalfAgentOperationReturn
} from '../../common/basehalfAgentCapabilities.js';

suite('BaseHalfAgentCapabilities', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('registers immutable owned declarations and releases ids on dispose', () => {
		const registry = new BaseHalfAgentCapabilityRegistryService();
		let changes = 0;
		const listener = registry.onDidChange(() => changes++);
		try {
			const registration = registry.registerCapability('studio.workflow', validCapability());
			const descriptor = registry.getCapability('studio.workflow.sequence-capability');
			assert.ok(descriptor);
			assert.strictEqual(descriptor.extensionId, 'studio.workflow');
			assert.strictEqual(descriptor.documents[0].kind, 'studio.workflow.sequence');
			assert.strictEqual(Object.isFrozen(descriptor), true);
			assert.strictEqual(Object.isFrozen(descriptor.documents), true);
			assert.strictEqual(Object.isFrozen(descriptor.operations[0].parameters), true);
			assert.throws(() => registry.registerCapability('studio.workflow', validCapability()), /already registered/);

			registration.dispose();
			assert.strictEqual(registry.getCapability('studio.workflow.sequence-capability'), undefined);
			const restarted = registry.registerCapability('studio.workflow', validCapability());
			restarted.dispose();
			assert.strictEqual(changes, 4);
		} finally {
			listener.dispose();
			registry.dispose();
		}
	});

	test('rejects unowned, ambiguous, and unsupported declarations', () => {
		assert.throws(() => validateBaseHalfAgentCapabilityContribution('studio.workflow', {
			...validCapability(),
			id: 'other.workflow.sequence-capability'
		}), /must start with 'studio.workflow.'/);
		assert.throws(() => validateBaseHalfAgentCapabilityContribution('studio.workflow', {
			...validCapability(),
			unknown: true
		} as unknown as IBaseHalfAgentCapabilityContribution), /unsupported fields/);
		assert.throws(() => validateBaseHalfAgentCapabilityContribution('studio.workflow', {
			...validCapability(),
			documents: [...validCapability().documents!, validCapability().documents![0]]
		}), /declares document kind.*more than once/);
		assert.throws(() => validateBaseHalfAgentCapabilityContribution('studio.workflow', {
			...validCapability(),
			operations: [{ ...validCapability().operations![0], command: 'other.workflow.inspect' }]
		}), /not owned/);
		assert.throws(() => validateBaseHalfAgentCapabilityContribution('studio.workflow', {
			...validCapability(),
			operations: [{ ...validCapability().operations![0], deterministic: false }]
		} as unknown as IBaseHalfAgentCapabilityContribution), /must be deterministic/);
		assert.throws(() => validateBaseHalfAgentCapabilityContribution('studio.workflow', {
			...validCapability(),
			documents: [{
				...validCapability().documents![0],
				pin: { mode: 'exact-result-version' }
			}]
		} as unknown as IBaseHalfAgentCapabilityContribution), /unsupported fields/);
		assert.throws(() => validateBaseHalfAgentCapabilityContribution('studio.workflow', {
			id: 'studio.workflow.empty',
			label: 'Empty'
		}), /must declare a document or operation/);
	});

	test('rejects oversized and malformed parameter contracts', () => {
		assert.throws(() => validateBaseHalfAgentCapabilityContribution('studio.workflow', {
			...validCapability(),
			description: 'x'.repeat(70_000)
		}), /cannot exceed 65536 UTF-8 bytes/);
		assert.throws(() => validateBaseHalfAgentCapabilityContribution('studio.workflow', {
			...validCapability(),
			operations: [{
				...validCapability().operations![0],
				parameters: [{
					name: 'direction',
					type: 'enum',
					required: true,
					description: 'Move direction.',
					values: ['up', 'up']
				}]
			}]
		}), /duplicate enum values/);
		assert.throws(() => validateBaseHalfAgentCapabilityContribution('studio.workflow', {
			...validCapability(),
			operations: [{
				...validCapability().operations![0],
				parameters: [{
					name: 'sequence',
					type: 'uri',
					required: true,
					description: 'Sequence URI.',
					values: ['file']
				}]
			}]
		}), /only for enum type/);
	});

	test('resolves globally unique reviewed operations and validates request and return contracts', () => {
		const registry = new BaseHalfAgentCapabilityRegistryService();
		let registration: { dispose(): void } | undefined;
		try {
			registration = registry.registerCapability('studio.workflow', validCapability());
			const resolved = registry.getOperation('STUDIO.WORKFLOW.SEQUENCE-INSPECT');
			assert.ok(resolved);
			assert.strictEqual(resolved.capability.id, 'studio.workflow.sequence-capability');
			assert.deepStrictEqual(validateBaseHalfAgentOperationParameters(resolved.operation, {
				sequence: 'workflow/sequence.json'
			}), { sequence: 'workflow/sequence.json' });
			assert.throws(() => validateBaseHalfAgentOperationParameters(resolved.operation, {}), /requires parameter 'sequence'/);
			assert.throws(() => validateBaseHalfAgentOperationParameters(resolved.operation, { sequence: 1 }), /must be non-empty text/);
			assert.throws(() => validateBaseHalfAgentOperationParameters(resolved.operation, { sequence: 'workflow/sequence.json', extra: true }), /unsupported parameters/);
			assert.deepStrictEqual(validateBaseHalfAgentOperationReturn(resolved.operation, { valid: true }), { valid: true });
			assert.throws(() => validateBaseHalfAgentOperationReturn(resolved.operation, ['wrong']), /declared object return type/);

			const duplicateOperation = validCapability();
			assert.throws(() => registry.registerCapability('studio.workflow', {
				...duplicateOperation,
				id: 'studio.workflow.another-capability'
			}), /operation.*already registered/);
		} finally {
			registration?.dispose();
			registry.dispose();
		}
	});
});

function validCapability(): IBaseHalfAgentCapabilityContribution {
	return {
		id: 'studio.workflow.sequence-capability',
		label: 'Sequence',
		description: 'Basic playback order over sealed local results.',
		documents: [{
			kind: 'studio.workflow.sequence',
			version: 1,
			fileExtensions: ['.json'],
			schemaSummary: 'A root object with version, kind, and ordered sealed Result node identities.'
		}],
		operations: [{
			id: 'studio.workflow.sequence-inspect',
			command: 'studio.workflow.inspectSequence',
			description: 'Inspect sealed Result identities.',
			deterministic: true,
			parameters: [{ name: 'sequence', type: 'uri', required: true, description: 'Sequence URI.' }],
			returns: { type: 'object', description: 'Per-item state.' }
		}]
	};
}
