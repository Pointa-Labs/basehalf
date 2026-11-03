/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import, so it imports nothing.
//
// Text that a note stores reads back through `marked`, the card's reader,
// with tables, strikethrough, and bare addresses read, and single line breaks
// as breaks. Every escape written here is one that this reader reads back as
// the plain character, so typed text stays text (note formats, rule 15).

// --- Text in Markdown

/** Where a run of text stands in the Markdown that a block writes. */
export interface IBaseHalfMarkdownTextContext {
	/**
	 * What the text is written in. In a paragraph, which is also the text of
	 * a quote and of a list item, a line break is a backslash at the end of
	 * the line; in a heading and in a table cell it is `<br>` (note formats,
	 * rule 16). Default: a paragraph.
	 */
	readonly block?: 'paragraph' | 'heading' | 'tableCell';
	/**
	 * The text starts a line of its block: the first line of a paragraph, of
	 * a quote, or of a list item's text, where a heading, a quote, a list, a
	 * rule, a table, or HTML could start. Every line after a line break in the
	 * text starts a line too. Default: true.
	 */
	readonly lineStart?: boolean;
	/** The text starts the text of a bullet or numbered list item, where `[ ]` and `[x]` would read as a check box. */
	readonly listItemStart?: boolean;
	/**
	 * The text is in a link's label. `marked` drops the backslash of `\[` and
	 * `\]` before it reads a label, so a bracket there is a character
	 * reference; a lone backtick or a backslash break would end the label, so
	 * every backtick is escaped and a line break is `<br>`; and an address is
	 * not linked in a label, so it needs no escape.
	 */
	readonly inLink?: boolean;
	/**
	 * The labels of the note's reference definitions, as `marked` keys them:
	 * in lower case, each run of white space as one space. A bracket pair
	 * around one of them would read as a link.
	 */
	readonly referenceLabels?: ReadonlySet<string>;
	/** The character written just before the text on its line, if any. */
	readonly before?: string;
	/** The character written just after the text on its line; `undefined` when the line ends with the text. */
	readonly after?: string;
	/**
	 * The characters of the whole block that this text's can pair with: its
	 * text, and the characters its code and link addresses write, since the
	 * reader pairs a `~` of strikethrough with one in code, and a backtick,
	 * `*`, or `_` with one in an address it does not mask. A `*`, `~`,
	 * backtick, or `_` is escaped when they hold two or more of it, since only
	 * then can it pair with another into markup. Default: the text alone.
	 */
	readonly blockText?: string;
	/**
	 * The delimiters the block's Markdown writes: `*` for `**` and `*`, `~`
	 * for `~~`, and a backtick for a code span. Every such character of the
	 * text is escaped, since it could pair with a delimiter. Default: none.
	 */
	readonly blockDelimiters?: string;
	/**
	 * Escapes every character of `` \`*_{}[]()#+-.!~|> `` with a backslash
	 * as well: the form of last resort for a line that no other form reads
	 * back the same (note formats, "Failure and recovery").
	 */
	readonly escapeAll?: boolean;
}

const punctuationOrSymbol = /^[\p{P}\p{S}]$/u;
const letterOrDigit = /^[\p{L}\p{N}]$/u;
// White space that this module writes as it is elsewhere, but that `marked`
// trims off the end of a list's last item, where it would come back as a
// paragraph of its own, and after which it reads no backslash as a line
// break, as at the end of a block.
const spaceTrimmedAtEnd = /^[\v\f\u{1680}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}\u{feff}]$/u;
const escapedByEscapeAll: ReadonlySet<string> = new Set(Array.from('\\`*_{}[]()#+-.!~|>'));

// Matched where a character stands (`y`), in the text followed by the
// character written after it.
const characterReferenceAhead = /&#?[A-Za-z0-9]+;/y;
const tagStartAhead = /<[A-Za-z/!?]/y;
// An e-mail address in angle brackets, as `marked` reads one.
const emailAutolinkAhead = /<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])>/y;
// What `marked` links in text: a host after `http://`, `https://`, or
// `ftp://`, a name after `www.`, and the domain of an e-mail address.
const schemeHostAhead = /\/\/[a-zA-Z0-9-]/y;
const wwwNameAhead = /[a-zA-Z0-9-]/y;
const emailDomainAhead = /[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]*[a-zA-Z0-9])+(?![-_])/y;
const linkedScheme = /(?:https?|ftp)$/i;
const linkedWww = /www$/i;
const emailLocalCharacter = /^[A-Za-z0-9._+-]$/;

