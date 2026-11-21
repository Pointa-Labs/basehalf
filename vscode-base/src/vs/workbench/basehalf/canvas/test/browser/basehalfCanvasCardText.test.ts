/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileOperationError, FileOperationResult } from '../../../../../platform/files/common/files.js';
import { IReadTextFileOptions, ITextFileContent, ITextFileService, TextFileOperationError, TextFileOperationResult } from '../../../../services/textfile/common/textfiles.js';
import { BASEHALF_CARD_EXCERPT_READ_BYTES, baseHalfReadCardText } from '../../browser/basehalfCanvasCardText.js';

suite('BaseHalf canvas card text', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const resource = URI.file('/workspace/a.txt');

	/** A text file service that answers a read with `answer` and keeps what it was asked. */
	function service(answer: { readonly value: string; readonly size: number } | Error, heldEncoding?: string) {
		const asked: IReadTextFileOptions[] = [];
		const fake = {
			files: { get: () => heldEncoding ? { getEncoding: () => heldEncoding } : undefined },
			read: async (_resource: URI, options?: IReadTextFileOptions) => {
				asked.push(options ?? {});
				if (answer instanceof Error) {
					throw answer;
				}
				return answer as Partial<ITextFileContent> as ITextFileContent;
			}
		};
		return { asked, service: fake as unknown as Pick<ITextFileService, 'read' | 'files'> };
	}

	test('an excerpt asks for the head of the file as text, a note for the whole file up to its limit, and both in the encoding the window holds', async () => {
		const excerpt = service({ value: '第一行\n', size: 20_000 });
		const short = service({ value: 'x\n', size: 2 });
		const note = service({ value: '# 标题\n', size: 9 }, 'gbk');
		assert.deepStrictEqual({
			excerpt: [await baseHalfReadCardText(excerpt.service, resource, undefined), excerpt.asked],
			short: await baseHalfReadCardText(short.service, resource, undefined),
			note: [await baseHalfReadCardText(note.service, resource, 1_048_576), note.asked]
		}, {
			excerpt: [{ text: '第一行\n', wholeFile: false }, [{ length: BASEHALF_CARD_EXCERPT_READ_BYTES, acceptTextOnly: true }]],
			short: { text: 'x\n', wholeFile: true },
			note: [{ text: '# 标题\n', wholeFile: true }, [{ limits: { size: 1_048_576 }, acceptTextOnly: true, encoding: 'gbk' }]]
		});
	});

	test('a file that is not text is none, and another failure stays a failure', async () => {
		const binary = service(new TextFileOperationError('binary', TextFileOperationResult.FILE_IS_BINARY));
		const nul = service({ value: 'a\u0000b', size: 3 });
		const tooLarge = service(new FileOperationError('too large', FileOperationResult.FILE_TOO_LARGE));
		assert.deepStrictEqual({
			binary: await baseHalfReadCardText(binary.service, resource, undefined),
			nul: await baseHalfReadCardText(nul.service, resource, undefined),
			tooLarge: await baseHalfReadCardText(tooLarge.service, resource, 1_048_576).then(() => 'read', error => (error as FileOperationError).fileOperationResult)
		}, {
			binary: undefined,
			nul: undefined,
			tooLarge: FileOperationResult.FILE_TOO_LARGE
		});
	});
});
