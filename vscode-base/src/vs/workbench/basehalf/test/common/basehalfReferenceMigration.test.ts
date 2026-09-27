/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IBaseHalfBadgeLegacyReferences } from '../../common/basehalfBadgeMirror.js';
import {
	appendBaseHalfLegacyRecords,
	baseHalfDeriveLegacyPairs,
	baseHalfLatestLegacyRecords,
	baseHalfLegacyPairDropReason,
	baseHalfLegacyPromptCounts,
	baseHalfLegacyReportRows,
	IBaseHalfLegacyFolderPlan,
	IBaseHalfLegacyRecord,
	parseBaseHalfLegacyRecords
} from '../../common/basehalfReferenceMigration.js';

const folder = URI.file('/work');

function legacy(relativePath: string, references?: string[], referencedBy?: string[], malformed: ('references' | 'referenced_by')[] = []): IBaseHalfBadgeLegacyReferences {
	return {
		relativePath,
		resource: URI.joinPath(folder, '.bh', 'mirror', ...relativePath.split('/').filter(Boolean), 'badge.yaml'),
		...(references ? { references } : {}),
		...(referencedBy ? { referencedBy } : {}),
		malformed
	};
}

suite('BaseHalfReferenceMigration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('derives complete and one-sided pairs from both legacy keys, and malformed keys', () => {
		const { pairs, malformed } = baseHalfDeriveLegacyPairs([
			legacy('a.md', ['b.md', 'c.md', 'b.md']),
			legacy('b.md', undefined, ['a.md', 'z.md']),
			legacy('m.md', undefined, undefined, ['references'])
		]);
		assert.deepStrictEqual({
			pairs: pairs.map(pair => `${pair.upstream}→${pair.downstream} ${pair.inReferences ? 'R' : '-'}${pair.inReferencedBy ? 'B' : '-'}`),
			malformed
		}, {
			pairs: ['a.md→b.md RB', 'z.md→b.md -B', 'a.md→c.md R-'],
			malformed: [{ badge: 'm.md', key: 'references' }]
		});
	});

	test('drops only pairs that can never be represented', () => {
		const pair = (upstream: string, downstream: string, complete = true) => ({ upstream, downstream, inReferences: true, inReferencedBy: complete });
		assert.deepStrictEqual([
			pair('a.md', 'b.md'),
			pair('a.md', 'b.md', false),
			pair('a.md', 'a.md'),
			pair('', 'b.md'),
			pair('a.md', '.bh/x.md'),
			pair('a.md', '.BH/x.md'),
			pair('./a.md', 'b.md'),
			pair('a\\b.md', 'b.md'),
			pair('a\u0001.md', 'b.md'),
			pair('2024', 'why?.md'),
			pair('outputs/r.md', 'b.md')
		].map(baseHalfLegacyPairDropReason), [
			undefined,
			'oneSided',
			'self',
			'rootOrMetadata',
			'rootOrMetadata',
			'rootOrMetadata',
			'invalidPath',
			'invalidPath',
			'invalidPath',
			undefined,
			undefined
		]);
	});

	test('the prompt counts pairs to write and the stores they land in; the report lists every pair in exactly one section', () => {
		const plan: IBaseHalfLegacyFolderPlan = {
			workspaceFolder: folder,
			pairs: [
				{ upstream: 'a.md', downstream: 'b.md', inReferences: true, inReferencedBy: true, status: { kind: 'write' }, storeKind: 'markdown' },
				{ upstream: 'c.md', downstream: 'b.md', inReferences: true, inReferencedBy: true, status: { kind: 'write' }, storeKind: 'markdown' },
				{ upstream: 'a.md', downstream: 'docs', inReferences: true, inReferencedBy: true, status: { kind: 'write' }, storeKind: 'sidecar' },
				{ upstream: 'a.md', downstream: 'clip.bhnode', inReferences: true, inReferencedBy: true, status: { kind: 'write' }, storeKind: 'node' },
				{ upstream: 'd.md', downstream: 'b.md', inReferences: true, inReferencedBy: true, status: { kind: 'present' }, storeKind: 'markdown' },
				{ upstream: 'e.md', downstream: 'b.md', inReferences: true, inReferencedBy: false, status: { kind: 'dropped', reason: 'oneSided' } },
				{ upstream: 'a.md', downstream: 'gone.md', inReferences: true, inReferencedBy: true, status: { kind: 'deferred', reason: 'missingDownstream' } }
			],
			malformed: [{ badge: 'm.md', key: 'referenced_by' }]
		};
		const rows = baseHalfLegacyReportRows([plan]);
		assert.deepStrictEqual({
			counts: baseHalfLegacyPromptCounts([plan]),
			rows: rows.map(row => `${row.section} ${row.downstream} [${row.upstreams.join(', ')}]${row.reason ? ` ${row.reason}` : ''}${row.key ? ` ${row.key}` : ''}`),
			pairsInRows: rows.reduce((sum, row) => sum + row.upstreams.length, 0)
		}, {
			counts: { connections: 4, notes: 1, nodeDocuments: 1, metadataItems: 1 },
			rows: [
				'add b.md [a.md, c.md]',
				'add clip.bhnode [a.md]',
				'add docs [a.md]',
				'present b.md [d.md]',
				'cannot b.md [e.md] oneSided',
				'cannot gone.md [a.md] missingDownstream',
				'cannot m.md [] malformedKey referenced_by'
			],
			pairsInRows: plan.pairs.length
		});
	});

	test('records append without changing existing bytes and parse back, the latest record per pair winning', () => {
		const records: IBaseHalfLegacyRecord[] = [
			{ upstream: 'a.md', downstream: 'b.md', outcome: 'deferred', reason: 'unsaved', date: '2026-09-26' },
			{ upstream: 'odd "name".md', downstream: 'b.md', outcome: 'dropped', reason: 'oneSided', date: '2026-09-27' },
			{ badge: 'm.md', key: 'references', outcome: 'dropped', reason: 'malformedKey', date: '2026-09-27' }
		];
		const first = appendBaseHalfLegacyRecords(undefined, records.slice(0, 1));
		const existing = `${first}# a comment someone added\r\n  stray line`;
		const second = appendBaseHalfLegacyRecords(existing, [...records.slice(1), { upstream: 'a.md', downstream: 'b.md', outcome: 'migrated', date: '2026-09-27' }]);
		const parsed = parseBaseHalfLegacyRecords(second);
		assert.deepStrictEqual({
			keepsBytes: second.startsWith(existing),
			headerIsComment: first.startsWith('# '),
			parsed,
			latest: [...baseHalfLatestLegacyRecords(parsed).values()].map(record => `${record.upstream ?? record.badge} ${record.outcome}`)
		}, {
			keepsBytes: true,
			headerIsComment: true,
			parsed: [...records, { upstream: 'a.md', downstream: 'b.md', outcome: 'migrated', date: '2026-09-27' }],
			latest: ['a.md migrated', 'odd "name".md dropped', 'm.md dropped']
		});
	});

	test('a record file in CRLF stays CRLF, and a text without a final line break gets one before the next record', () => {
		const current = '# mine\r\n- upstream: "a.md"\r\n  downstream: "b.md"\r\n  outcome: migrated\r\n  date: "2026-09-27"';
		const next = appendBaseHalfLegacyRecords(current, [{ upstream: 'c.md', downstream: 'b.md', outcome: 'dropped', reason: 'self', date: '2026-09-28' }]);
		assert.strictEqual(next, `${current}\r\n- upstream: "c.md"\r\n  downstream: "b.md"\r\n  outcome: dropped\r\n  reason: self\r\n  date: "2026-09-28"\r\n`);
		assert.deepStrictEqual(parseBaseHalfLegacyRecords(next).map(record => record.upstream), ['a.md', 'c.md']);
	});
});
