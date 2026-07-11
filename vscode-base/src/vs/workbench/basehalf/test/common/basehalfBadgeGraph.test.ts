/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { BaseHalfBadgeGraphService } from '../../common/basehalfBadgeGraph.js';
import { BaseHalfBadgeKind, BaseHalfBadgeMirrorService, IBaseHalfBadgeNode } from '../../common/basehalfBadgeMirror.js';
import { baseHalfCanvasBadgeRelationships } from '../../common/basehalfCanvasModel.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';

suite('BaseHalfBadgeGraphService', () => {
	const workspaceFolder = URI.file('/work');

	function node(relativePath: string, kind: BaseHalfBadgeKind = 'file'): IBaseHalfBadgeNode {
		return {
			resource: relativePath ? URI.joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath,
			kind
		};
	}

	function badgeYaml(path: string, fields?: { kind?: string; description?: string; references?: string[]; referenced_by?: string[]; orphan?: boolean }): string {
		const lines = [`path: ${JSON.stringify(path)}`, `kind: ${fields?.kind ?? 'file'}`];
		if (fields?.description) {
			lines.push(`description: ${JSON.stringify(fields.description)}`);
		}
		lines.push(fields?.references?.length ? `references:\n${fields.references.map(r => `  - ${JSON.stringify(r)}`).join('\n')}` : 'references: []');
		lines.push(fields?.referenced_by?.length ? `referenced_by:\n${fields.referenced_by.map(r => `  - ${JSON.stringify(r)}`).join('\n')}` : 'referenced_by: []');
		if (fields?.orphan) {
			lines.push('orphan: true');
		}
		lines.push('');
		return lines.join('\n');
	}

	function badgePath(rel: string): string {
		return `/work/.bh/mirror/${rel}/badge.yaml`;
	}

	function createServices(initial?: Record<string, string>, options?: { readonly caseInsensitive?: boolean }): { graph: BaseHalfBadgeGraphService; fs: TestFileSystem } {
		const fs = new TestFileSystem(initial, options);
		const mirror = new BaseHalfBadgeMirrorService(fs as unknown as IFileService);
		const graph = new BaseHalfBadgeGraphService(mirror, fs as unknown as IFileService, new BaseHalfWorkspaceMutationCoordinator());
		return { graph, fs };
	}

	test('addReference records both directions, materializing a stub target badge', async () => {
		const { graph, fs } = createServices();

		await graph.addReference(node('a.md'), node('b.md'));

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { references: ['b.md'] }));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { referenced_by: ['a.md'] }));
	});

	test('addReference rejects a self-reference', async () => {
		const { graph } = createServices();

		assert.throws(() => graph.addReference(node('a.md'), node('a.md')));
	});

	test('supports cycles and many-to-many context flow while keeping duplicate adds idempotent', async () => {
		const { graph, fs } = createServices();

		await graph.addReference(node('a.md'), node('b.md'));
		await graph.addReference(node('a.md'), node('c.md'));
		await graph.addReference(node('d.md'), node('b.md'));
		await graph.addReference(node('b.md'), node('a.md'));
		await graph.addReference(node('a.md'), node('b.md'));

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { references: ['b.md', 'c.md'], referenced_by: ['b.md'] }));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { references: ['a.md'], referenced_by: ['a.md', 'd.md'] }));
		assert.strictEqual(fs.files.get(badgePath('c.md')), badgeYaml('c.md', { referenced_by: ['a.md'] }));
		assert.strictEqual(fs.files.get(badgePath('d.md')), badgeYaml('d.md', { references: ['b.md'] }));
	});

	test('repairIncompleteReference repairs either half and ignores a stale absent issue', async () => {
		const sourceOnly = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'A', references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'B' })
		});

		assert.strictEqual(await sourceOnly.graph.repairIncompleteReference(node('a.md'), node('b.md')), true);
		assert.strictEqual(await sourceOnly.graph.repairIncompleteReference(node('a.md'), node('b.md')), false);
		assert.strictEqual(sourceOnly.fs.files.get(badgePath('a.md')), badgeYaml('a.md', { description: 'A', references: ['b.md'] }));
		assert.strictEqual(sourceOnly.fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'B', referenced_by: ['a.md'] }));

		const targetOnly = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'A' }),
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'B', referenced_by: ['a.md'] })
		});

		assert.strictEqual(await targetOnly.graph.repairIncompleteReference(node('a.md'), node('b.md')), true);
		assert.strictEqual(await targetOnly.graph.repairIncompleteReference(node('a.md'), node('b.md')), false);
		assert.strictEqual(targetOnly.fs.files.get(badgePath('a.md')), badgeYaml('a.md', { description: 'A', references: ['b.md'] }));
		assert.strictEqual(targetOnly.fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'B', referenced_by: ['a.md'] }));

		const absent = createServices();
		assert.strictEqual(await absent.graph.repairIncompleteReference(node('a.md'), node('b.md')), false);
		assert.strictEqual(absent.fs.files.size, 0);
	});

	test('addReference restores the source when writing the target backlink fails', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'A' })
		});
		fs.failNextWriteAt(badgePath('b.md'));

		await assert.rejects(() => graph.addReference(node('a.md'), node('b.md')));

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { description: 'A' }));
		assert.strictEqual(fs.files.has(badgePath('b.md')), false);
	});

	test('removeReference scrubs both directions and retires emptied stubs', async () => {
		const { graph, fs } = createServices();
		await graph.addReference(node('a.md'), node('b.md'));

		assert.strictEqual(await graph.removeReference(node('a.md'), node('b.md')), true);

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md'));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md'));
	});

	test('removeReference reports a stale canonical edge instead of a silent no-op', async () => {
		const { graph } = createServices();

		assert.strictEqual(await graph.removeReference(node('a.md'), node('b.md')), false);
	});

	test('removeReference keeps badges that still carry authored content', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Alpha', references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] })
		});

		await graph.removeReference(node('a.md'), node('b.md'));

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { description: 'Alpha' }));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md'));
	});

	test('discardIncompleteReference removes either half idempotently', async () => {
		const sourceOnly = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'A', references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'B' })
		});

		assert.strictEqual(await sourceOnly.graph.discardIncompleteReference(node('a.md'), node('b.md')), true);
		assert.strictEqual(await sourceOnly.graph.discardIncompleteReference(node('a.md'), node('b.md')), false);
		assert.strictEqual(sourceOnly.fs.files.get(badgePath('a.md')), badgeYaml('a.md', { description: 'A' }));
		assert.strictEqual(sourceOnly.fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'B' }));

		const targetOnly = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'A' }),
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'B', referenced_by: ['a.md'] })
		});

		assert.strictEqual(await targetOnly.graph.discardIncompleteReference(node('a.md'), node('b.md')), true);
		assert.strictEqual(await targetOnly.graph.discardIncompleteReference(node('a.md'), node('b.md')), false);
		assert.strictEqual(targetOnly.fs.files.get(badgePath('a.md')), badgeYaml('a.md', { description: 'A' }));
		assert.strictEqual(targetOnly.fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'B' }));
	});

	test('discardIncompleteReference does not delete a relation completed after issue render', async () => {
		const source = badgeYaml('a.md', { description: 'A', references: ['b.md'] });
		const target = badgeYaml('b.md', { description: 'B', referenced_by: ['a.md'] });
		const { graph, fs } = createServices({
			[badgePath('a.md')]: source,
			[badgePath('b.md')]: target
		});

		assert.strictEqual(await graph.discardIncompleteReference(node('a.md'), node('b.md')), false);
		assert.strictEqual(fs.files.get(badgePath('a.md')), source);
		assert.strictEqual(fs.files.get(badgePath('b.md')), target);
	});

	test('reconnectReference replaces both graph directions as one transaction', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'A', references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C' })
		});

		assert.strictEqual(await graph.reconnectReference(node('a.md'), node('b.md'), node('a.md'), node('c.md')), 'replaced');

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { description: 'A', references: ['c.md'] }));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md'));
		assert.strictEqual(fs.files.get(badgePath('c.md')), badgeYaml('c.md', { description: 'C', referenced_by: ['a.md'] }));
	});

	test('reconnectReference repairs a source-only destination while replacing the previous pair', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['b.md', 'c.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C' })
		});

		assert.strictEqual(await graph.reconnectReference(node('a.md'), node('b.md'), node('a.md'), node('c.md')), 'replaced');
		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { references: ['c.md'] }));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md'));
		assert.strictEqual(fs.files.get(badgePath('c.md')), badgeYaml('c.md', { description: 'C', referenced_by: ['a.md'] }));
	});

	test('reconnectReference repairs a target-only destination while replacing the previous pair', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C', referenced_by: ['a.md'] })
		});

		assert.strictEqual(await graph.reconnectReference(node('a.md'), node('b.md'), node('a.md'), node('c.md')), 'replaced');
		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { references: ['c.md'] }));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md'));
		assert.strictEqual(fs.files.get(badgePath('c.md')), badgeYaml('c.md', { description: 'C', referenced_by: ['a.md'] }));
	});

	test('reconnectReference treats either incomplete previous half as stale', async () => {
		const sourceOnly = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['b.md', 'c.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { referenced_by: ['a.md'] })
		});
		await assert.rejects(
			() => sourceOnly.graph.reconnectReference(node('a.md'), node('b.md'), node('a.md'), node('c.md')),
			/stale reference/
		);

		const targetOnly = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['c.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { referenced_by: ['a.md'] })
		});
		await assert.rejects(
			() => targetOnly.graph.reconnectReference(node('a.md'), node('b.md'), node('a.md'), node('c.md')),
			/stale reference/
		);
	});

	test('reconnectReference retries the whole graph after an equal-length source rewrite', async () => {
		const initialSource = badgeYaml('a.md', { description: 'AAAA', references: ['b.md'] });
		const externalSource = badgeYaml('a.md', { description: 'BBBB', references: ['b.md'] });
		assert.strictEqual(VSBuffer.fromString(initialSource).byteLength, VSBuffer.fromString(externalSource).byteLength);
		const { graph, fs } = createServices({
			[badgePath('a.md')]: initialSource,
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C' })
		});
		fs.replaceExternallyBeforeNextCommit(badgePath('a.md'), externalSource);

		assert.strictEqual(await graph.reconnectReference(node('a.md'), node('b.md'), node('a.md'), node('c.md')), 'replaced');

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { description: 'BBBB', references: ['c.md'] }));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md'));
		assert.strictEqual(fs.files.get(badgePath('c.md')), badgeYaml('c.md', { description: 'C', referenced_by: ['a.md'] }));
	});

	test('reconnectReference rejects a stale optimistic predecessor after an earlier reconnect failed', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] })
		});
		fs.failNextWriteAt(badgePath('c.md'));

		await assert.rejects(() => graph.reconnectReference(node('a.md'), node('b.md'), node('a.md'), node('c.md')));
		await assert.rejects(
			() => graph.reconnectReference(node('a.md'), node('c.md'), node('a.md'), node('d.md')),
			/stale reference/
		);
		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { references: ['b.md'] }));
		assert.strictEqual(fs.files.has(badgePath('d.md')), false);
	});

	test('reconnectReference refuses a complete next collision but accepts an exactly converged replay', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['b.md', 'c.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C', referenced_by: ['a.md'] })
		});

		await assert.rejects(
			() => graph.reconnectReference(node('a.md'), node('b.md'), node('a.md'), node('c.md')),
			/existing reference/
		);
		assert.strictEqual(await graph.reconnectReference(node('a.md'), node('missing.md'), node('a.md'), node('c.md')), 'already-connected');
		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { references: ['b.md', 'c.md'] }));
		assert.strictEqual(fs.files.get(badgePath('c.md')), badgeYaml('c.md', { description: 'C', referenced_by: ['a.md'] }));
	});

	test('reconnectReference rolls every badge back when a later write fails', async () => {
		const initial = {
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'A', references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C' })
		};
		const { graph, fs } = createServices(initial);
		fs.failNextWriteAt(badgePath('c.md'));

		await assert.rejects(() => graph.reconnectReference(node('a.md'), node('b.md'), node('a.md'), node('c.md')));

		for (const [file, content] of Object.entries(initial)) {
			assert.strictEqual(fs.files.get(file), content);
		}
	});

	test('conditional compensation refuses to overwrite an external post-commit rewrite', async () => {
		const externalTarget = badgeYaml('b.md', { description: 'External', referenced_by: [] });
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C' })
		});
		fs.replaceExternallyAfterNextCommit(badgePath('b.md'), externalTarget);
		fs.failNextWriteAt(badgePath('c.md'));

		await assert.rejects(
			() => graph.reconnectReference(node('a.md'), node('b.md'), node('a.md'), node('c.md')),
			error => error instanceof AggregateError && /conditional compensation/.test(error.message)
		);
		assert.strictEqual(fs.files.get(badgePath('b.md')), externalTarget);
		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { references: ['b.md'] }));
	});

	test('updateDescription prunes a badge emptied of all content and preserves graph fields otherwise', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Alpha', references: ['b.md'] })
		});

		await graph.updateDescription(node('a.md'), '');
		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { references: ['b.md'] }));

		const { graph: graph2, fs: fs2 } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Alpha' })
		});
		await graph2.updateDescription(node('a.md'), '   ');
		assert.strictEqual(fs2.files.get(badgePath('a.md')), badgeYaml('a.md'));

		const { graph: graph3, fs: fs3 } = createServices();
		await graph3.updateDescription(node('c.md'), 'Fresh note');
		assert.strictEqual(fs3.files.get(badgePath('c.md')), badgeYaml('c.md', { description: 'Fresh note' }));
	});

	test('empty tombstones stay logically absent and preserve folder kind when rematerialized', async () => {
		const { graph } = createServices({
			[badgePath('docs')]: badgeYaml('docs', { kind: 'folder' }),
			[badgePath('real.md')]: badgeYaml('real.md', { description: 'Real' })
		});

		assert.strictEqual(await graph.readBadge(node('docs', 'file')), null);
		assert.deepStrictEqual([...((await graph.listBadges(workspaceFolder)).badges.keys())], ['real.md']);
		await graph.addReference(node('a.md'), node('docs', 'file'));

		assert.deepStrictEqual(await graph.readBadge(node('docs', 'file')), {
			path: 'docs',
			kind: 'folder',
			references: [],
			referenced_by: ['a.md']
		});
	});

	test('readBadgeNeighborhood returns only raw neighbours and isolates a corrupt endpoint', async () => {
		const { graph } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['broken.md', 'c.md', 'c.md'], referenced_by: ['docs'] }),
			[badgePath('broken.md')]: 'path: [unterminated',
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C', referenced_by: ['a.md'] }),
			[badgePath('docs')]: badgeYaml('docs', { kind: 'folder', description: 'Docs', references: ['a.md'] }),
			[badgePath('unrelated.md')]: badgeYaml('unrelated.md', { description: 'Not in the neighbourhood' })
		});

		const result = await graph.readBadgeNeighborhood(node('a.md'));

		assert.deepStrictEqual([...result.badges.keys()], ['a.md', 'c.md', 'docs']);
		assert.strictEqual(result.badges.get('docs')?.kind, 'folder');
		assert.strictEqual(result.badges.has('unrelated.md'), false);
		assert.strictEqual(result.problems.length, 1);
		assert.strictEqual(result.problems[0].relativePath, 'broken.md');
		assert.strictEqual(result.problems[0].corrupt, true);
	});

	test('readBadgeNeighborhood reports an unreadable current badge without guessing neighbours', async () => {
		const { graph } = createServices({
			[badgePath('broken.md')]: 'path: [unterminated',
			[badgePath('unrelated.md')]: badgeYaml('unrelated.md', { description: 'Unrelated' })
		});

		const result = await graph.readBadgeNeighborhood(node('broken.md'));

		assert.deepStrictEqual([...result.badges.keys()], []);
		assert.strictEqual(result.problems.length, 1);
		assert.strictEqual(result.problems[0].relativePath, 'broken.md');
	});

	test('renameNode moves the badge, rewrites both graph directions, and drops the orphan flag', async () => {
		const { graph, fs } = createServices({
			[badgePath('old.md')]: badgeYaml('old.md', { description: 'Note', references: ['target.md'], referenced_by: ['referrer.md'], orphan: true }),
			[badgePath('target.md')]: badgeYaml('target.md', { referenced_by: ['old.md'] }),
			[badgePath('referrer.md')]: badgeYaml('referrer.md', { references: ['old.md'] })
		});

		await graph.renameNode(workspaceFolder, 'old.md', 'new.md', 'file');

		assert.strictEqual(fs.files.get(badgePath('old.md')), badgeYaml('old.md'));
		assert.strictEqual(fs.files.get(badgePath('new.md')), badgeYaml('new.md', { description: 'Note', references: ['target.md'], referenced_by: ['referrer.md'] }));
		assert.strictEqual(fs.files.get(badgePath('target.md')), badgeYaml('target.md', { referenced_by: ['new.md'] }));
		assert.strictEqual(fs.files.get(badgePath('referrer.md')), badgeYaml('referrer.md', { references: ['new.md'] }));
	});

	test('renameNode retries from the latest equal-length source snapshot instead of moving a stale constant', async () => {
		const initialSource = badgeYaml('old.md', { description: 'AAAA', references: ['target.md'] });
		const externalSource = badgeYaml('old.md', { description: 'BBBB', references: ['target.md'] });
		assert.strictEqual(VSBuffer.fromString(initialSource).byteLength, VSBuffer.fromString(externalSource).byteLength);
		const { graph, fs } = createServices({
			[badgePath('old.md')]: initialSource,
			[badgePath('target.md')]: badgeYaml('target.md', { referenced_by: ['old.md'] })
		});
		fs.replaceExternallyBeforeNextCommit(badgePath('old.md'), externalSource);

		await graph.renameNode(workspaceFolder, 'old.md', 'new.md', 'file');

		assert.strictEqual(fs.files.get(badgePath('old.md')), badgeYaml('old.md'));
		assert.strictEqual(fs.files.get(badgePath('new.md')), badgeYaml('new.md', { description: 'BBBB', references: ['target.md'] }));
		assert.strictEqual(fs.files.get(badgePath('target.md')), badgeYaml('target.md', { referenced_by: ['new.md'] }));
	});

	test('overwrite retirement drops target-authored data but preserves canonical inbound references', async () => {
		const { graph, fs } = createServices({
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'Old B', references: ['c.md'], referenced_by: ['r.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { referenced_by: ['b.md'] }),
			[badgePath('r.md')]: badgeYaml('r.md', { references: ['b.md'] })
		});

		await graph.retireReplacedNode(workspaceFolder, 'b.md', 'file');

		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { referenced_by: ['r.md'] }));
		assert.strictEqual(fs.files.get(badgePath('c.md')), badgeYaml('c.md'));
		assert.strictEqual(fs.files.get(badgePath('r.md')), badgeYaml('r.md', { references: ['b.md'] }));
	});

	test('overwrite retirement retries latest equal-length outbound references before retiring the owner', async () => {
		const initialOwner = badgeYaml('b.md', { description: 'BBBB', references: ['c.md'] });
		const externalOwner = badgeYaml('b.md', { description: 'BBBB', references: ['d.md'] });
		assert.strictEqual(VSBuffer.fromString(initialOwner).byteLength, VSBuffer.fromString(externalOwner).byteLength);
		const { graph, fs } = createServices({
			[badgePath('b.md')]: initialOwner,
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C', referenced_by: ['b.md'] }),
			[badgePath('d.md')]: badgeYaml('d.md', { description: 'D', referenced_by: ['b.md'] })
		});
		fs.replaceExternallyBeforeNextCommit(badgePath('b.md'), externalOwner);

		await graph.retireReplacedNode(workspaceFolder, 'b.md', 'file');

		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md'));
		assert.strictEqual(fs.files.get(badgePath('d.md')), badgeYaml('d.md', { description: 'D' }));
	});

	test('overwrite move merges path backlinks without inheriting target-authored data', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Incoming A' }),
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'Old B', references: ['c.md'], referenced_by: ['r.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { referenced_by: ['b.md'] }),
			[badgePath('r.md')]: badgeYaml('r.md', { references: ['b.md'] })
		});

		await graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'b.md', { incomingKind: 'file', replacedKind: 'file' });

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md'));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'Incoming A', referenced_by: ['r.md'] }));
		assert.strictEqual(fs.files.get(badgePath('c.md')), badgeYaml('c.md'));
		assert.strictEqual(fs.files.get(badgePath('r.md')), badgeYaml('r.md', { references: ['b.md'] }));
	});

	test('incoming identity replaces the retired destination tombstone kind', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Incoming file' }),
			[badgePath('b.md')]: badgeYaml('b.md', { kind: 'folder' })
		});

		await graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'b.md', { incomingKind: 'file', replacedKind: 'folder' });

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md'));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'Incoming file' }));
	});

	test('sparse incoming identity still replaces a materialized destination tombstone kind', async () => {
		const { graph, fs } = createServices({
			[badgePath('b.md')]: badgeYaml('b.md', { kind: 'folder' })
		});

		await graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'b.md', { incomingKind: 'file', replacedKind: 'folder' });

		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md'));
		assert.strictEqual(await graph.readBadge(node('b.md')), null);
	});

	test('a materialized sparse source carries its incoming kind to an absent destination tombstone', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { kind: 'folder' })
		});

		await graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'b.md', { incomingKind: 'file' });

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { kind: 'folder' }));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md'));
		assert.strictEqual(await graph.readBadge(node('b.md')), null);
	});

	test('move to a disk-absent destination retires its stale mirror-only subtree', async () => {
		const { graph, fs } = createServices({
			[badgePath('docs')]: badgeYaml('docs', { kind: 'folder', description: 'Incoming' }),
			[badgePath('archive/stale.md')]: badgeYaml('archive/stale.md', { description: 'Orphan', references: ['outside.md'] }),
			[badgePath('outside.md')]: badgeYaml('outside.md', { description: 'Outside', referenced_by: ['archive/stale.md'] })
		});

		// `replacedKind` is intentionally absent: the user-file destination did
		// not exist, but its sparse `.bh/mirror/archive/**` identity still must not
		// survive underneath the incoming folder.
		await graph.replaceNodeIdentity(workspaceFolder, 'docs', 'archive', { incomingKind: 'folder' });

		assert.strictEqual(fs.files.get(badgePath('archive')), badgeYaml('archive', { kind: 'folder', description: 'Incoming' }));
		assert.strictEqual(fs.files.get(badgePath('archive/stale.md')), badgeYaml('archive/stale.md'));
		assert.strictEqual(fs.files.get(badgePath('outside.md')), badgeYaml('outside.md', { description: 'Outside' }));
	});

	test('identity replacement atomically retires destination outbound backlinks', async () => {
		const initial = {
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Incoming A' }),
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'Old B', references: ['c.md'], referenced_by: ['r.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C', referenced_by: ['b.md'] }),
			[badgePath('r.md')]: badgeYaml('r.md', { references: ['b.md'] })
		};
		const { graph, fs } = createServices(initial);

		await graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'b.md', { incomingKind: 'file', replacedKind: 'file' });

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md'));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'Incoming A', referenced_by: ['r.md'] }));
		assert.strictEqual(fs.files.get(badgePath('c.md')), badgeYaml('c.md', { description: 'C' }));
		assert.strictEqual(fs.files.get(badgePath('r.md')), badgeYaml('r.md', { references: ['b.md'] }));
	});

	test('identity replacement compensates destination retirement when incoming owner commit fails', async () => {
		const initial = {
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Incoming A' }),
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'Old B', references: ['c.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C', referenced_by: ['b.md'] })
		};
		const { graph, fs } = createServices(initial);
		fs.failNextWriteAt(badgePath('a.md'));

		await assert.rejects(() => graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'b.md', { incomingKind: 'file', replacedKind: 'file' }));

		for (const [path, contents] of Object.entries(initial)) {
			assert.strictEqual(fs.files.get(path), contents);
		}
	});

	test('identity replacement restores the source and fails closed when the committed destination changes externally', async () => {
		const source = badgeYaml('a.md', { description: 'Incoming A' });
		const externalTarget = badgeYaml('b.md', { description: 'External latest' });
		const { graph, fs } = createServices({
			[badgePath('a.md')]: source
		});
		fs.replaceExternallyAfterNextCommit(badgePath('b.md'), externalTarget);

		await assert.rejects(
			() => graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'b.md', { incomingKind: 'file' }),
			error => error instanceof AggregateError
		);

		assert.strictEqual(fs.files.get(badgePath('a.md')), source);
		assert.strictEqual(fs.files.get(badgePath('b.md')), externalTarget);
	});

	test('identity replacement revalidates a semantic-equal skipped destination before retiring the source', async () => {
		const same = { description: 'Same' };
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', same),
			[badgePath('b.md')]: badgeYaml('b.md', same)
		});
		fs.writeExternallyBeforeNextCommit(
			badgePath('a.md'),
			badgePath('b.md'),
			badgeYaml('b.md', { description: 'External destination' })
		);

		await graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'b.md', { incomingKind: 'file', replacedKind: 'file' });

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md'));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', same));
	});

	test('identity replacement revalidates absent referrer dependencies and incorporates a concurrent appearance', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'A', referenced_by: ['r.md'] })
		});
		fs.writeExternallyBeforeNextCommit(
			badgePath('a.md'),
			badgePath('r.md'),
			badgeYaml('r.md', { references: ['a.md'] })
		);

		await graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'b.md', { incomingKind: 'file' });

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md'));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'A', referenced_by: ['r.md'] }));
		assert.strictEqual(fs.files.get(badgePath('r.md')), badgeYaml('r.md', { references: ['b.md'] }));
	});

	test('case-only file identity rewrites one physical badge and its neighbours', async () => {
		const { graph, fs } = createServices({
			[badgePath('A.md')]: badgeYaml('a.md', { description: 'A', references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] })
		}, { caseInsensitive: true });

		await graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'A.md', { incomingKind: 'file', sameResourceIdentity: true });

		assert.strictEqual(fs.files.get(badgePath('A.md')), badgeYaml('A.md', { description: 'A', references: ['b.md'] }));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { referenced_by: ['A.md'] }));
		assert.strictEqual([...fs.files.keys()].some(path => path === badgePath('a.md')), false);
	});

	test('case-only folder identity rewrites descendants and intra-subtree edges from one snapshot plan', async () => {
		const { graph, fs } = createServices({
			[badgePath('Docs')]: badgeYaml('docs', { kind: 'folder', description: 'Docs' }),
			[badgePath('Docs/a.md')]: badgeYaml('docs/a.md', { references: ['docs/b.md'] }),
			[badgePath('Docs/b.md')]: badgeYaml('docs/b.md', { referenced_by: ['docs/a.md', 'outside.md'] }),
			[badgePath('outside.md')]: badgeYaml('outside.md', { references: ['docs/b.md'] })
		}, { caseInsensitive: true });

		await graph.replaceNodeIdentity(workspaceFolder, 'docs', 'Docs', { incomingKind: 'folder', sameResourceIdentity: true });

		assert.strictEqual(fs.files.get(badgePath('Docs')), badgeYaml('Docs', { kind: 'folder', description: 'Docs' }));
		assert.strictEqual(fs.files.get(badgePath('Docs/a.md')), badgeYaml('Docs/a.md', { references: ['Docs/b.md'] }));
		assert.strictEqual(fs.files.get(badgePath('Docs/b.md')), badgeYaml('Docs/b.md', { referenced_by: ['Docs/a.md', 'outside.md'] }));
		assert.strictEqual(fs.files.get(badgePath('outside.md')), badgeYaml('outside.md', { references: ['Docs/b.md'] }));
	});

	test('rename onto a dangling outbound target removes the resulting self-reference and backlink', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'A', references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] })
		});

		await graph.replaceNodeIdentity(workspaceFolder, 'a.md', 'b.md', { incomingKind: 'file', replacedKind: 'file' });

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md'));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'A' }));
	});

	test('renameNode drops phantom backlinks whose referrer badge no longer exists', async () => {
		const { graph, fs } = createServices({
			[badgePath('old.md')]: badgeYaml('old.md', { description: 'Note', referenced_by: ['gone.md'] })
		});

		await graph.renameNode(workspaceFolder, 'old.md', 'new.md', 'file');

		assert.strictEqual(fs.files.get(badgePath('new.md')), badgeYaml('new.md', { description: 'Note' }));
	});

	test('renameNode on a folder carries annotated descendants and converges intra-subtree references', async () => {
		const { graph, fs } = createServices({
			[badgePath('docs')]: badgeYaml('docs', { kind: 'folder', description: 'Docs' }),
			[badgePath('docs/a.md')]: badgeYaml('docs/a.md', { references: ['docs/b.md'] }),
			[badgePath('docs/b.md')]: badgeYaml('docs/b.md', { description: 'B', referenced_by: ['docs/a.md'] }),
			[badgePath('outside.md')]: badgeYaml('outside.md', { references: ['docs/b.md'] })
		});
		fs.files.set(badgePath('docs/b.md'), badgeYaml('docs/b.md', { description: 'B', referenced_by: ['docs/a.md', 'outside.md'] }));

		await graph.renameNode(workspaceFolder, 'docs', 'notes', 'folder');

		assert.strictEqual(fs.files.get(badgePath('docs')), badgeYaml('docs', { kind: 'folder' }));
		assert.strictEqual(fs.files.get(badgePath('docs/a.md')), badgeYaml('docs/a.md'));
		assert.strictEqual(fs.files.get(badgePath('notes')), badgeYaml('notes', { kind: 'folder', description: 'Docs' }));
		assert.strictEqual(fs.files.get(badgePath('notes/a.md')), badgeYaml('notes/a.md', { references: ['notes/b.md'] }));
		assert.strictEqual(fs.files.get(badgePath('notes/b.md')), badgeYaml('notes/b.md', { description: 'B', referenced_by: ['notes/a.md', 'outside.md'] }));
		assert.strictEqual(fs.files.get(badgePath('outside.md')), badgeYaml('outside.md', { references: ['notes/b.md'] }));
	});

	test('folder identity replacement compensates the whole graph when a later descendant write fails', async () => {
		const originalRoot = badgeYaml('docs', { kind: 'folder', description: 'Docs' });
		const originalA = badgeYaml('docs/a.md', { references: ['docs/b.md'] });
		const originalB = badgeYaml('docs/b.md', { description: 'B', referenced_by: ['docs/a.md', 'outside.md'] });
		const originalOutside = badgeYaml('outside.md', { references: ['docs/b.md'] });
		const { graph, fs } = createServices({
			[badgePath('docs')]: originalRoot,
			[badgePath('docs/a.md')]: originalA,
			[badgePath('docs/b.md')]: originalB,
			[badgePath('outside.md')]: originalOutside
		});
		// The root and its external neighbour have already committed by the time
		// this destination owner is reached. One operation-wide transaction must
		// compensate all of them instead of exposing a half-moved subtree.
		fs.failNextWriteAt(badgePath('notes/a.md'));

		await assert.rejects(() => graph.replaceNodeIdentity(workspaceFolder, 'docs', 'notes', { incomingKind: 'folder' }));

		assert.strictEqual(fs.files.get(badgePath('docs')), originalRoot);
		assert.strictEqual(fs.files.get(badgePath('docs/a.md')), originalA);
		assert.strictEqual(fs.files.get(badgePath('docs/b.md')), originalB);
		assert.strictEqual(fs.files.get(badgePath('outside.md')), originalOutside);
		assert.strictEqual(await graph.readBadge(node('notes', 'folder')), null);
		assert.strictEqual(await graph.readBadge(node('notes/a.md')), null);
		assert.strictEqual(await graph.readBadge(node('notes/b.md')), null);
	});

	test('deleteNode removes the badge and scrubs its backlinks off outbound targets', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'B', referenced_by: ['a.md'] }),
			[badgePath('referrer.md')]: badgeYaml('referrer.md', { description: 'R', references: ['a.md'] })
		});

		await graph.deleteNode(workspaceFolder, 'a.md', 'file');

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md'));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'B' }));
		// The referrer's outbound reference is ITS authored content — it stays,
		// and the derived canvas edge simply stops drawing.
		assert.strictEqual(fs.files.get(badgePath('referrer.md')), badgeYaml('referrer.md', { description: 'R', references: ['a.md'] }));
	});

	test('deleteNode retries latest equal-length outbound references before purging the owner', async () => {
		const initialOwner = badgeYaml('a.md', { description: 'AAAA', references: ['b.md'] });
		const externalOwner = badgeYaml('a.md', { description: 'AAAA', references: ['c.md'] });
		assert.strictEqual(VSBuffer.fromString(initialOwner).byteLength, VSBuffer.fromString(externalOwner).byteLength);
		const { graph, fs } = createServices({
			[badgePath('a.md')]: initialOwner,
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'B', referenced_by: ['a.md'] }),
			[badgePath('c.md')]: badgeYaml('c.md', { description: 'C', referenced_by: ['a.md'] })
		});
		fs.replaceExternallyBeforeNextCommit(badgePath('a.md'), externalOwner);

		await graph.deleteNode(workspaceFolder, 'a.md', 'file');

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md'));
		assert.strictEqual(fs.files.get(badgePath('c.md')), badgeYaml('c.md', { description: 'C' }));
	});

	test('deleteNode on a folder purges annotated descendants too', async () => {
		const { graph, fs } = createServices({
			[badgePath('docs')]: badgeYaml('docs', { kind: 'folder', description: 'Docs' }),
			[badgePath('docs/a.md')]: badgeYaml('docs/a.md', { description: 'A' }),
			[badgePath('other.md')]: badgeYaml('other.md', { description: 'Other' })
		});

		await graph.deleteNode(workspaceFolder, 'docs', 'folder');

		assert.strictEqual(fs.files.get(badgePath('docs')), badgeYaml('docs', { kind: 'folder' }));
		assert.strictEqual(fs.files.get(badgePath('docs/a.md')), badgeYaml('docs/a.md'));
		assert.strictEqual(fs.files.has(badgePath('other.md')), true);
	});

	test('pruneDangling orphans badges whose disk node is gone; clearOrphan revives them', async () => {
		const { graph, fs } = createServices({
			[badgePath('alive.md')]: badgeYaml('alive.md', { description: 'Alive' }),
			[badgePath('dead.md')]: badgeYaml('dead.md', { description: 'Dead' }),
			'/work/alive.md': 'content'
		});

		const orphaned = await graph.pruneDangling(workspaceFolder);

		assert.deepStrictEqual(orphaned, ['dead.md']);
		assert.strictEqual(fs.files.get(badgePath('dead.md')), badgeYaml('dead.md', { description: 'Dead', orphan: true }));
		assert.strictEqual(fs.files.get(badgePath('alive.md')), badgeYaml('alive.md', { description: 'Alive' }));

		await graph.clearOrphan(node('dead.md'));
		assert.strictEqual(fs.files.get(badgePath('dead.md')), badgeYaml('dead.md', { description: 'Dead' }));
	});

	test('listBadges walks the sparse mirror and tolerates corrupt entries', async () => {
		const { graph } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Alpha' }),
			[badgePath('docs/deep/b.md')]: badgeYaml('docs/deep/b.md', { description: 'Deep' }),
			[badgePath('bad.md')]: 'path: [unterminated'
		});

		const result = await graph.listBadges(workspaceFolder);

		assert.deepStrictEqual([...result.badges.keys()], ['a.md', 'docs/deep/b.md']);
		assert.strictEqual(result.problems.length, 1);
		assert.strictEqual(result.problems[0].relativePath, 'bad.md');
	});

	test('listBadges probes named endpoints skipped by the walker and classifies guarded failures as unreadable', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['b.md', 'missing.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] })
		});
		fs.markSymbolicLink('/work/.bh/mirror/b.md');

		const result = await graph.listBadges(workspaceFolder);
		const problems = new Map(result.problems.map(problem => [problem.relativePath, problem]));
		const relationships = baseHalfCanvasBadgeRelationships('a.md', result.badges.get('a.md'), result.badges, problems);

		assert.deepStrictEqual([...result.badges.keys()], ['a.md']);
		assert.strictEqual(result.problems.length, 1);
		assert.strictEqual(result.problems[0].relativePath, 'b.md');
		assert.strictEqual(result.problems[0].corrupt, false);
		assert.deepStrictEqual(relationships.references, []);
		assert.deepStrictEqual(relationships.issues.map(issue => ({ to: issue.to, reason: issue.reason })), [
			{ to: 'b.md', reason: 'unreadable' },
			{ to: 'missing.md', reason: 'incomplete' }
		]);
	});
});

