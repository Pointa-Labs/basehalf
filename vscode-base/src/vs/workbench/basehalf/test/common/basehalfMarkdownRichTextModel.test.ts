/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { IPosition } from '../../../../editor/common/core/position.js';
import { ICursorStateComputer, IIdentifiedSingleEditOperation } from '../../../../editor/common/model.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import {
	applyBaseHalfMarkdownRichTextModelContent,
	BaseHalfMarkdownRichTextModelDirtyAfterSaveError,
	BaseHalfMarkdownRichTextModelDisk,
	BaseHalfMarkdownRichTextModelDisposedError,
	BaseHalfMarkdownRichTextModelReadonlyError,
	BaseHalfMarkdownRichTextModelSaveCancelledError,
	BaseHalfMarkdownRichTextModelWriteGate,
	computeBaseHalfMarkdownRichTextEdit,
	IBaseHalfMarkdownRichTextFileService,
	IBaseHalfMarkdownRichTextModel
} from '../../common/basehalfMarkdownRichTextModel.js';
import {
	BaseHalfMarkdownRichDiskChangedError,
	BaseHalfMarkdownRichSession,
	IBaseHalfMarkdownRichDocument
} from '../../common/basehalfMarkdownRichSession.js';
import {
	BaseHalfMarkdownRichSaveRequestedMessage,
	BaseHalfMarkdownRichWebviewSaveCoordinator,
	IBaseHalfMarkdownRichSaveSender
} from '../../common/basehalfMarkdownRichWebviewSaveCoordinator.js';

const FRONTMATTER = '---\ntitle: Notes\n---\n';
const UPSTREAM_FRONTMATTER = '---\ntitle: Notes\nupstream:\n  - sources/book.pdf\n---\n';