function matchesAt(pattern: RegExp, subject: string, index: number): boolean {
	pattern.lastIndex = index;
	return pattern.test(subject);
}

interface ITextToEscape {
	readonly context: IBaseHalfMarkdownTextContext;
	readonly characters: readonly string[];
	/** The UTF-16 offset of each character in `subject`. */
	readonly offsets: readonly number[];
	/** The text followed by the character written after it. */
	readonly subject: string;
	readonly paragraph: boolean;
	readonly inLink: boolean;
	readonly escapeAll: boolean;
	readonly stars: boolean;
	readonly tildes: boolean;
	readonly backticks: boolean;
	readonly underscores: boolean;
}

function holdsTwo(text: string, character: string): boolean {
	const first = text.indexOf(character);
	return first !== -1 && text.indexOf(character, first + 1) !== -1;
}

/**
 * The Markdown of typed text, escaped where a character would act as markup
 * (note formats, rule 15, and its design's escape tables): `\*`, `\_`, `\~`,
 * and a backtick where they could pair; `\#`, `\>`, a list marker, a rule, a
 * setext underline, and a table's separator row at the start of a line; a
 * `<` that would start a tag, a comment, or an address in angle brackets as
 * `&lt;`; `&` before a character reference as `&amp;`; a bracket pair that
 * would form a link; and the `:`, `.`, or `@` of a web or e-mail address
 * that `marked` would link as `&#58;`, `&#46;`, or `&#64;`. Brackets that
 * form no link, such as `[[My Note]]`, `Text[^1]`, and `[!NOTE]`, stay as
 * typed. A no-break space is `&nbsp;`, and a carriage return and a line or
 * paragraph separator, which the reader would take for line endings, are
 * character references, and so is other white space that ends the text where
 * the line ends, such as a full-width space, which the reader would trim.
 *
 * Leading white space of a line and white space at the end of a block are
 * not text Markdown can hold (note formats, L5); the caller drops them first.
 */
export function escapeBaseHalfMarkdownText(text: string, context: IBaseHalfMarkdownTextContext = {}): string {
	const characters = Array.from(text);
	const offsets: number[] = [];
	let offset = 0;
	for (const character of characters) {
		offsets.push(offset);
		offset += character.length;
	}
	const blockText = context.blockText ?? text;
	const delimiters = context.blockDelimiters ?? '';
	const state: ITextToEscape = {
		context,
		characters,
		offsets,
		subject: text + (context.after ?? ''),
		paragraph: (context.block ?? 'paragraph') === 'paragraph',
		inLink: context.inLink === true,
		escapeAll: context.escapeAll === true,
		stars: delimiters.includes('*') || holdsTwo(blockText, '*'),
		tildes: delimiters.includes('~') || holdsTwo(blockText, '~'),
		backticks: delimiters.includes('`') || holdsTwo(blockText, '`'),
		underscores: holdsTwo(blockText, '_')
	};
	const written = characters.map((character, index) => escapedCharacter(state, character, index));
	escapeLineStarts(state, written);
	escapeBackslashes(state, written);
	escapeBrackets(state, written);
	return written.join('');
}

