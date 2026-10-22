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
import { IBaseHalfExtensionIdentityDto, IBaseHalfGenerationCardStateDto, MainThreadBaseHalfShape } from '../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('ExtHostBaseHalf', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('inspects a generation card with the host-derived identity and answers its kind, its file, and the id of its made.yaml', async () => {
		let receivedIdentity: IBaseHalfExtensionIdentityDto | undefined;
		const received: string[] = [];
		const proxy = new class extends mock<MainThreadBaseHalfShape>() {
			override $inspectGenerationCard(extensionIdentity: IBaseHalfExtensionIdentityDto, resource: UriComponents): Promise<IBaseHalfGenerationCardStateDto | undefined> {
				receivedIdentity = extensionIdentity;
				const path = URI.revive(resource).path;
				received.push(path);
				return Promise.resolve(path.endsWith('clip.mp4')
					? { kind: 'video', hasFile: true, generationId: '20261019T080000-k3f9' }
					: path.endsWith('draft.mp4') ? { kind: 'video', hasFile: false } : undefined);
			}
		};
		const extHost = disposables.add(new ExtHostBaseHalf(SingleProxyRPCProtocol(proxy), undefined!));

		const generated = await extHost.inspectGenerationCard(extension(), URI.file('/workspace/shots/clip.mp4'));
		const draft = await extHost.inspectGenerationCard(extension(), URI.file('/workspace/shots/draft.mp4'));
		const other = await extHost.inspectGenerationCard(extension(), URI.file('/workspace/notes.md'));

		assert.deepStrictEqual({
			identity: [receivedIdentity?.id.value, receivedIdentity?.version],
			received,
			generated,
			draft,
			other
		}, {
			identity: ['reviewed.workflow', '1.2.3'],
			received: ['/workspace/shots/clip.mp4', '/workspace/shots/draft.mp4', '/workspace/notes.md'],
			generated: { kind: 'video', hasFile: true, generationId: '20261019T080000-k3f9' },
			draft: { kind: 'video', hasFile: false },
			other: undefined
		});
		assert.strictEqual(Object.hasOwn(draft!, 'generationId'), false);
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
			URI.file('/workspace/clip.mp4'),
			CancellationToken.None
		);
		assert.strictEqual(transitions.length, 1);
		assert.strictEqual(transitions[0].expected.toString(), '/workspace/clip.mp4');
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