/**
 * In-memory file system implementing the IFileService subset the badge layers
 * touch: read/write/delete/exists for YAML IO, stat for the orphan sweep's
 * disk probe, and resolve for the mirror-tree walk (directories are implied by
 * deeper keys, the same way a real FS lists them).
 */
class TestFileSystem {
	readonly files = new Map<string, string>();
	private readonly revisions = new Map<string, number>();
	private readonly externalWritesBeforeCommit = new Map<string, string>();
	private readonly externalWritesAfterCommit = new Map<string, string>();
	private readonly externalActionsBeforeCommit = new Map<string, () => void>();
	private readonly symbolicLinks = new Set<string>();
	private failingWrite: string | undefined;
	private readonly caseInsensitive: boolean;

	constructor(initial?: Record<string, string>, options?: { readonly caseInsensitive?: boolean }) {
		this.caseInsensitive = options?.caseInsensitive === true;
		for (const [path, content] of Object.entries(initial ?? {})) {
			this.files.set(path, content);
			this.revisions.set(path, 1);
		}
	}

	async readFile(resource: URI): Promise<{ value: VSBuffer; mtime: number; etag: string }> {
		const path = this.actualPath(resource.fsPath);
		const raw = this.files.get(path);
		if (raw === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		const revision = this.revision(path);
		return { value: VSBuffer.fromString(raw), mtime: revision, etag: `v${revision}` };
	}

	async writeFile(resource: URI, buffer: VSBuffer, options?: { mtime?: number; etag?: string }): Promise<void> {
		const path = this.actualPath(resource.fsPath);
		if (this.failingWrite === path) {
			this.failingWrite = undefined;
			throw new Error(`Injected write failure for ${path}`);
		}
		const revision = this.files.has(path) ? this.revision(path) : undefined;
		if (options?.mtime !== undefined && revision === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		if (options?.mtime !== undefined && (options.mtime !== revision || options.etag !== `v${revision}`)) {
			throw new FileOperationError('modified', FileOperationResult.FILE_MODIFIED_SINCE);
		}
		this.files.set(path, buffer.toString());
		this.revisions.set(path, (revision ?? 0) + 1);
	}

	async writeFileWithExpectedContents(resource: URI, buffer: VSBuffer, expectedContents: VSBuffer | null): Promise<void> {
		const path = this.actualPath(resource.fsPath);
		if (this.failingWrite === path) {
			this.failingWrite = undefined;
			throw new Error(`Injected write failure for ${path}`);
		}
		const externalBefore = this.externalWritesBeforeCommit.get(path);
		if (externalBefore !== undefined) {
			this.externalWritesBeforeCommit.delete(path);
			this.files.set(path, externalBefore);
			this.revisions.set(path, this.revision(path) + 1);
		}
		const externalAction = this.externalActionsBeforeCommit.get(path);
		if (externalAction) {
			this.externalActionsBeforeCommit.delete(path);
			externalAction();
		}
		const current = this.files.get(path);
		if (expectedContents === null ? current !== undefined : current !== expectedContents.toString()) {
			throw new FileOperationError('modified', FileOperationResult.FILE_MODIFIED_SINCE);
		}
		this.files.set(path, buffer.toString());
		this.revisions.set(path, this.revision(path) + 1);
		const externalAfter = this.externalWritesAfterCommit.get(path);
		if (externalAfter !== undefined) {
			this.externalWritesAfterCommit.delete(path);
			this.files.set(path, externalAfter);
			this.revisions.set(path, this.revision(path) + 1);
		}
	}

	async createFile(resource: URI, buffer: VSBuffer, options?: { overwrite?: boolean }): Promise<void> {
		if (this.files.has(this.actualPath(resource.fsPath)) && !options?.overwrite) {
			throw new FileOperationError('already exists', FileOperationResult.FILE_MODIFIED_SINCE);
		}
		await this.writeFile(resource, buffer);
	}

	failNextWriteAt(path: string): void {
		this.failingWrite = path;
	}

	markSymbolicLink(path: string): void {
		this.symbolicLinks.add(path);
	}

	replaceExternallyBeforeNextCommit(path: string, contents: string): void {
		this.externalWritesBeforeCommit.set(path, contents);
	}

	replaceExternallyAfterNextCommit(path: string, contents: string): void {
		this.externalWritesAfterCommit.set(path, contents);
	}

	writeExternallyBeforeNextCommit(triggerPath: string, targetPath: string, contents: string): void {
		this.externalActionsBeforeCommit.set(triggerPath, () => {
			const actualTarget = this.actualPath(targetPath);
			this.files.set(actualTarget, contents);
			this.revisions.set(actualTarget, this.revision(actualTarget) + 1);
		});
	}

	async createFolder(_resource: URI): Promise<void> { }

	async del(resource: URI): Promise<void> {
		const path = this.actualPath(resource.fsPath);
		if (!this.files.delete(path)) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		this.revisions.delete(path);
	}

	async exists(resource: URI): Promise<boolean> {
		const path = this.actualPath(resource.fsPath);
		return this.files.has(path) || this.isDirectory(path);
	}

	async stat(resource: URI): Promise<{ isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }> {
		const path = this.actualPath(resource.fsPath);
		if (this.files.has(path)) {
			return { isFile: true, isDirectory: false, isSymbolicLink: this.symbolicLinks.has(path) };
		}
		if (this.isDirectory(path)) {
			return { isFile: false, isDirectory: true, isSymbolicLink: this.symbolicLinks.has(path) };
		}

		throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
	}

	async resolve(resource: URI): Promise<{ children: Array<{ resource: URI; name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }> }> {
		const actualResourcePath = this.actualPath(resource.fsPath);
		const prefix = `${actualResourcePath}/`;
		if (!this.isDirectory(actualResourcePath)) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		const names = new Map<string, boolean>();
		for (const path of this.files.keys()) {
			if (!path.startsWith(prefix)) {
				continue;
			}

			const rest = path.slice(prefix.length);
			const slash = rest.indexOf('/');
			const name = slash === -1 ? rest : rest.slice(0, slash);
			names.set(name, slash !== -1 || (names.get(name) ?? false));
		}

		return {
			children: [...names.entries()].map(([name, isDirectory]) => ({
				resource: URI.file(`${prefix}${name}`),
				name,
				isFile: !isDirectory,
				isDirectory,
				isSymbolicLink: this.symbolicLinks.has(`${prefix}${name}`)
			}))
		};
	}

	private isDirectory(path: string): boolean {
		const prefix = `${path}/`;
		for (const key of this.files.keys()) {
			if (key.startsWith(prefix)) {
				return true;
			}
		}
		return false;
	}

	private actualPath(path: string): string {
		if (!this.caseInsensitive) {
			return path;
		}
		const folded = path.toLowerCase();
		for (const candidate of this.files.keys()) {
			const candidateFolded = candidate.toLowerCase();
			if (candidateFolded === folded) {
				return candidate;
			}
			if (candidateFolded.startsWith(`${folded}/`)) {
				return candidate.slice(0, path.length);
			}
		}
		return path;
	}

	private revision(path: string): number {
		let revision = this.revisions.get(path);
		if (revision === undefined) {
			revision = 1;
			this.revisions.set(path, revision);
		}
		return revision;
	}
}