/** A character's written form, except a backslash and a bracket, which depend on their neighbours. */
function escapedCharacter(state: ITextToEscape, character: string, index: number): string {
	const { context, characters, subject, offsets } = state;
	const last = index === characters.length - 1;
	switch (character) {
		case '\\': case '[': case ']':
			return character;
		case '\n':
			// A backslash break would end a link's label, so a link holds `<br>`.
			return state.paragraph && !state.inLink ? '\\\n' : '<br>';
		case '\r':
			return '&#13;';
		case '\u00a0':
			return '&nbsp;';
		case '\u2028':
			return '&#8232;';
		case '\u2029':
			return '&#8233;';
		case '<':
			return matchesAt(tagStartAhead, subject, offsets[index]) || matchesAt(emailAutolinkAhead, subject, offsets[index]) ? '&lt;' : '<';
		case '&':
			return matchesAt(characterReferenceAhead, subject, offsets[index]) ? '&amp;' : '&';
	}
	if (state.escapeAll && escapedByEscapeAll.has(character)) {
		return `\\${character}`;
	}
	if (last && context.after === undefined && spaceTrimmedAtEnd.test(character)) {
		// A character reference is no white space to the reader, so the block
		// keeps its last character, and a line break before it stays one.
		return `&#${character.codePointAt(0)};`;
	}
	// `marked` reads a run of backticks and tildes as one piece of text, so a
	// last `~` or backtick would swallow the opening of a code span or of a
	// strikethrough written after it.
	const joinsMarkupAfter = last && (character === '~' || character === '`') && (context.after === '~' || context.after === '`');
	switch (character) {
		case '*':
			return state.stars ? '\\*' : '*';
		case '~':
			return state.tildes || joinsMarkupAfter ? '\\~' : '~';
		case '`':
			return state.backticks || state.inLink || joinsMarkupAfter ? '\\`' : '`';
		case '_': {
			// `_` between two letters or digits neither opens nor closes.
			const previous = index > 0 ? characters[index - 1] : context.before;
			const next = last ? context.after : characters[index + 1];
			const inWord = letterOrDigit.test(previous ?? '') && letterOrDigit.test(next ?? '');
			return state.underscores && !inWord ? '\\_' : '_';
		}
		case '|':
			return context.block === 'tableCell' ? '\\|' : '|';
		case '#':
			// A heading's final `#` would read as its closing sequence.
			return context.block === 'heading' && last && context.after === undefined ? '\\#' : '#';
		case '!':
			// Before a link, `!` would make it a picture.
			return last && context.after === '[' ? '\\!' : '!';
		case ':':
			return !state.inLink && linkedScheme.test(preceding(characters, index, 5)) && matchesAt(schemeHostAhead, subject, offsets[index] + 1) ? '&#58;' : ':';
		case '.':
			return !state.inLink && linkedWww.test(preceding(characters, index, 3)) && matchesAt(wwwNameAhead, subject, offsets[index] + 1) ? '&#46;' : '.';
		case '@':
			return !state.inLink && index > 0 && emailLocalCharacter.test(characters[index - 1]) && matchesAt(emailDomainAhead, subject, offsets[index] + 1) ? '&#64;' : '@';
	}
	return character;
}

function preceding(characters: readonly string[], index: number, count: number): string {
	return characters.slice(Math.max(0, index - count), index).join('');
}

/**
 * At the start of a line of a paragraph, Markdown reads a heading, a quote,
 * a list item, a rule, a setext underline, or a table's separator row. The
 * first character that makes it so is escaped.
 */
function escapeLineStarts(state: ITextToEscape, written: string[]): void {
	if (!state.paragraph || state.inLink) {
		return;
	}
	const { characters, context } = state;
	const starts = context.lineStart === false ? [] : [0];
	characters.forEach((character, index) => {
		if (character === '\n') {
			starts.push(index + 1);
		}
	});
	for (const start of starts) {
		let first = start;
		while (first < characters.length && (characters[first] === ' ' || characters[first] === '\t')) {
			first++;
		}
		let end = first;
		while (end < characters.length && characters[end] !== '\n') {
			end++;
		}
		if (end === first) {
			continue;
		}
		// Past the text, the line goes on with what is written after it.
		const endsLine = end < characters.length || context.after === undefined;
		const at = lineStartEscape(characters.slice(first, end).join(''), endsLine);
		if (at !== -1) {
			written[first + at] = `\\${characters[first + at]}`;
		}
	}
}

/** The index in `line` of the character to escape, or -1. Every such index lies in an ASCII prefix of the line. */
function lineStartEscape(line: string, endsLine: boolean): number {
	// Whether the construct's marker of `length` characters is followed by a
	// space or a tab, or by the end of the line.
	const markerEnds = (length: number) => length === line.length ? endsLine : line[length] === ' ' || line[length] === '\t';
	const heading = /^#{1,6}/.exec(line);
	if (heading && markerEnds(heading[0].length)) {
		return 0;
	}
	if (line[0] === '>') {
		return 0;
	}
	if ((line[0] === '-' || line[0] === '+' || line[0] === '*') && markerEnds(1)) {
		return 0;
	}
	const ordered = /^\d{1,9}[.)]/.exec(line);
	if (ordered && markerEnds(ordered[0].length)) {
		return ordered[0].length - 1;
	}
	// A rule of `-`, a setext underline, and a table's separator row fill
	// their line with `-` or `=`, and a separator row with `|` and `:` too.
	if (endsLine && (/^=+[ \t]*$/.test(line) || (/^[-|:][-|: \t]*$/.test(line) && line.includes('-')))) {
		return 0;
	}
	return -1;
}

