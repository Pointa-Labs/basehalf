/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The blocks of a note in Rich, apart from the editor that shows them, so that
// Rich's bundle test builds its editor from the same schema. Importing this
// module draws nothing.

import { BlockNoteSchema, createBlockSpec, createStyleSpecFromTipTapMark, defaultBlockSpecs, defaultStyleSpecs } from '@blocknote/core';
import { ReactAudioBlock, ReactFileBlock, ReactImageBlock, ReactVideoBlock } from '@blocknote/react';
import { BASEHALF_RAW_PASSTHROUGH_BLOCK } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownProjection.js';
import {
	BASEHALF_NOTE_HTML_ATTRIBUTES,
	BASEHALF_NOTE_HTML_TAGS,
	baseHalfNoteMarkdownToHtml,
} from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteMarkdownHtml.js';
import dompurify from '../../../src/vs/base/browser/dompurify/dompurify.js';

export function baseHalfEditorLabel(english: string, simplifiedChinese: string, traditionalChinese = simplifiedChinese): string {
	const locale = document.documentElement.lang.toLowerCase();
	return locale.startsWith('zh-tw') || locale.startsWith('zh-hk')
		? traditionalChinese
		: locale.startsWith('zh') ? simplifiedChinese : english;
}

interface PassthroughProps {
	raw?: string;
	source?: string;
	hidden?: boolean;
}

/** The folder of the open note, as an address this document can load. Relative addresses of a rendered block are read from it. */
export const renderedNote = { baseUri: '' };

/**
 * The rendered form of Markdown that the editor cannot edit (note rendering):
 * the elements and the text that the card shows for the same Markdown.
 */
function renderNoteMarkdown(source: string): DocumentFragment {
	const rendered = dompurify.sanitize(baseHalfNoteMarkdownToHtml(source), {
		ALLOWED_TAGS: [...BASEHALF_NOTE_HTML_TAGS],
		ALLOWED_ATTR: [...BASEHALF_NOTE_HTML_ATTRIBUTES],
		RETURN_DOM_FRAGMENT: true,
	});
	// An input is shown only as a check box that cannot be changed.
	for (const input of Array.from(rendered.querySelectorAll('input'))) {
		if (input.getAttribute('type') === 'checkbox') {
			input.disabled = true;
		} else {
			input.replaceWith(document.createTextNode(input.outerHTML));
		}
	}
	for (const media of Array.from(rendered.querySelectorAll('img, video, source'))) {
		const address = media.getAttribute('src');
		if (address && renderedNote.baseUri && !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(address)) {
			try {
				media.setAttribute('src', new URL(address, renderedNote.baseUri).toString());
			} catch {
				// An address that cannot be read stays as the author wrote it.
			}
		}
	}
	return rendered;
}

const rawPassthroughSpec = createBlockSpec(
	{
		type: BASEHALF_RAW_PASSTHROUGH_BLOCK,
		propSchema: {
			raw: { default: '' },
			source: { default: '' },
			hidden: { default: false },
		},
		content: 'none',
	},
	{
		render: block => {
			const props = block.props as PassthroughProps;
			if (props.hidden) {
				const hidden = document.createElement('span');
				hidden.setAttribute('data-basehalf-raw-passthrough', 'hidden');
				hidden.style.display = 'none';
				return { dom: hidden };
			}

			const dom = document.createElement('div');
			dom.className = 'basehalf-raw-passthrough';
			dom.setAttribute('data-basehalf-raw-passthrough', '');

			// The block is read here as it is read on the card: rendered.
			const rendered = document.createElement('div');
			rendered.className = 'basehalf-raw-passthrough-rendered';
			rendered.appendChild(renderNoteMarkdown((props.source ?? props.raw ?? '').replace(/^\n+|\n+$/g, '')));
			dom.appendChild(rendered);

			// This block holds Markdown the rich projection cannot edit; the
			// escape hatch jumps to the source projection at its lines.
			const edit = document.createElement('button');
			edit.type = 'button';
			edit.className = 'basehalf-raw-passthrough-edit';
			edit.textContent = baseHalfEditorLabel('Edit in source', '在源码中编辑', '在原始碼中編輯');
			dom.appendChild(edit);
			return { dom };
		},
		toExternalHTML: block => {
			const props = block.props as PassthroughProps;
			const pre = document.createElement('pre');
			pre.textContent = props.source ?? props.raw ?? '';
			return { dom: pre };
		},
	},
)();

/**
 * Code beside bold, italic, strikethrough, underline, a color, and a link, as
 * the card shows `**a `b`**` (note formats, rule 25): the editor's own code
 * mark excludes every other mark, so Rich would read the code of a bold
 * sentence without its bold, and a link's code outside the link.
 */
const codeBesideOtherMarks = createStyleSpecFromTipTapMark(defaultStyleSpecs.code.implementation.mark.extend({ excludes: 'code' }), 'boolean');

export const baseHalfNoteSchema = BlockNoteSchema.create({
	blockSpecs: {
		...defaultBlockSpecs,
		audio: ReactAudioBlock(),
		file: ReactFileBlock(),
		image: ReactImageBlock(),
		video: ReactVideoBlock(),
		[BASEHALF_RAW_PASSTHROUGH_BLOCK]: rawPassthroughSpec,
	},
	styleSpecs: {
		...defaultStyleSpecs,
		code: codeBesideOtherMarks,
	},
});
