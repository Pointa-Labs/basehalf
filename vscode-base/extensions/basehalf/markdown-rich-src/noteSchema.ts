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
	BASEHALF_NOTE_FILE_ICON_PATH,
	BASEHALF_NOTE_FILE_LINK_TITLE,
	BASEHALF_NOTE_HTML_ATTRIBUTES,
	BASEHALF_NOTE_HTML_TAGS,
	BASEHALF_NOTE_SPAN_STYLE,
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

const decoder = document.createElement('textarea');

/** Decodes character references once, as the page does. A textarea reads its text as text: no element is made, nothing loads. */
function decodeAsThePageDoes(text: string): string {
	decoder.innerHTML = text.replace(/</g, '&lt;');
	return decoder.value;
}

/** The folder of the open note, as an address this document can load. Relative addresses of a rendered block are read from it. */
export const renderedNote = { baseUri: '' };

/**
 * The rendered form of Markdown that the editor cannot edit (note rendering):
 * the elements and the text that the card shows for the same Markdown.
 */
function renderNoteMarkdown(source: string): DocumentFragment {
	// A span keeps its style in the one spelling the card keeps (note formats, rule 48), and no other element has one.
	dompurify.addHook('uponSanitizeAttribute', (node, data) => {
		if (data.attrName === 'style') {
			data.keepAttr = node.nodeName === 'SPAN' && BASEHALF_NOTE_SPAN_STYLE.test(data.attrValue);
		}
	});
	let rendered: DocumentFragment;
	try {
		rendered = dompurify.sanitize(baseHalfNoteMarkdownToHtml(source, { decodeCharacterReferences: decodeAsThePageDoes }), {
			ALLOWED_TAGS: [...BASEHALF_NOTE_HTML_TAGS],
			ALLOWED_ATTR: [...BASEHALF_NOTE_HTML_ATTRIBUTES, 'style'],
			RETURN_DOM_FRAGMENT: true,
		});
	} finally {
		dompurify.removeHook('uponSanitizeAttribute');
	}
	// A paragraph that is one link to a file shows as Rich's file block, and stays the link it is (rule 81).
	for (const link of Array.from(rendered.querySelectorAll(`a[title="${BASEHALF_NOTE_FILE_LINK_TITLE}"]`))) {
		const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		icon.setAttribute('class', 'bh-md-file-icon');
		icon.setAttribute('viewBox', '0 0 24 24');
		icon.setAttribute('fill', 'currentColor');
		icon.setAttribute('aria-hidden', 'true');
		const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		shape.setAttribute('d', BASEHALF_NOTE_FILE_ICON_PATH);
		icon.appendChild(shape);
		link.classList.add('bh-md-file');
		link.prepend(icon);
	}
	// No link and no picture shows a system tooltip (rule 57).
	for (const titled of Array.from(rendered.querySelectorAll('a[title], img[title]'))) {
		titled.removeAttribute('title');
	}
	// An input is shown only as a check box that cannot be changed.
	for (const input of Array.from(rendered.querySelectorAll('input'))) {
		if (input.getAttribute('type') === 'checkbox') {
			input.disabled = true;
		} else {
			input.replaceWith(document.createTextNode(input.outerHTML));
		}
	}
	for (const media of Array.from(rendered.querySelectorAll('img, video, audio, source'))) {
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

/**
 * A block's spec without props the note cannot store (note formats, rules 1
 * to 3): Rich offers no control for them, and a paste brings none of them.
 */
function withoutProps<T extends { readonly config: { readonly propSchema: object } }>(spec: T, names: readonly string[]): T {
	const propSchema = Object.fromEntries(Object.entries(spec.config.propSchema).filter(([name]) => !names.includes(name)));
	return { ...spec, config: { ...spec.config, propSchema } };
}

// The color of a block and the alignment of a paragraph or a picture: Markdown has no syntax for them.
const blockLook = ['textColor', 'backgroundColor', 'textAlignment'];

export const baseHalfNoteSchema = BlockNoteSchema.create({
	blockSpecs: {
		...defaultBlockSpecs,
		paragraph: withoutProps(defaultBlockSpecs.paragraph, blockLook),
		heading: withoutProps(defaultBlockSpecs.heading, blockLook),
		quote: withoutProps(defaultBlockSpecs.quote, blockLook),
		bulletListItem: withoutProps(defaultBlockSpecs.bulletListItem, blockLook),
		numberedListItem: withoutProps(defaultBlockSpecs.numberedListItem, blockLook),
		checkListItem: withoutProps(defaultBlockSpecs.checkListItem, blockLook),
		toggleListItem: withoutProps(defaultBlockSpecs.toggleListItem, blockLook),
		audio: withoutProps(ReactAudioBlock(), ['backgroundColor']),
		// A file's caption: the note stores a file as a link, which holds none.
		file: withoutProps(ReactFileBlock(), ['backgroundColor', 'caption']),
		image: withoutProps(ReactImageBlock(), ['backgroundColor', 'textAlignment']),
		video: withoutProps(ReactVideoBlock(), ['backgroundColor', 'textAlignment']),
		[BASEHALF_RAW_PASSTHROUGH_BLOCK]: rawPassthroughSpec,
	},
	styleSpecs: {
		...defaultStyleSpecs,
		code: codeBesideOtherMarks,
	},
});
