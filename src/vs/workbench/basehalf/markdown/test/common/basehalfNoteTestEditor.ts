/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { type Token, type Tokens } from '../../../../../base/common/marked/marked.js';
import { IBaseHalfMarkdownEditorApi, IBaseHalfNoteReadContext } from '../../common/basehalfMarkdownProjection.js';
import { baseHalfCardLexer, IBaseHalfNoteLink, IBaseHalfNoteStyledText, IBaseHalfNoteTextStyles } from '../../common/basehalfNoteInline.js';
import { decodeBaseHalfSmallCharacterReferences } from '../../common/basehalfNoteMarkdownText.js';
import { baseHalfNoteListHints, postProcessBaseHalfNoteBlocks } from '../../common/basehalfNoteStructure.js';
import { IBaseHalfNoteWriteHints, writeBaseHalfNoteBlock } from '../../common/basehalfNoteWriter.js';

/**
 * Rich's reader and writer for tests in Node, where no page parses HTML: the
 * card's Markdown reader turned into the editor's block JSON for the
 * paragraphs, headings, lists, quotes, code, and rules of the tests, through
 * the reader's real block pass, and the real writer.
 */
export class BaseHalfNoteTestEditor implements IBaseHalfMarkdownEditorApi {
	private nextId = 1;
	private nextFixedId = 1;
	/** How often the writer ran. */
	writes = 0;

	constructor(private readonly options: {
		/** A part of a note whose reading throws. */
		readonly failRead?: (markdown: string) => boolean;
		/** A block whose writing throws. */
		readonly failWrite?: (block: unknown) => boolean;
	} = {}) { }

	tryParseMarkdownToBlocks(markdown: string, context: IBaseHalfNoteReadContext): unknown[] {
		if (this.options.failRead?.(markdown)) {
			throw new Error('cannot read');
		}
		const tokens = baseHalfCardLexer(context.definitions).lex(markdown);
		const blocks = this.blocksOf(tokens);
		// Whether each `<details>` is open, in order, as the reader's repair finds them.
		const openFlags = tokens.filter(token => token.type === 'html').flatMap(token => [...token.raw.matchAll(/<details(\s[^>]*)?>/gi)].map(match => /\bopen\b/i.test(match[1] ?? '')));
		return postProcessBaseHalfNoteBlocks(blocks, { mode: 'markdown', openFlags, listHints: baseHalfNoteListHints(tokens), source: markdown });
	}

	writeBlock(block: unknown, hints: IBaseHalfNoteWriteHints): string {
		this.writes++;
		if (this.options.failWrite?.(block)) {
			throw new Error('cannot write');
		}
		return writeBaseHalfNoteBlock(block, hints);
	}

	decodeCharacterReferences(text: string): string {
		return decodeBaseHalfSmallCharacterReferences(text);
	}

	newBlockId(): string {
		return `fixed-${this.nextFixedId++}`;
	}

