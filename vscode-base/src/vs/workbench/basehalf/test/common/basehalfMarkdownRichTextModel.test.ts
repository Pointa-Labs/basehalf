/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ICursorStateComputer, IIdentifiedSingleEditOperation } from '../../../../editor/common/model.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import {
	BaseHalfMarkdownRichTextModelDirtyAfterSaveError,
	BaseHalfMarkdownRichTextModelDisk,
	BaseHalfMarkdownRichTextModelDisposedError,
	BaseHalfMarkdownRichTextModelReadonlyError,
	BaseHalfMarkdownRichTextModelSaveCancelledError,
	IBaseHalfMarkdownRichTextFileService,
	IBaseHalfMarkdownRichTextModel
} from '../../common/basehalfMarkdownRichTextModel.js';
import { BaseHalfMarkdownRichSession, IBaseHalfMarkdownRichDocument } from '../../common/basehalfMarkdownRichSession.js';

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

		await new BaseHalfMarkdownRichTextModelDisk(model, textFileService).write('Beta\n');

		assert.strictEqual(model.value, 'Beta\n');
		assert.deepStrictEqual(model.editTexts, ['Beta\n']);
		assert.deepStrictEqual(textFileService.saves.map(resource => resource.toString()), [model.uri.toString()]);
		assert.strictEqual(textFileService.dirty, false);
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
});

class TestTextModel implements IBaseHalfMarkdownRichTextModel {
	readonly uri = URI.file('/workspace/notes.md');
	readonly editTexts: string[] = [];
	disposed = false;
	onEdit: (() => void) | undefined;

	constructor(public value: string) { }

	getValue(): string {
		return this.value;
	}

	getFullModelRange(): IRange {
		const lines = this.value.split(/\r\n|\r|\n/);
		return {
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: lines.length,
			endColumn: lines[lines.length - 1].length + 1
		};
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	pushEditOperations(
		beforeCursorState: Selection[] | null,
		editOperations: IIdentifiedSingleEditOperation[],
		cursorStateComputer: ICursorStateComputer
	): Selection[] | null {
		assert.strictEqual(beforeCursorState, null);
		assert.strictEqual(editOperations.length, 1);
		assert.deepStrictEqual(editOperations[0].range, this.getFullModelRange());
		this.value = editOperations[0].text ?? '';
		this.editTexts.push(this.value);
		this.onEdit?.();
		return cursorStateComputer([]);
	}
}

class TestTextFileService implements IBaseHalfMarkdownRichTextFileService {
	readonly saves: URI[] = [];
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

	async save(resource: URI): Promise<URI | undefined> {
		this.saves.push(resource);
		this.onSave?.();
		if (this.cancel) {
			return undefined;
		}
		this.dirty = this.dirtyAfterSave;
		return resource;
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