/**
 * A backslash before ASCII punctuation, or at the end of a line, would
 * escape it or break the line, so it is doubled there. It is doubled before
 * any other punctuation or symbol too: `marked` takes a backslash and such a
 * character for an escape when it pairs emphasis, which miscounts the
 * offsets of what follows when the character lies beyond the first plane, as
 * an emoji does. The written form of the next character decides: a no-break
 * space is `&nbsp;`, and `\&` would read as an escaped `&`.
 */
function escapeBackslashes(state: ITextToEscape, written: string[]): void {
	const { characters, context } = state;
	characters.forEach((character, index) => {
		if (character !== '\\') {
			return;
		}
		const nextWritten = index + 1 < characters.length ? written[index + 1] : context.after;
		const next = nextWritten === undefined ? undefined : String.fromCodePoint(nextWritten.codePointAt(0) ?? 0);
		const doubled = state.escapeAll || next === undefined || next === '\n' || punctuationOrSymbol.test(next);
		written[index] = doubled ? '\\\\' : '\\';
	});
}

/**
 * A bracket pair is escaped where it would form a link: when its `]` is
 * followed by `(`, `[`, or `:`, and when it holds a reference label of the
 * note. In a link's label every bracket is a character reference, and the
 * `[` of a list item's text that starts as a check box is escaped.
 */
function escapeBrackets(state: ITextToEscape, written: string[]): void {
	const { characters, context } = state;
	if (state.inLink) {
		characters.forEach((character, index) => {
			if (character === '[' || character === ']') {
				written[index] = character === '[' ? '&#91;' : '&#93;';
			}
		});
		return;
	}
	const escaped = new Set<number>();
	const pairs: [number, number][] = [];
	const startOfPair = new Map<number, number>();
	const open: number[] = [];
	characters.forEach((character, index) => {
		if (character === '[') {
			open.push(index);
		} else if (character === ']') {
			const start = open.pop();
			if (start !== undefined) {
				pairs.push([start, index]);
				startOfPair.set(index, start);
			}
		}
	});
	characters.forEach((character, index) => {
		if (state.escapeAll && (character === '[' || character === ']')) {
			escaped.add(index);
		}
		if (character === ']') {
			const next = index + 1 < characters.length ? characters[index + 1] : context.after;
			if (next === '(' || next === '[' || next === ':') {
				escaped.add(index);
				const start = startOfPair.get(index);
				if (start !== undefined) {
					escaped.add(start);
				}
			}
		}
	});
	if (context.listItemStart && /^\[[ xX]\]/.test(characters.slice(0, 3).join(''))) {
		escaped.add(0);
	}
	const labels = context.referenceLabels;
	if (labels && labels.size > 0) {
		for (const [start, end] of pairs) {
			const inner = characters.slice(start + 1, end);
			if (escaped.has(start) || escaped.has(end) || inner.includes('[') || inner.includes(']')) {
				continue;
			}
			// `marked` looks a label up by the text it reads between the brackets.
			const label = written.slice(start + 1, end).join('').replace(/\s+/g, ' ').toLowerCase();
			if (labels.has(label)) {
				escaped.add(start);
				escaped.add(end);
			}
		}
	}
	for (const index of escaped) {
		written[index] = `\\${characters[index]}`;
	}
}

// --- Text in HTML

const htmlTextEscapes: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\u00a0': '&nbsp;', '\n': '<br>', '\r': '&#13;' };

/**
 * Text written inside HTML: a toggle's title and a caption (note formats,
 * rules 12, 16, and 38). `&`, `<`, `>`, and a no-break space are character
 * references, and a line break is `<br>`, since a blank line would end the
 * HTML. Markdown does not act inside HTML, so nothing else is escaped.
 */
export function escapeBaseHalfHtmlText(text: string): string {
	return text.replace(/[&<>\u00a0\n\r]/g, character => htmlTextEscapes[character]);
}

const htmlAttributeEscapes: Readonly<Record<string, string>> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', '\n': '&#10;', '\r': '&#13;' };