suite('BaseHalfMarkdownRichTextModelDisk', () => {
	test('reads from the current VS Code text model working copy', async () => {
		const model = new TestTextModel('Alpha\n');
		const textFileService = new TestTextFileService();
		const disk = new BaseHalfMarkdownRichTextModelDisk(model, textFileService);

		assert.strictEqual(await disk.read(), 'Alpha\n');
		model.value = 'Source unsaved\n';
		assert.strictEqual(await disk.read(), 'Source unsaved\n');
		assert.deepStrictEqual(textFileService.saves, []);
	});

	test('writes through an undo-aware text model edit before saving', async () => {
		const model = new TestTextModel('Alpha\n');
		const textFileService = new TestTextFileService();
		model.onEdit = () => textFileService.dirty = true;
		textFileService.onSave = () => {
			assert.strictEqual(model.value, 'Beta\n');
		};

		const written = await new BaseHalfMarkdownRichTextModelDisk(model, textFileService).write('Beta\n');

		assert.strictEqual(written, 'Beta\n');
		assert.strictEqual(model.value, 'Beta\n');
		assert.deepStrictEqual(model.editTexts, ['Beta\n']);
		assert.deepStrictEqual(textFileService.saves.map(resource => resource.toString()), [model.uri.toString()]);
		assert.deepStrictEqual(textFileService.saveOptions, [{ ignoreErrorHandler: true }]);
		assert.strictEqual(textFileService.dirty, false);
	});

	test('edits only the changed range, so a body save never rewrites the frontmatter', async () => {
		const model = new TestTextModel(`${UPSTREAM_FRONTMATTER}Alpha\n\nBeta\n`);
		const textFileService = new TestTextFileService();

		await new BaseHalfMarkdownRichTextModelDisk(model, textFileService).write(`${UPSTREAM_FRONTMATTER}Alpha\n\nBeta typed\n`);

		assert.strictEqual(model.value, `${UPSTREAM_FRONTMATTER}Alpha\n\nBeta typed\n`);
		assert.deepStrictEqual(model.edits, [{ offset: `${UPSTREAM_FRONTMATTER}Alpha\n\nBeta`.length, length: 0, text: ' typed' }]);
	});

	test('refuses a compare-and-swap write when the model changed after it was read', async () => {
		const model = new TestTextModel(`${UPSTREAM_FRONTMATTER}Alpha\n`);
		const textFileService = new TestTextFileService();

		await assert.rejects(
			() => new BaseHalfMarkdownRichTextModelDisk(model, textFileService).write(`${FRONTMATTER}Alpha typed\n`, { expected: `${FRONTMATTER}Alpha\n` }),
			BaseHalfMarkdownRichDiskChangedError
		);

		assert.strictEqual(model.value, `${UPSTREAM_FRONTMATTER}Alpha\n`);
		assert.deepStrictEqual(model.edits, []);
		assert.deepStrictEqual(textFileService.saves, []);
	});

	test('brings written text to the model line ending instead of making a no-op edit', async () => {
		const model = new TestTextModel('---\r\nupstream: a.md\r\n---\r\nAlpha\r\n', '\r\n');
		const textFileService = new TestTextFileService();

		const unchanged = await new BaseHalfMarkdownRichTextModelDisk(model, textFileService).write('---\r\nupstream: a.md\r\n---\r\nAlpha\n');
		assert.strictEqual(unchanged, '---\r\nupstream: a.md\r\n---\r\nAlpha\r\n');
		assert.deepStrictEqual(model.edits, []);

		const written = await new BaseHalfMarkdownRichTextModelDisk(model, textFileService).write('---\r\nupstream: a.md\r\n---\r\nAlpha\nBeta\n');
		assert.strictEqual(written, '---\r\nupstream: a.md\r\n---\r\nAlpha\r\nBeta\r\n');
		assert.strictEqual(model.value, written);
	});

	test('saves an unchanged but dirty working copy without creating a synthetic edit', async () => {
		const model = new TestTextModel('Alpha\n');
		const textFileService = new TestTextFileService();
		textFileService.dirty = true;

		await new BaseHalfMarkdownRichTextModelDisk(model, textFileService).write('Alpha\n');

		assert.strictEqual(model.value, 'Alpha\n');
		assert.deepStrictEqual(model.editTexts, []);
		assert.deepStrictEqual(textFileService.saves.map(resource => resource.toString()), [model.uri.toString()]);
		assert.strictEqual(textFileService.dirty, false);
	});

	test('rejects readonly working copies before editing or saving', async () => {
		const model = new TestTextModel('Alpha\n');
		const textFileService = new TestTextFileService();
		textFileService.readonly = true;

		await assert.rejects(
			() => new BaseHalfMarkdownRichTextModelDisk(model, textFileService).write('Beta\n'),
			BaseHalfMarkdownRichTextModelReadonlyError
		);

		assert.strictEqual(model.value, 'Alpha\n');
		assert.deepStrictEqual(model.editTexts, []);
		assert.deepStrictEqual(textFileService.saves, []);
	});

	test('surfaces canceled saves and keeps the edited working copy dirty', async () => {
		const model = new TestTextModel('Alpha\n');
		const textFileService = new TestTextFileService();
		model.onEdit = () => textFileService.dirty = true;
		textFileService.cancel = true;

		await assert.rejects(
			() => new BaseHalfMarkdownRichTextModelDisk(model, textFileService).write('Beta\n'),
			BaseHalfMarkdownRichTextModelSaveCancelledError
		);

		assert.strictEqual(model.value, 'Beta\n');
		assert.deepStrictEqual(model.editTexts, ['Beta\n']);
		assert.strictEqual(textFileService.dirty, true);
	});

	test('surfaces a working copy that remains dirty after save', async () => {
		const model = new TestTextModel('Alpha\n');
		const textFileService = new TestTextFileService();
		model.onEdit = () => textFileService.dirty = true;
		textFileService.dirtyAfterSave = true;

		await assert.rejects(
			() => new BaseHalfMarkdownRichTextModelDisk(model, textFileService).write('Beta\n'),
			BaseHalfMarkdownRichTextModelDirtyAfterSaveError
		);

		assert.strictEqual(model.value, 'Beta\n');
		assert.strictEqual(textFileService.dirty, true);
	});

	test('rejects reads and writes after the model is disposed', async () => {
		const model = new TestTextModel('Alpha\n');
		const textFileService = new TestTextFileService();
		const disk = new BaseHalfMarkdownRichTextModelDisk(model, textFileService);
		model.disposed = true;

		await assert.rejects(() => disk.read(), BaseHalfMarkdownRichTextModelDisposedError);
		await assert.rejects(() => disk.write('Beta\n'), BaseHalfMarkdownRichTextModelDisposedError);
		assert.deepStrictEqual(textFileService.saves, []);
	});

	test('lets the rich session detect source-side working-copy drift as a conflict', async () => {
		const document = new TestRichDocument();
		const session = new BaseHalfMarkdownRichSession('workspace\u0000notes.md', new FakeMarkdownEditor(), document);
		await session.seedFromContent('Alpha\n');
		(document.blocks[0] as { markdown: string }).markdown = 'Rich local';
		session.markEdited();

		const model = new TestTextModel('Source unsaved\n');
		const textFileService = new TestTextFileService();
		const result = await session.save(new BaseHalfMarkdownRichTextModelDisk(model, textFileService));

		assert.deepStrictEqual(result, { kind: 'blockedByConflict', disk: 'Source unsaved\n' });
		assert.strictEqual(model.value, 'Source unsaved\n');
		assert.deepStrictEqual(textFileService.saves, []);
	});

	test('keeps a model frontmatter edit when a dirty rich session saves its body', async () => {
		const document = new TestRichDocument();
		const session = new BaseHalfMarkdownRichSession('workspace\u0000notes.md', new FakeMarkdownEditor(), document);
		await session.seedFromContent(`${FRONTMATTER}Alpha\n`);
		(document.blocks[0] as { markdown: string }).markdown = 'Rich local';
		session.markEdited();

		const model = new TestTextModel(`${UPSTREAM_FRONTMATTER}Alpha\n`);
		const textFileService = new TestTextFileService();
		const result = await session.save(new BaseHalfMarkdownRichTextModelDisk(model, textFileService));

		assert.deepStrictEqual(result, { kind: 'saved', content: `${UPSTREAM_FRONTMATTER}Rich local\n` });
		assert.strictEqual(model.value, `${UPSTREAM_FRONTMATTER}Rich local\n`);
		assert.ok(model.edits.every(edit => edit.offset >= UPSTREAM_FRONTMATTER.length), 'the edit must not touch the frontmatter');
		assert.strictEqual(session.snapshot.frontmatter, UPSTREAM_FRONTMATTER);
		assert.strictEqual(session.snapshot.conflict, false);
	});
});

