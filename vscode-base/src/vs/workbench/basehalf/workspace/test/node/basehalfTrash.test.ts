/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { FileAccess } from '../../../../../base/common/network.js';
import { join, sep } from '../../../../../base/common/path.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../../../platform/files/common/files.js';
import { baseHalfUsesTrash } from '../../common/basehalfTrash.js';

suite('BaseHalf: whether a delete goes to the Trash', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const RESOURCE = URI.file('/workspace/note.md');

	function fileService(hasTrash: boolean): IFileService {
		return new class extends mock<IFileService>() {
			override hasCapability(resource: URI, capability: FileSystemProviderCapabilities): boolean {
				return hasTrash && resource === RESOURCE && capability === FileSystemProviderCapabilities.Trash;
			}
		};
	}

	test('a setting that is not set means the Trash, and only `false` turns it off', () => {
		const withTrash = fileService(true);
		assert.deepStrictEqual({
			notSet: baseHalfUsesTrash(new TestConfigurationService(), withTrash, RESOURCE),
			on: baseHalfUsesTrash(new TestConfigurationService({ files: { enableTrash: true } }), withTrash, RESOURCE),
			off: baseHalfUsesTrash(new TestConfigurationService({ files: { enableTrash: false } }), withTrash, RESOURCE),
			// A disk without a Trash has none to use, whatever the setting says.
			noTrashOnTheDisk: baseHalfUsesTrash(new TestConfigurationService({ files: { enableTrash: true } }), fileService(false), RESOURCE),
			noTrashAndNotSet: baseHalfUsesTrash(new TestConfigurationService(), fileService(false), RESOURCE)
		}, { notSet: true, on: true, off: false, noTrashOnTheDisk: false, noTrashAndNotSet: false });
	});

	test('nothing of BaseHalf reads the setting another way', () => {
		// Five places delete, and one of them once took a setting that is not set as the Trash turned off. The
		// sources are read: each place asks `baseHalfUsesTrash`, and only its module names the setting.
		const repository = join(FileAccess.asFileUri('').fsPath, '..');
		const roots = [
			join(repository, 'src', 'vs', 'workbench', 'basehalf'),
			...readdirSync(join(repository, 'src', 'vs', 'platform'), { encoding: 'utf8' }).filter(name => name.startsWith('basehalf')).map(name => join(repository, 'src', 'vs', 'platform', name))
		];
		const reading: string[] = [];
		const asking: string[] = [];
		for (const root of roots) {
			for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
				const path = entry.split(sep).join('/');
				if (!path.endsWith('.ts') || /(^|\/)test\//.test(path)) {
					continue;
				}
				const source = readFileSync(join(root, entry), 'utf8');
				if (/['"]files\.enableTrash['"]|\.files\??\.enableTrash/.test(source) && !path.endsWith('workspace/common/basehalfTrash.ts')) {
					reading.push(path);
				}
				if (source.includes('baseHalfUsesTrash(') && !path.endsWith('workspace/common/basehalfTrash.ts')) {
					asking.push(path);
				}
			}
		}
		assert.deepStrictEqual({ reading, asking: asking.sort() }, {
			reading: [],
			asking: [
				'markdown/browser/basehalfNoteFileRetention.contribution.ts',
				'mediaEdit/browser/basehalfMediaEditService.ts',
				'upkeep/browser/basehalfKeptVersions.ts',
				'upkeep/browser/basehalfMirrorCascade.contribution.ts',
				'upkeep/common/basehalfLegacyCleanup.ts'
			]
		});
	});
});