/** A value written in a double-quoted HTML attribute. A line break is a character reference, so the value never holds a blank line. */
export function escapeBaseHalfHtmlAttribute(value: string): string {
	return value.replace(/[&"<>\n\r]/g, character => htmlAttributeEscapes[character]);
}

// --- Addresses

// The named character references that a page decodes without their `;`
// when they are not followed by a letter, a digit, or `=` in an attribute,
// as in `?a=1&copy/`.
const legacyReferenceNames = [
	'AElig', 'AMP', 'Aacute', 'Acirc', 'Agrave', 'Aring', 'Atilde', 'Auml', 'COPY', 'Ccedil', 'ETH', 'Eacute', 'Ecirc', 'Egrave',
	'Euml', 'GT', 'Iacute', 'Icirc', 'Igrave', 'Iuml', 'LT', 'Ntilde', 'Oacute', 'Ocirc', 'Ograve', 'Oslash', 'Otilde', 'Ouml',
	'QUOT', 'REG', 'THORN', 'Uacute', 'Ucirc', 'Ugrave', 'Uuml', 'Yacute', 'aacute', 'acirc', 'acute', 'aelig', 'agrave', 'amp',
	'aring', 'atilde', 'auml', 'brvbar', 'ccedil', 'cedil', 'cent', 'copy', 'curren', 'deg', 'divide', 'eacute', 'ecirc', 'egrave',
	'eth', 'euml', 'frac12', 'frac14', 'frac34', 'gt', 'iacute', 'icirc', 'iexcl', 'igrave', 'iquest', 'iuml', 'laquo', 'lt', 'macr',
	'micro', 'middot', 'nbsp', 'not', 'ntilde', 'oacute', 'ocirc', 'ograve', 'ordf', 'ordm', 'oslash', 'otilde', 'ouml', 'para',
	'plusmn', 'pound', 'quot', 'raquo', 'reg', 'sect', 'shy', 'sup1', 'sup2', 'sup3', 'szlig', 'thorn', 'times', 'uacute', 'ucirc',
	'ugrave', 'uml', 'uuml', 'yacute', 'yen', 'yuml'
];
const legacyReference = new RegExp(`^(?:${[...legacyReferenceNames].sort((a, b) => b.length - a.length).join('|')})`);

/** Whether the `&` at `index` starts a character reference that a page decodes in an attribute. */
function startsDecodedReference(href: string, index: number): boolean {
	const rest = href.slice(index + 1, index + 40);
	if (/^#(?:[0-9]|[xX][0-9A-Fa-f])/.test(rest) || /^[A-Za-z][A-Za-z0-9]*;/.test(rest)) {
		return true;
	}
	const legacy = legacyReference.exec(rest);
	return !!legacy && !/^[A-Za-z0-9=]/.test(rest.slice(legacy[0].length));
}

function unbalancedParentheses(href: string): ReadonlySet<number> {
	const unbalanced = new Set<number>();
	const open: number[] = [];
	for (let index = 0; index < href.length; index++) {
		if (href[index] === '(') {
			open.push(index);
		} else if (href[index] === ')' && open.pop() === undefined) {
			unbalanced.add(index);
		}
	}
	for (const index of open) {
		unbalanced.add(index);
	}
	return unbalanced;
}

const destinationEscapes: Readonly<Record<string, string>> = { ' ': '%20', '<': '%3C', '>': '%3E', '\\': '%5C' };
// White space ends an address in Markdown, and a control character has no
// place in one.
const encodedInDestination = /^[\s\p{Cc}]$/u;

/**
 * A link's address as a Markdown destination that `marked` reads back as
 * written (note formats, rule 17). A space is `%20`, `<`, `>`, and `\` are
 * `%3C`, `%3E`, and `%5C`, a `%` that starts no escape is `%25`, a
 * parenthesis without its partner is `%28` or `%29`, white space and control
 * characters are percent-encoded, and an `&` that would start a character
 * reference is `%26`. Letters of any script, `#`, `?`, and balanced
 * parentheses stay as they are, so an address that is already written so is
 * left unchanged.
 */
export function baseHalfMarkdownDestination(href: string): string {
	const unbalanced = unbalancedParentheses(href);
	let written = '';
	for (let index = 0; index < href.length;) {
		const character = String.fromCodePoint(href.codePointAt(index) ?? 0);
		if (unbalanced.has(index)) {
			written += character === '(' ? '%28' : '%29';
		} else if (character === '%') {
			written += /^[0-9A-Fa-f]{2}$/.test(href.slice(index + 1, index + 3)) ? '%' : '%25';
		} else if (character === '&') {
			written += startsDecodedReference(href, index) ? '%26' : '&';
		} else if (destinationEscapes[character]) {
			written += destinationEscapes[character];
		} else if (encodedInDestination.test(character)) {
			written += encodeURIComponent(character);
		} else {
			written += character;
		}
		index += character.length;
	}
	return written;
}

// The one encoder of every address BaseHalf writes into a note (files in
// notes, rule 19): a path segment keeps letters and digits, `-`, `.`, `_`, and
// `~`, and every character beyond ASCII but white space and control and
// format characters. Every other ASCII character is encoded, so that no
// address reads as a scheme or a character reference, or acts in Markdown.
const keptInPathSegment = /^[A-Za-z0-9\-._~]$/;
const encodedInPathSegment = /^[\s\p{Cc}\p{Cf}]$/u;

function encodePathSegment(segment: string): string {
	let written = '';
	for (const character of segment.normalize('NFC')) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (keptInPathSegment.test(character) || (codePoint > 0x7f && !encodedInPathSegment.test(character))) {
			// Letters of any script stay readable, also a lone surrogate, which has no encoding.
			written += character;
		} else if (codePoint <= 0x7f) {
			written += `%${codePoint.toString(16).toUpperCase().padStart(2, '0')}`;
		} else {
			written += encodeURIComponent(character);
		}
	}
	return written;
}

/**
 * The address of a file in the workspace as a link holds it: the address
 * that `[[` inserts and that a file put into a note gets (note formats,
 * rule 18). In each segment of the path, in NFC, every ASCII character but
 * letters, digits, `-`, `.`, `_`, and `~` is percent-encoded, and so are
 * white space and control and format characters; letters of any script stay
 * as they are: `docs/lecture #1.pdf` is `docs/lecture%20%231.pdf`. The
 * address reads back as the path once it is percent-decoded, as a link's
 * address is read (rule 55).
 */
export function baseHalfMarkdownPathHref(path: string): string {
	return path.split('/').map(segment => segment === '.' || segment === '..' ? segment : encodePathSegment(segment)).join('/');
}

// --- Headings

/**
 * The slug a link names a heading by (note formats, rule 56): the heading's
 * text in lower case, without the characters other than letters (with their
 * combining marks), digits, spaces, `-`, and `_`, each space as `-`. A slug
 * that comes again in the note gets `-1`, `-2`, and so on, in the order of
 * the headings; `seen` holds the slugs of the headings before this one, and
 * this one's is added to it.
 */
export function baseHalfHeadingSlug(text: string, seen: Map<string, number>): string {
	const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N} _-]/gu, '').replace(/ /g, '-');
	let slug = base;
	while (seen.has(slug)) {
		const repeat = (seen.get(base) ?? 0) + 1;
		seen.set(base, repeat);
		slug = `${base}-${repeat}`;
	}
	seen.set(slug, 0);
	return slug;
}

