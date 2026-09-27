/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { createFileSystemProviderError, FileOperationError, FileOperationResult, FileSystemProviderCapabilities, FileSystemProviderErrorCode, IFileService, IFileStat, IFileStatWithPartialMetadata } from '../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { UriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { BaseHalfCanvasViewportStateService } from '../../common/basehalfCanvasViewportState.js';
import { BASEHALF_LEGACY_AGENT_GUIDE_SECTIONS } from '../../common/basehalfLegacyAgentGuideSections.js';
import {
	BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER,
	BaseHalfAgentGuideFile,
	baseHalfDecodeAgentGuide,
	baseHalfEncodeAgentGuide,
	BaseHalfLegacyCleanupService,
	baseHalfRemoveAgentGuideSections,
	IBaseHalfAgentGuide,
	isBaseHalfAgentGuideBoilerplate,
	parseBaseHalfLegacyFocusDocument
} from '../../common/basehalfLegacyCleanup.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from '../../common/basehalfWorkspaceMutation.js';

const OPEN = '<!-- bh:workspace-hint -->';
const CLOSE = '<!-- /bh:workspace-hint -->';
const INSTRUCTIONS = 'Instructions AI coding agents read when working in this folder.';

/** The section text (marker line to end of file) a given shipped installer wrote. */
function knownSection(commit: string): string {
	const section = BASEHALF_LEGACY_AGENT_GUIDE_SECTIONS.find(candidate => candidate.sources.some(source => source.includes(`@${commit} `)));
	assert.ok(section, `fixture has no section from ${commit}`);
	return `${section.lines.join('\n')}\n`;
}

function removed(text: string, file: BaseHalfAgentGuideFile = 'CLAUDE.md') {
	const result = baseHalfRemoveAgentGuideSections(text, file);
	return result.kind === 'removed' ? { kind: result.kind, text: result.text, boilerplateOnly: result.boilerplateOnly } : result;
}