suite('computeBaseHalfMarkdownRichTextEdit', () => {
	test('reduces a document update to its smallest replacement', () => {
		assert.deepStrictEqual(
			computeBaseHalfMarkdownRichTextEdit('first\n\nsecond\n', 'first changed\n\nsecond\n'),
			{ offset: 5, length: 0, text: ' changed' }
		);
		assert.deepStrictEqual(
			computeBaseHalfMarkdownRichTextEdit('重复重复', '重复新重复'),
			{ offset: 2, length: 0, text: '新' }
		);
		assert.strictEqual(computeBaseHalfMarkdownRichTextEdit('same', 'same'), undefined);
	});

	test('never splits a CRLF pair or a surrogate pair at a range boundary', () => {
		assert.deepStrictEqual(
			computeBaseHalfMarkdownRichTextEdit('a\r\nb', 'a\rX'),
			{ offset: 1, length: 3, text: '\rX' }
		);
		assert.deepStrictEqual(
			computeBaseHalfMarkdownRichTextEdit('a\r\nb', 'X\nb'),
			{ offset: 0, length: 3, text: 'X\n' }
		);
		assert.deepStrictEqual(
			computeBaseHalfMarkdownRichTextEdit('\u{1F600}', '\u{1F601}'),
			{ offset: 0, length: 2, text: '\u{1F601}' }
		);
	});

	test('applies the edit to the model and reports the resulting text', () => {
		const model = new TestTextModel('line one\nline two\n');
		assert.strictEqual(applyBaseHalfMarkdownRichTextModelContent(model, 'line one\nline 2\n'), 'line one\nline 2\n');
		assert.deepStrictEqual(model.edits, [{ offset: 14, length: 3, text: '2' }]);
	});
});