// --- Character references

const smallNamedReferences: ReadonlyMap<string, string> = new Map([
	['amp', '&'], ['AMP', '&'], ['lt', '<'], ['LT', '<'], ['gt', '>'], ['GT', '>'], ['quot', '"'], ['QUOT', '"'], ['apos', '\''], ['nbsp', '\u00a0']
]);

// A page reads a reference to a code point from 0x80 to 0x9f as the
// character of that byte in Windows-1252, where it has one.
const windows1252: ReadonlyMap<number, number> = new Map([
	[0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e], [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02c6],
	[0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152], [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c],
	[0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a],
	[0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178]
]);

function numericReference(codePoint: number): string {
	if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
		return '\ufffd';
	}
	return String.fromCodePoint(windows1252.get(codePoint) ?? codePoint);
}

const smallCharacterReference = /&(?:#([0-9]+);?|#[xX]([0-9A-Fa-f]+);?|(amp|AMP|lt|LT|gt|GT|quot|QUOT|apos|nbsp);)/g;

/**
 * Decodes, once, the character references that text read by `marked` holds
 * where no page is at hand to decode it, as in Node: every numeric
 * reference, read as a page reads it, and `&amp;`, `&lt;`, `&gt;`, `&quot;`,
 * `&apos;`, and `&nbsp;`. Any other named reference stays as written. In the
 * rich editor's webview the page decodes instead.
 */
export function decodeBaseHalfSmallCharacterReferences(text: string): string {
	return text.replace(smallCharacterReference, (match, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
		if (decimal !== undefined) {
			return numericReference(parseInt(decimal, 10));
		}
		if (hex !== undefined) {
			return numericReference(parseInt(hex, 16));
		}
		return smallNamedReferences.get(name ?? '') ?? match;
	});
}
