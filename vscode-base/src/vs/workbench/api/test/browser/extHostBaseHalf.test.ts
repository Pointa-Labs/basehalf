/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ExtensionIdentifier, IExtensionDescription, TargetPlatform } from '../../../../platform/extensions/common/extensions.js';
import { ExtHostBaseHalf } from '../../common/extHostBaseHalf.js';
import { IBaseHalfCanvasNodeStateDto, IBaseHalfExtensionIdentityDto, MainThreadBaseHalfShape } from '../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('ExtHostBaseHalf', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('revives an inspected Video node with its video, sends the host-derived identity, and lists no attempts', async () => {
		let receivedIdentity: IBaseHalfExtensionIdentityDto | undefined;
		let receivedResource: URI | undefined;
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $inspectCanvasNode(extensionIdentity: IBaseHalfExtensionIdentityDto, resource: UriComponents): Promise<IBaseHalfCanvasNodeStateDto> {
				receivedIdentity = extensionIdentity;
				receivedResource = URI.revive(resource);
				return Promise.resolve({
					id: 'clip-node',
					kind: 'video',
					lifecycle: 'result',
					result: {
						source: 'attempt',
						attemptId: 'run-2',
						artifact: {
							id: 'clip',
							outputId: 'video',
							kind: 'video',
							resource: URI.file('/workspace/outputs/clip.mp4'),
							integrity: 'available'
						}
					},
					attempts: []
				});
			}
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));

		const state = await extHost.inspectCanvasNode(extension(), URI.file('/workspace/clip.bhnode'));

		assert.strictEqual(receivedIdentity?.id.value, 'reviewed.workflow');
		assert.strictEqual(receivedIdentity?.version, '1.2.3');
		assert.strictEqual(receivedResource?.path, '/workspace/clip.bhnode');
		assert.strictEqual(state?.id, 'clip-node');
		assert.strictEqual(state?.lifecycle, 'result');
		assert.strictEqual(state?.result?.artifact.resource.path, '/workspace/outputs/clip.mp4');
		assert.strictEqual(state?.result?.artifact.integrity, 'available');
		assert.strictEqual(state?.result?.source, 'attempt');
		assert.deepStrictEqual(state?.attempts, []);
	});

	test('registers one structural cleanup provider and serializes exact transitions', async () => {
		let registered: IBaseHalfExtensionIdentityDto | undefined;
		let unregistered: string | undefined;
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $registerCanvasStructuralCleanupProvider(identity: IBaseHalfExtensionIdentityDto): void { registered = identity; }
			override $unregisterCanvasStructuralCleanupProvider(extensionId: string): void { unregistered = extensionId; }
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));
		const registration = extHost.registerCanvasStructuralCleanupProvider(extension(), {
			prepareDelete: resource => [{
				resource: URI.file('/workspace/sequence.json'),
				expected: new TextEncoder().encode(resource.path),
				next: new TextEncoder().encode('next'),
				label: 'Remove membership'
			}]
		});
		assert.strictEqual(registered?.id.value, 'reviewed.workflow');
		const transitions = await extHost.$prepareCanvasStructuralCleanup(
			'reviewed.workflow',
			URI.file('/workspace/clip.bhnode'),
			CancellationToken.None
		);
		assert.strictEqual(transitions.length, 1);
		assert.strictEqual(transitions[0].expected.toString(), '/workspace/clip.bhnode');
		assert.strictEqual(transitions[0].next.toString(), 'next');
		registration.dispose();
		assert.strictEqual(unregistered, 'reviewed.workflow');
	});
});

function extension(): IExtensionDescription {
	return {
		name: 'workflow',
		publisher: 'reviewed',
		version: '1.2.3',
		engines: { vscode: '*' },
		identifier: new ExtensionIdentifier('reviewed.workflow'),
		targetPlatform: TargetPlatform.UNDEFINED,
		extensionLocation: URI.file('/extensions/reviewed-workflow'),
		isBuiltin: false,
		isUserBuiltin: false,
		isUnderDevelopment: false,
		preRelease: false,
		contributes: {
			basehalfCanvasTemplates: [{ id: 'reviewed.workflow.starter', label: 'Starter', resource: 'templates/starter.json' }]
		} as IExtensionDescription['contributes']
	};
}