suite('BaseHalfMarkdownRichTextModelWriteGate', () => {
	test('handles a change at once when no rich write is in flight', () => {
		let replays = 0;
		const gate = new BaseHalfMarkdownRichTextModelWriteGate(() => replays++);

		assert.strictEqual(gate.writing, false);
		assert.strictEqual(gate.acceptChange(), true);
		assert.strictEqual(replays, 0);
	});

	test('queues changes made during nested writes and replays them once after the last write', async () => {
		let replays = 0;
		const gate = new BaseHalfMarkdownRichTextModelWriteGate(() => replays++);
		const outer = new Barrier();
		const inner = new Barrier();

		const first = gate.run(() => outer.wait());
		const second = gate.run(() => inner.wait());
		assert.strictEqual(gate.writing, true);
		assert.strictEqual(gate.acceptChange(), false);
		assert.strictEqual(gate.acceptChange(), false);

		inner.open();
		await second;
		assert.strictEqual(replays, 0, 'a write is still in flight');

		outer.open();
		await first;
		assert.strictEqual(replays, 1);
		assert.strictEqual(gate.writing, false);
	});

	test('replays after a failed write too', async () => {
		let replays = 0;
		const gate = new BaseHalfMarkdownRichTextModelWriteGate(() => replays++);

		await assert.rejects(() => gate.run(async () => {
			gate.acceptChange();
			throw new Error('save failed');
		}));
		assert.strictEqual(replays, 1);
	});

	test('forwards a model change made while a rich save is in flight after the save result', async () => {
		const model = new TestTextModel(`${FRONTMATTER}Alpha\n`);
		const textFileService = new TestTextFileService();
		const sender = new TestSender();
		const events: string[] = [];
		const forwarded: string[] = [];
		const gate = new BaseHalfMarkdownRichTextModelWriteGate(() => {
			events.push('replay');
			forwarded.push(model.getValue());
		});
		// The card detail's model listener: a change seen while the rich write
		// holds the gate is queued instead of dropped.
		model.onEdit = () => {
			textFileService.dirty = true;
			if (gate.acceptChange()) {
				forwarded.push(model.getValue());
			}
		};
		sender.onResult = result => events.push(`result:${result}`);
		// A reference operation edits the frontmatter while the working copy
		// save of the rich body is still running.
		textFileService.onSave = () => {
			model.replaceAll(model.getValue().replace(FRONTMATTER, UPSTREAM_FRONTMATTER));
		};

		await gate.run(() => new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(
			saveRequested({ body: 'Alpha typed\n', previousContent: `${FRONTMATTER}Alpha\n` }),
			new BaseHalfMarkdownRichTextModelDisk(model, textFileService),
			sender
		));

		assert.deepStrictEqual(events, ['result:saved', 'replay']);
		assert.deepStrictEqual(forwarded, [`${UPSTREAM_FRONTMATTER}Alpha typed\n`]);
	});
});

function saveRequested(overrides: Partial<BaseHalfMarkdownRichSaveRequestedMessage> = {}): BaseHalfMarkdownRichSaveRequestedMessage {
	return {
		type: 'basehalf.markdownRich.saveRequested',
		key: 'workspace\u0000notes.md',
		requestId: 'save-1',
		body: 'Alpha\n',
		previousContent: 'Alpha\n',
		forceWrite: false,
		...overrides
	};
}