suite('BaseHalfLegacyCleanup', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	suite('agent guide section removal', () => {
		test('the fixture holds every shipped open-marker-only and recall-hint body', () => {
			// v0.2.0 / v0.2.1 and v0.2.2 / v0.2.3 wrote open-marker-only sections;
			// the first `bh init` wrote the recall hint.
			for (const commit of ['a41326359', 'a0677df3e', 'ad92b728d']) {
				assert.ok(knownSection(commit).startsWith('<!-- bh:'));
			}
			assert.ok(knownSection('ad92b728d').startsWith('<!-- bh:recall-hint -->\n## Using `bh` (BaseHalf)\n'));
		});

		test('removes a closed section, its preceding empty line, and keeps everything else verbatim', () => {
			const text = `# Mine\n\nMy rules.\n\n${OPEN}\n## BaseHalf workspace\n\nanything, even edited\n${CLOSE}\n\n## After\nkept\n`;

			assert.deepStrictEqual(removed(text), {
				kind: 'removed',
				text: '# Mine\n\nMy rules.\n\n## After\nkept\n',
				boilerplateOnly: false
			});
		});

		test('keeps CRLF line endings and every byte outside the section', () => {
			const text = `# Mine\r\n\r\n${OPEN}\r\nbody\r\n${CLOSE}\r\ntail  \r\n`;

			assert.deepStrictEqual(removed(text), { kind: 'removed', text: '# Mine\r\ntail  \r\n', boilerplateOnly: false });
		});

		test('keeps the BOM outside the removed section', () => {
			const original = baseHalfEncodeAgentGuide(true, `# AGENTS.md\n\n${INSTRUCTIONS}\n\n${OPEN}\nbody\n${CLOSE}\n`);
			const decoded = baseHalfDecodeAgentGuide(original);
			assert.ok(decoded);
			const result = baseHalfRemoveAgentGuideSections(decoded.text, 'AGENTS.md');
			assert.strictEqual(result.kind, 'removed');
			const next = baseHalfEncodeAgentGuide(decoded.bom, result.text);

			assert.deepStrictEqual([...next.buffer.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
			assert.strictEqual(next.toString().replace(/^\uFEFF/, ''), `# AGENTS.md\n\n${INSTRUCTIONS}\n`);
			assert.strictEqual(result.boilerplateOnly, true);
		});

		test('refuses bytes that are not UTF-8 text', () => {
			assert.strictEqual(baseHalfDecodeAgentGuide(VSBuffer.wrap(new Uint8Array([0x23, 0x20, 0xFF, 0x0A]))), undefined);
		});

		test('removes every closed section of a file', () => {
			const text = `# Mine\n\n${OPEN}\nfirst\n${CLOSE}\nmiddle\n\n${OPEN}\nsecond\n${CLOSE}`;

			assert.deepStrictEqual(removed(text), { kind: 'removed', text: '# Mine\nmiddle\n', boilerplateOnly: false });
		});

		test('removes a known open-marker-only section to the end of the file and ends with one line break', () => {
			// What v0.2.0 wrote into a fresh folder.
			const text = `# CLAUDE.md\n\n${knownSection('a41326359')}`;

			assert.deepStrictEqual(removed(text), { kind: 'removed', text: '# CLAUDE.md\n', boilerplateOnly: true });
		});

		test('removes a known body whose line endings and trailing whitespace changed, keeping CRLF', () => {
			const section = knownSection('a0677df3e').split('\n').map(line => line ? `${line}  ` : line).join('\r\n');
			const text = `# My own heading\r\n\r\nNotes.\r\n\r\n${section}\r\n\r\n`;

			assert.deepStrictEqual(removed(text), { kind: 'removed', text: '# My own heading\r\n\r\nNotes.\r\n', boilerplateOnly: false });
		});

		test('removes only the known body when other text follows it', () => {
			const text = `# CLAUDE.md\n\n${knownSection('a41326359')}\n## My later notes\nkeep me\n`;

			assert.deepStrictEqual(removed(text), {
				kind: 'removed',
				text: '# CLAUDE.md\n\n\n## My later notes\nkeep me\n',
				boilerplateOnly: false
			});
		});

		test('removes a known recall-hint section', () => {
			// What the first `bh init` wrote into a fresh folder.
			const text = `# CLAUDE.md\n\n${knownSection('ad92b728d')}`;

			assert.deepStrictEqual(removed(text), { kind: 'removed', text: '# CLAUDE.md\n', boilerplateOnly: true });
		});

		test('leaves the file unchanged when an open-marker-only section is not a known body', () => {
			assert.deepStrictEqual(removed(`# Mine\n\n${OPEN}\n## BaseHalf workspace\nhand-edited text\n`), { kind: 'unrecognized', lineNumber: 3 });
			assert.deepStrictEqual(removed(`# Mine\nsee ${OPEN} here\n`), { kind: 'unrecognized', lineNumber: 2 });
			assert.deepStrictEqual(removed('# Mine\n\nNothing from BaseHalf.\n'), { kind: 'none' });
		});

		test('moves only files whose remainder is a BaseHalf-created base to the trash', () => {
			assert.deepStrictEqual({
				claudeBase: isBaseHalfAgentGuideBoilerplate('# CLAUDE.md\n', 'CLAUDE.md'),
				claudeWithLine: isBaseHalfAgentGuideBoilerplate(`# CLAUDE.md\r\n\r\n${INSTRUCTIONS}  \r\n\r\n`, 'CLAUDE.md'),
				agentsWithLine: isBaseHalfAgentGuideBoilerplate(`\uFEFF# AGENTS.md\n\n${INSTRUCTIONS}\n`, 'AGENTS.md'),
				copilot: isBaseHalfAgentGuideBoilerplate('# Copilot instructions\n', '.github/copilot-instructions.md'),
				wrongFile: isBaseHalfAgentGuideBoilerplate('# AGENTS.md\n', 'CLAUDE.md'),
				extraLine: isBaseHalfAgentGuideBoilerplate('# CLAUDE.md\n\nMy own rule.\n', 'CLAUDE.md'),
				empty: isBaseHalfAgentGuideBoilerplate('', 'CLAUDE.md')
			}, {
				claudeBase: true,
				claudeWithLine: true,
				agentsWithLine: true,
				copilot: true,
				wrongFile: false,
				extraLine: false,
				empty: false
			});
		});
	});

	suite('legacy focus documents', () => {
		test('parses folder and file focus documents and rejects anything else', () => {
			assert.deepStrictEqual({
				folder: parseBaseHalfLegacyFocusDocument('path: "notes"\nkind: folder\nviewport_center:\n  x: -12.5\n  y: 40\nzoom: 1.25\n'),
				folderWithoutViewport: parseBaseHalfLegacyFocusDocument('path: ""\nkind: folder\nzoom: 0\n'),
				file: parseBaseHalfLegacyFocusDocument('path: "a.md"\nkind: file\nprojection: rich\ncursor:\n  line: 3\n  column: 1\n'),
				userKeys: parseBaseHalfLegacyFocusDocument('path: "a.md"\nkind: file\ntodo: mine\n'),
				noKind: parseBaseHalfLegacyFocusDocument('path: "a.md"\n'),
				otherKind: parseBaseHalfLegacyFocusDocument('path: "a.md"\nkind: note\n'),
				notYaml: parseBaseHalfLegacyFocusDocument('# just notes\n')
			}, {
				folder: { path: 'notes', kind: 'folder', viewport: { x: -12.5, y: 40, zoom: 1.25 } },
				folderWithoutViewport: { path: '', kind: 'folder' },
				file: { path: 'a.md', kind: 'file' },
				userKeys: undefined,
				noKind: undefined,
				otherKind: undefined,
				notYaml: undefined
			});
		});
	});

	suite('service', () => {
		const workspace = URI.file('/work');

		function createService(initial: Record<string, TestEntry> = {}, options: { readonly trash?: boolean; readonly dirty?: readonly string[] } = {}) {
			const fs = new TestFileSystem(initial, options.trash ?? true);
			const fakeFileService = {
				onDidChangeFileSystemProviderRegistrations: Event.None,
				onDidChangeFileSystemProviderCapabilities: Event.None,
				hasProvider: () => true,
				hasCapability: () => true
			} as Partial<IFileService> as IFileService;
			const storage = disposables.add(new InMemoryStorageService());
			const viewportState = disposables.add(new BaseHalfCanvasViewportStateService(storage, disposables.add(new UriIdentityService(fakeFileService))));
			const leases: string[] = [];
			const coordinator = {
				runExclusive: async <T>(folder: URI, task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>) => {
					leases.push(folder.path);
					return task({ workspaceKeys: [folder.toString()], release: () => { } });
				}
			} as Partial<IBaseHalfWorkspaceMutationCoordinator> as IBaseHalfWorkspaceMutationCoordinator;
			const dirty = new Set(options.dirty ?? []);
			const workingCopyService = { isDirty: (resource: URI) => dirty.has(resource.path) } as Partial<IWorkingCopyService> as IWorkingCopyService;
			const configurationService = { getValue: () => undefined } as Partial<IConfigurationService> as IConfigurationService;
			const service = new BaseHalfLegacyCleanupService(fs as unknown as IFileService, new NullLogService(), coordinator, viewportState, workingCopyService, configurationService);
			return { service, fs, viewportState, leases };
		}

		const file = (content: string): TestEntry => ({ kind: 'file', content });
		const link = (target: string): TestEntry => ({ kind: 'link', target });
		const dir: TestEntry = { kind: 'dir' };
		const sentinel = '<!-- bh:agent-harness managed — regenerated on BaseHalf update; edits are overwritten -->\n\n# Doc\n';

		test('a fresh folder gets no .bh/ and no change to root files', async () => {
			const claude = '# My project\n';
			const gitignore = 'node_modules/\n';
			const { service, fs } = createService({ '/work/CLAUDE.md': file(claude), '/work/.gitignore': file(gitignore) });

			const report = await service.cleanWorkspaceFolder(workspace);
			const scan = await service.findAgentGuides(workspace);

			assert.deepStrictEqual({ report, guides: scan.guides, mutations: fs.mutations, bh: fs.paths().filter(path => path.startsWith('/work/.bh')) }, {
				report: { importedViewports: 0, removedFiles: [], removedDirectories: [], kept: [], failed: [] },
				guides: [],
				mutations: [],
				bh: []
			});
			assert.deepStrictEqual([fs.text('/work/CLAUDE.md'), fs.text('/work/.gitignore'), fs.has('/work/AGENTS.md')], [claude, gitignore, false]);
		});

		test('a marked folder is never changed', async () => {
			const legacy: Record<string, TestEntry> = {
				[`/work/${BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER}`]: file(''),
				'/work/CLAUDE.md': file(`# Dev\n\n${OPEN}\nbody\n${CLOSE}\n`),
				'/work/.bh/current_focus.yaml': link('mirror/focus.yaml'),
				'/work/.bh/mirror/focus.yaml': file('path: ""\nkind: folder\nviewport_center:\n  x: 1\n  y: 2\nzoom: 1\n'),
				'/work/.bh/agent-harness/index.md': file(sentinel)
			};
			const { service, fs, viewportState, leases } = createService(legacy);

			const report = await service.cleanWorkspaceFolder(workspace);
			const scan = await service.findAgentGuides(workspace);
			const removal = await service.removeAgentGuideSections([guide('CLAUDE.md')]);

			assert.deepStrictEqual({
				report,
				scan,
				skipped: removal.skipped.map(item => item.reason),
				mutations: fs.mutations,
				leases,
				viewport: viewportState.get(workspace)
			}, {
				report: { skipped: 'marker', importedViewports: 0, removedFiles: [], removedDirectories: [], kept: [], failed: [] },
				scan: { skipped: 'marker', guides: [] },
				skipped: ['marker'],
				mutations: [],
				leases: [],
				viewport: undefined
			});
		});

		test('imports legacy folder viewports, then removes focus files, the focus link, and sentinel harness files under the lease', async () => {
			const { service, fs, viewportState, leases } = createService({
				'/work/.bh/current_focus.yaml': link('mirror/notes/focus.yaml'),
				'/work/.bh/current_focus.yaml.123.456.abc.tmp': link('mirror/focus.yaml'),
				'/work/.bh/mirror/focus.yaml': file('path: ""\nkind: folder\nviewport_center:\n  x: 10\n  y: 20\nzoom: 0.5\n'),
				'/work/.bh/mirror/badge.yaml': file('description: root\n'),
				'/work/.bh/mirror/notes/focus.yaml': file('path: "notes"\nkind: folder\nviewport_center:\n  x: -3\n  y: 4\nzoom: 2\n'),
				'/work/.bh/mirror/notes/a.md/focus.yaml': file('path: "notes/a.md"\nkind: file\ncursor:\n  line: 1\n  column: 1\n'),
				'/work/.bh/mirror/notes/a.md/adhd.yaml': file('highlight_keywords: []\n'),
				'/work/.bh/mirror/notes/b.md/focus.yaml': file('path: "notes/b.md"\nkind: file\n'),
				'/work/.bh/mirror/x/focus.yaml/badge.yaml': file('description: a user file named focus.yaml\n'),
				'/work/.bh/mirror/untouched-empty': dir,
				'/work/.bh/agent-harness/index.md': file(sentinel),
				'/work/.bh/agent-harness/scenarios/canvas-workflows.md': file(sentinel),
				'/work/.bh/agent-harness/scenarios/focus-coordinates.md': file(sentinel),
				'/work/.bh/agent-harness/my-notes.md': file('mine\n'),
				'/work/.bh/cache/lease.json': file('{}')
			});

			const report = await service.cleanWorkspaceFolder(workspace);

			assert.deepStrictEqual({
				imported: report.importedViewports,
				removedFiles: [...report.removedFiles].sort(),
				removedDirectories: report.removedDirectories,
				kept: report.kept,
				failed: report.failed,
				leases,
				rootViewport: viewportState.get(workspace),
				notesViewport: viewportState.get(URI.file('/work/notes')),
				remaining: fs.paths().filter(path => path.startsWith('/work/.bh'))
			}, {
				imported: 2,
				removedFiles: [
					'.bh/agent-harness/index.md',
					'.bh/agent-harness/scenarios/canvas-workflows.md',
					'.bh/agent-harness/scenarios/focus-coordinates.md',
					'.bh/current_focus.yaml',
					'.bh/current_focus.yaml.123.456.abc.tmp',
					'.bh/mirror/focus.yaml',
					'.bh/mirror/notes/a.md/focus.yaml',
					'.bh/mirror/notes/b.md/focus.yaml',
					'.bh/mirror/notes/focus.yaml'
				],
				removedDirectories: ['.bh/agent-harness/scenarios', '.bh/mirror/notes/b.md'],
				kept: [],
				failed: [],
				leases: ['/work'],
				rootViewport: { x: 10, y: 20, zoom: 0.5, source: 'import' },
				notesViewport: { x: -3, y: 4, zoom: 2, source: 'import' },
				remaining: [
					'/work/.bh',
					'/work/.bh/agent-harness',
					'/work/.bh/agent-harness/my-notes.md',
					'/work/.bh/cache',
					'/work/.bh/cache/lease.json',
					'/work/.bh/mirror',
					'/work/.bh/mirror/badge.yaml',
					'/work/.bh/mirror/notes',
					'/work/.bh/mirror/notes/a.md',
					'/work/.bh/mirror/notes/a.md/adhd.yaml',
					'/work/.bh/mirror/untouched-empty',
					'/work/.bh/mirror/x',
					'/work/.bh/mirror/x/focus.yaml',
					'/work/.bh/mirror/x/focus.yaml/badge.yaml'
				]
			});

			// Idempotent: a second open finds nothing left to do.
			const again = await service.cleanWorkspaceFolder(workspace);
			assert.deepStrictEqual([again.removedFiles, again.removedDirectories], [[], []]);
		});

		test('deletes a regular current_focus.yaml only when it is a focus document', async () => {
			const parsed = createService({ '/work/.bh/current_focus.yaml': file('path: "a.md"\nkind: file\n') });
			const foreign = createService({ '/work/.bh/current_focus.yaml': file('my: own\n') });

			const parsedReport = await parsed.service.cleanWorkspaceFolder(workspace);
			const foreignReport = await foreign.service.cleanWorkspaceFolder(workspace);

			assert.deepStrictEqual({
				parsed: parsedReport.removedFiles,
				foreign: foreignReport.removedFiles,
				foreignKept: foreignReport.kept.map(item => item.path),
				foreignStillThere: foreign.fs.text('/work/.bh/current_focus.yaml')
			}, {
				parsed: ['.bh/current_focus.yaml'],
				foreign: [],
				foreignKept: ['.bh/current_focus.yaml'],
				foreignStillThere: 'my: own\n'
			});
		});

		test('skips a folder whose .bh is a symbolic link', async () => {
			const { service, fs } = createService({ '/work/.bh': link('/elsewhere'), '/elsewhere/current_focus.yaml': link('x') });

			const report = await service.cleanWorkspaceFolder(workspace);

			assert.deepStrictEqual([report.skipped, fs.mutations], ['symbolicLink', []]);
		});

		test('a failure on one item does not stop later items', async () => {
			const { service, fs } = createService({
				'/work/.bh/mirror/a/focus.yaml': file('path: "a"\nkind: file\n'),
				'/work/.bh/mirror/b/focus.yaml': file('path: "b"\nkind: file\n')
			});
			fs.failDeletes.add('/work/.bh/mirror/a/focus.yaml');

			const report = await service.cleanWorkspaceFolder(workspace);

			assert.deepStrictEqual({ removed: report.removedFiles, failed: report.failed.map(item => item.path) }, {
				removed: ['.bh/mirror/b/focus.yaml'],
				failed: ['.bh/mirror/a/focus.yaml']
			});
		});

		function guide(file: BaseHalfAgentGuideFile, moveToTrash = false): IBaseHalfAgentGuide {
			return {
				workspaceFolder: workspace,
				resource: URI.joinPath(workspace, ...file.split('/')),
				file,
				selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
				moveToTrash
			};
		}

		test('finds only files with a BaseHalf section and tells which would go to the trash', async () => {
			const { service } = createService({
				'/work/CLAUDE.md': file(`# CLAUDE.md\n\n${INSTRUCTIONS}\n\n${OPEN}\nbody\n${CLOSE}\n`),
				'/work/AGENTS.md': file('# Mine\n\nno section\n'),
				'/work/.github/copilot-instructions.md': file(`# Copilot instructions\n\n${knownSection('a41326359')}`)
			});

			const scan = await service.findAgentGuides(workspace);
			const copilotLines = knownSection('a41326359').split('\n');
			while (copilotLines[copilotLines.length - 1] === '') {
				copilotLines.pop();
			}

			assert.deepStrictEqual(scan.guides.map(item => ({ file: item.file, moveToTrash: item.moveToTrash, selection: item.selection })), [
				{ file: 'CLAUDE.md', moveToTrash: true, selection: { startLineNumber: 5, startColumn: 1, endLineNumber: 7, endColumn: CLOSE.length + 1 } },
				{ file: '.github/copilot-instructions.md', moveToTrash: true, selection: { startLineNumber: 3, startColumn: 1, endLineNumber: 3 + copilotLines.length - 1, endColumn: copilotLines[copilotLines.length - 1].length + 1 } }
			]);
		});

		test('removes sections with conditional writes and moves boilerplate-only files to the trash', async () => {
			const agents = `# Mine\r\n\r\n${OPEN}\r\nbody\r\n${CLOSE}\r\n\r\nAfter.\r\n`;
			const { service, fs } = createService({
				'/work/CLAUDE.md': file(`# CLAUDE.md\n\n${INSTRUCTIONS}\n\n${OPEN}\nbody\n${CLOSE}\n`),
				'/work/AGENTS.md': file(agents)
			});

			const report = await service.removeAgentGuideSections([guide('CLAUDE.md', true), guide('AGENTS.md')]);

			assert.deepStrictEqual({
				removed: report.removed.map(item => item.file),
				trashed: report.trashed.map(item => item.file),
				skipped: report.skipped,
				notTrashed: report.notTrashed,
				trashedPaths: fs.trashed,
				claudeExists: fs.has('/work/CLAUDE.md'),
				agents: fs.text('/work/AGENTS.md'),
				conditionalWrites: fs.mutations.filter(mutation => mutation.startsWith('write'))
			}, {
				removed: ['CLAUDE.md', 'AGENTS.md'],
				trashed: ['CLAUDE.md'],
				skipped: [],
				notTrashed: [],
				trashedPaths: ['/work/CLAUDE.md'],
				claudeExists: false,
				agents: '# Mine\r\n\r\nAfter.\r\n',
				conditionalWrites: ['write-expected /work/CLAUDE.md', 'write-expected /work/AGENTS.md']
			});
		});

		test('keeps a boilerplate-only file with its base text when the trash is unavailable', async () => {
			const { service, fs } = createService({ '/work/CLAUDE.md': file(`# CLAUDE.md\n\n${OPEN}\nbody\n${CLOSE}\n`) }, { trash: false });

			const report = await service.removeAgentGuideSections([guide('CLAUDE.md', true)]);

			assert.deepStrictEqual({
				removed: report.removed.length,
				trashed: report.trashed.length,
				notTrashed: report.notTrashed.map(item => item.reason),
				text: fs.text('/work/CLAUDE.md'),
				permanentDeletes: fs.mutations.filter(mutation => mutation.startsWith('delete'))
			}, {
				removed: 1,
				trashed: 0,
				notTrashed: ['trashUnavailable'],
				text: '# CLAUDE.md\n',
				permanentDeletes: []
			});
		});

		test('never writes through a symbolically linked .github directory', async () => {
			const section = `# Copilot instructions\n\n${OPEN}\nbody\n${CLOSE}\n`;
			const { service, fs } = createService({
				'/work/.github': link('/elsewhere/gh'),
				'/elsewhere/gh/copilot-instructions.md': file(section)
			});

			const report = await service.removeAgentGuideSections([guide('.github/copilot-instructions.md')]);

			assert.deepStrictEqual([report.skipped.map(item => item.reason), fs.text('/elsewhere/gh/copilot-instructions.md'), fs.mutations], [['symbolicLink'], section, []]);
		});

		test('skips and reports dirty, symbolically linked, concurrently changed, and unrecognized files', async () => {
			const section = `# Mine\n\n${OPEN}\nbody\n${CLOSE}\n`;
			const { service, fs } = createService({
				'/work/CLAUDE.md': file(section),
				'/work/AGENTS.md': link('/elsewhere/AGENTS.md'),
				'/elsewhere/AGENTS.md': file(section),
				'/work/.github/copilot-instructions.md': file(section)
			}, { dirty: ['/work/CLAUDE.md'] });
			fs.changeBeforeWrite.set('/work/.github/copilot-instructions.md', `${section}\nconcurrent agent edit\n`);

			const report = await service.removeAgentGuideSections([guide('CLAUDE.md'), guide('AGENTS.md'), guide('.github/copilot-instructions.md')]);

			const unrecognized = createService({ '/work/CLAUDE.md': file(`# Mine\n\n${OPEN}\nhand-written\n`) });
			const unrecognizedReport = await unrecognized.service.removeAgentGuideSections([guide('CLAUDE.md')]);

			assert.deepStrictEqual({
				removed: report.removed.length,
				skipped: report.skipped.map(item => [item.guide.file, item.reason]),
				unchanged: [fs.text('/work/CLAUDE.md'), fs.text('/elsewhere/AGENTS.md'), fs.text('/work/.github/copilot-instructions.md')],
				unrecognized: unrecognizedReport.skipped.map(item => item.reason),
				unrecognizedText: unrecognized.fs.text('/work/CLAUDE.md')
			}, {
				removed: 0,
				skipped: [['CLAUDE.md', 'dirty'], ['AGENTS.md', 'symbolicLink'], ['.github/copilot-instructions.md', 'changed']],
				unchanged: [section, section, `${section}\nconcurrent agent edit\n`],
				unrecognized: ['unrecognized'],
				unrecognizedText: `# Mine\n\n${OPEN}\nhand-written\n`
			});
		});
	});
});

type TestEntry =
	| { readonly kind: 'file'; content: string; mtime?: number }
	| { readonly kind: 'dir' }
	| { readonly kind: 'link'; readonly target: string };

/**
 * A minimal path-addressed file system with symbolic links, for the cleanup
 * service. Links resolve like the disk provider's `stat`: a link reports
 * `isSymbolicLink` plus its target's kind; a dangling link is neither file nor
 * directory.
 */
class TestFileSystem {
	private readonly entries = new Map<string, TestEntry>();
	readonly mutations: string[] = [];
	readonly trashed: string[] = [];
	readonly failDeletes = new Set<string>();
	readonly changeBeforeWrite = new Map<string, string>();
	private clock = 1;

	constructor(initial: Record<string, TestEntry>, private readonly trash: boolean) {
		for (const [path, entry] of Object.entries(initial)) {
			this.entries.set(path, entry.kind === 'file' ? { ...entry, mtime: this.clock++ } : entry);
			for (let parent = path.slice(0, path.lastIndexOf('/')); parent && parent !== '/'; parent = parent.slice(0, parent.lastIndexOf('/'))) {
				if (!this.entries.has(parent)) {
					this.entries.set(parent, { kind: 'dir' });
				}
			}
		}
	}

	paths(): string[] {
		return [...this.entries.keys()].sort();
	}

	has(path: string): boolean {
		return this.entries.has(path);
	}

	text(path: string): string | undefined {
		const entry = this.entries.get(path);
		return entry?.kind === 'file' ? entry.content : undefined;
	}

	hasCapability(_resource: URI, capability: FileSystemProviderCapabilities): boolean {
		return capability === FileSystemProviderCapabilities.Trash ? this.trash : true;
	}

	async exists(resource: URI): Promise<boolean> {
		return this.entries.has(resource.path);
	}

	async stat(resource: URI): Promise<IFileStatWithPartialMetadata> {
		return this.toStat(resource);
	}

	async resolve(resource: URI): Promise<IFileStat> {
		const stat = this.toStat(resource);
		const directory = this.followedPath(resource.path);
		if (!stat.isDirectory || directory === undefined) {
			return { ...stat, children: undefined };
		}
		const prefix = `${directory}/`;
		const children: IFileStat[] = [...this.entries.keys()]
			.filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
			.map(path => ({ ...this.toStat(URI.joinPath(resource, path.slice(prefix.length))), children: undefined }));
		return { ...stat, children };
	}

	async readFile(resource: URI, options?: { readonly length?: number }): Promise<{ value: VSBuffer }> {
		const path = this.followedPath(resource.path);
		const entry = path === undefined ? undefined : this.entries.get(path);
		if (!entry || entry.kind !== 'file') {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		const value = VSBuffer.fromString(entry.content);
		return { value: options?.length !== undefined ? value.slice(0, options.length) : value };
	}

	async writeFileWithExpectedContents(resource: URI, contents: VSBuffer, expected: VSBuffer | null): Promise<void> {
		const concurrent = this.changeBeforeWrite.get(resource.path);
		if (concurrent !== undefined) {
			this.entries.set(resource.path, { kind: 'file', content: concurrent, mtime: this.clock++ });
		}
		const entry = this.entries.get(resource.path);
		const current = entry?.kind === 'file' ? VSBuffer.fromString(entry.content) : null;
		if (expected === null ? current !== null : current === null || !current.equals(expected)) {
			throw new FileOperationError('modified', FileOperationResult.FILE_MODIFIED_SINCE);
		}
		this.mutations.push(`write-expected ${resource.path}`);
		this.entries.set(resource.path, { kind: 'file', content: contents.toString(), mtime: this.clock++ });
	}

	async del(resource: URI, options?: { readonly useTrash?: boolean; readonly recursive?: boolean }): Promise<void> {
		const path = resource.path;
		const entry = this.entries.get(path);
		if (!entry) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		if (this.failDeletes.has(path)) {
			throw new Error('locked');
		}
		if (entry.kind === 'dir' && [...this.entries.keys()].some(candidate => candidate.startsWith(`${path}/`))) {
			throw new Error('Unable to delete non-empty folder');
		}
		assert.strictEqual(options?.recursive ?? false, false, 'cleanup deletes are never recursive');
		if (options?.useTrash) {
			assert.ok(this.trash, 'trash requested without trash support');
			this.trashed.push(path);
		} else {
			this.mutations.push(`delete ${path}`);
		}
		this.entries.delete(path);
	}

	private toStat(resource: URI): IFileStatWithPartialMetadata {
		const entry = this.entries.get(resource.path);
		if (!entry) {
			throw createFileSystemProviderError('missing', FileSystemProviderErrorCode.FileNotFound);
		}
		const followed = this.followedPath(resource.path);
		const target = followed === undefined ? undefined : this.entries.get(followed);
		const mtime = target?.kind === 'file' ? target.mtime ?? 0 : 0;
		return {
			resource,
			name: basename(resource),
			isFile: target?.kind === 'file',
			isDirectory: target?.kind === 'dir',
			isSymbolicLink: entry.kind === 'link',
			mtime,
			ctime: mtime,
			size: target?.kind === 'file' ? target.content.length : 0,
			etag: String(mtime),
			readonly: false,
			locked: false,
			executable: false
		};
	}

	/** The path a link chain ends at, or undefined when it dangles. */
	private followedPath(path: string): string | undefined {
		let current = path;
		for (let hops = 0; hops < 8; hops++) {
			const entry = this.entries.get(current);
			if (!entry) {
				return undefined;
			}
			if (entry.kind !== 'link') {
				return current;
			}
			current = entry.target.startsWith('/') ? entry.target : `${dirname(URI.file(current)).path}/${entry.target}`;
		}
		return undefined;
	}
}