	private blocksOf(tokens: readonly Token[]): unknown[] {
		const blocks: unknown[] = [];
		for (const token of tokens) {
			switch (token.type) {
				case 'space':
					break;
				case 'heading':
					blocks.push(this.block('heading', { level: (token as Tokens.Heading).depth, isToggleable: false }, inline((token as Tokens.Heading).tokens)));
					break;
				case 'paragraph':
					blocks.push(this.block('paragraph', {}, inline((token as Tokens.Paragraph).tokens)));
					break;
				case 'code':
					blocks.push(this.block('codeBlock', { language: (token as Tokens.Code).lang ?? '' }, [{ type: 'text', text: (token as Tokens.Code).text, styles: {} }]));
					break;
				case 'hr':
					blocks.push(this.block('divider', {}, undefined));
					break;
				case 'blockquote': {
					const inner = (token as Tokens.Blockquote).tokens.filter(one => one.type !== 'space');
					const first = inner[0] as Tokens.Paragraph | undefined;
					blocks.push(this.block('quote', {}, first?.tokens ? inline(first.tokens) : []));
					break;
				}
				case 'list': {
					const list = token as Tokens.List;
					list.items.forEach((item, index) => {
						const type = item.task ? 'checkListItem' : list.ordered ? 'numberedListItem' : 'bulletListItem';
						const props: Record<string, unknown> = item.task ? { checked: !!item.checked } : {};
						if (list.ordered && index === 0 && typeof list.start === 'number' && list.start !== 1) {
							props.start = list.start;
						}
						const [first, ...rest] = item.tokens.filter(one => one.type !== 'space' && one.type !== 'checkbox');
						const text = first && (first.type === 'text' || first.type === 'paragraph') ? first as Tokens.Text : undefined;
						blocks.push(this.block(type, props, text ? inline(text.tokens ?? [text]) : [], this.blocksOf(text ? rest : [first, ...rest].filter(Boolean))));
					});
					break;
				}
				case 'html': {
					// A toggle as a page reads it: a `<details>` and its `<summary>`, closed or not, without a body.
					const toggle = /^\s*<details(?:\s+open)?\s*>\s*<summary>(?:<h([1-6])>)?([\s\S]*?)(?:<\/h[1-6]>)?<\/summary>\s*(?:<\/details>\s*)?$/i.exec(token.raw);
					if (toggle) {
						const title = [{ type: 'text', text: decodeBaseHalfSmallCharacterReferences(toggle[2]), styles: {} }];
						blocks.push(toggle[1]
							? this.block('heading', { level: Number(toggle[1]), isToggleable: true }, title)
							: this.block('toggleListItem', {}, title));
						break;
					}
					blocks.push(this.block('paragraph', {}, [{ type: 'text', text: token.raw.trimEnd(), styles: {} }]));
					break;
				}
				default:
					blocks.push(this.block('paragraph', {}, [{ type: 'text', text: token.raw.trimEnd(), styles: {} }]));
			}
		}
		return blocks;
	}

	private block(type: string, props: Record<string, unknown>, content: unknown, children: unknown[] = []): unknown {
		return { id: `b${this.nextId++}`, type, props, ...(content !== undefined ? { content } : {}), children };
	}
}

type InlineRun = IBaseHalfNoteStyledText | IBaseHalfNoteLink;

function inline(tokens: readonly Token[]): InlineRun[] {
	const out: InlineRun[] = [];
	addInline(tokens, {}, out, { underline: false });
	return out;
}

function addInline(tokens: readonly Token[], styles: IBaseHalfNoteTextStyles, out: InlineRun[], state: { underline: boolean }): void {
	const add = (text: string, own: IBaseHalfNoteTextStyles) => {
		const all = state.underline ? { ...own, underline: true } : own;
		const last = out[out.length - 1];
		if (last?.type === 'text' && JSON.stringify(last.styles ?? {}) === JSON.stringify(all)) {
			out[out.length - 1] = { ...last, text: last.text + text };
		} else if (text !== '') {
			out.push({ type: 'text', text, styles: all });
		}
	};
	for (const token of tokens) {
		switch (token.type) {
			case 'text': {
				const text = token as Tokens.Text;
				if (text.tokens && text.tokens.length > 0) {
					addInline(text.tokens, styles, out, state);
				} else {
					add(decodeBaseHalfSmallCharacterReferences(text.text), styles);
				}
				break;
			}
			case 'escape':
				add((token as Tokens.Escape).text, styles);
				break;
			case 'strong':
				addInline((token as Tokens.Strong).tokens, { ...styles, bold: true }, out, state);
				break;
			case 'em':
				addInline((token as Tokens.Em).tokens, { ...styles, italic: true }, out, state);
				break;
			case 'del':
				addInline((token as Tokens.Del).tokens, { ...styles, strike: true }, out, state);
				break;
			case 'codespan':
				add(decodeBaseHalfSmallCharacterReferences((token as Tokens.Codespan).text), { ...styles, code: true });
				break;
			case 'br':
				add('\n', styles);
				break;
			case 'link': {
				const content: InlineRun[] = [];
				addInline((token as Tokens.Link).tokens, styles, content, state);
				out.push({ type: 'link', href: (token as Tokens.Link).href, content: content.filter((run): run is IBaseHalfNoteStyledText => run.type === 'text') });
				break;
			}
			case 'html': {
				const tag = token.raw.toLowerCase();
				if (tag === '<u>' || tag === '</u>') {
					state.underline = tag === '<u>';
				} else {
					add(token.raw, styles);
				}
				break;
			}
			default:
				add(token.raw, styles);
		}
	}
}