class Barrier {
	private resolve: (() => void) | undefined;
	private readonly promise = new Promise<void>(resolve => this.resolve = resolve);

	wait(): Promise<void> {
		return this.promise;
	}

	open(): void {
		this.resolve?.();
	}
}

class TestTextModel implements IBaseHalfMarkdownRichTextModel {
	readonly uri = URI.file('/workspace/notes.md');
	readonly editTexts: string[] = [];
	readonly edits: Array<{ readonly offset: number; readonly length: number; readonly text: string }> = [];
	disposed = false;
	onEdit: (() => void) | undefined;

	constructor(public value: string, private readonly eol = '\n') { }

	getValue(): string {
		return this.value;
	}

	getEOL(): string {
		return this.eol;
	}

	getPositionAt(offset: number): IPosition {
		const lines = this.value.slice(0, offset).split(/\r\n|\r|\n/);
		return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 };
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	/** An edit that does not come from the rich projection. */
	replaceAll(value: string): void {
		this.value = value;
		this.onEdit?.();
	}

	pushEditOperations(
		beforeCursorState: Selection[] | null,
		editOperations: IIdentifiedSingleEditOperation[],
		cursorStateComputer: ICursorStateComputer
	): Selection[] | null {
		assert.strictEqual(beforeCursorState, null);
		assert.strictEqual(editOperations.length, 1);
		const range = editOperations[0].range;
		const start = this.offsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
		const end = this.offsetAt({ lineNumber: range.endLineNumber, column: range.endColumn });
		// A real text model brings inserted text to its own line ending.
		const text = (editOperations[0].text ?? '').replace(/\r\n|\r|\n/g, this.eol);
		this.value = this.value.slice(0, start) + text + this.value.slice(end);
		this.edits.push({ offset: start, length: end - start, text });
		this.editTexts.push(this.value);
		this.onEdit?.();
		return cursorStateComputer([]);
	}

	private offsetAt(position: IPosition): number {
		const lineBreak = /\r\n|\r|\n/g;
		let offset = 0;
		for (let line = 1; line < position.lineNumber; line++) {
			const match = lineBreak.exec(this.value);
			assert.ok(match, `line ${position.lineNumber} is outside the model`);
			offset = match.index + match[0].length;
		}
		return offset + position.column - 1;
	}
}

class TestTextFileService implements IBaseHalfMarkdownRichTextFileService {
	readonly saves: URI[] = [];
	readonly saveOptions: unknown[] = [];
	dirty = false;
	readonly = false;
	cancel = false;
	dirtyAfterSave = false;
	onSave: (() => void) | undefined;

	isDirty(_resource: URI): boolean {
		return this.dirty;
	}

	isReadonly(_resource: URI): boolean {
		return this.readonly;
	}

	async save(resource: URI, options?: unknown): Promise<URI | undefined> {
		this.saves.push(resource);
		this.saveOptions.push(options);
		this.onSave?.();
		if (this.cancel) {
			return undefined;
		}
		this.dirty = this.dirtyAfterSave;
		return resource;
	}
}

class TestSender implements IBaseHalfMarkdownRichSaveSender {
	onResult: ((result: string) => void) | undefined;

	async sendSaveResult(requestId: string, result: string): Promise<boolean> {
		this.onResult?.(result);
		return true;
	}
}

class TestRichDocument implements IBaseHalfMarkdownRichDocument {
	blocks: unknown[] = [];

	replaceBlocks(blocks: readonly unknown[]): void {
		this.blocks = [...blocks];
	}
}

class FakeMarkdownEditor {
	tryParseMarkdownToBlocks(markdown: string): unknown[] {
		return [{
			id: 'b0',
			type: 'paragraph',
			markdown: markdown.trimEnd(),
			content: [{ type: 'text', text: markdown.trimEnd() }]
		}];
	}

	blocksToMarkdownLossy(blocks: unknown[]): string {
		return blocks.map(block => (block as { markdown?: string }).markdown ?? '').join('\n');
	}
}
