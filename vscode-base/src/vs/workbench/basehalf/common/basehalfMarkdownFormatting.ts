/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Projection-independent Markdown formatting commands. Each editor projection
 * adapts these semantic operations to its own transaction model.
 */
export type BaseHalfMarkdownFormatCommand =
	| 'setHeading1'
	| 'setHeading2'
	| 'setHeading3'
	| 'setParagraph'
	| 'toggleBold'
	| 'toggleItalic'
	| 'toggleBulletList'
	| 'toggleOrderedList'
	| 'insertDivider';

export type BaseHalfMarkdownFormatBlockType =
	| 'paragraph'
	| 'heading1'
	| 'heading2'
	| 'heading3'
	| 'bulletList'
	| 'orderedList'
	| 'mixed'
	| 'other';

export type BaseHalfMarkdownFormatToggleState = boolean | 'mixed';

export interface IBaseHalfMarkdownFormatState {
	readonly ready: boolean;
	readonly editable: boolean;
	readonly blockType: BaseHalfMarkdownFormatBlockType;
	readonly bold: BaseHalfMarkdownFormatToggleState;
	readonly italic: BaseHalfMarkdownFormatToggleState;
}

export function isBaseHalfMarkdownFormatCommand(value: unknown): value is BaseHalfMarkdownFormatCommand {
	switch (value) {
		case 'setHeading1':
		case 'setHeading2':
		case 'setHeading3':
		case 'setParagraph':
		case 'toggleBold':
		case 'toggleItalic':
		case 'toggleBulletList':
		case 'toggleOrderedList':
		case 'insertDivider':
			return true;
		default:
			return false;
	}
}

export function isBaseHalfMarkdownFormatBlockType(value: unknown): value is BaseHalfMarkdownFormatBlockType {
	switch (value) {
		case 'paragraph':
		case 'heading1':
		case 'heading2':
		case 'heading3':
		case 'bulletList':
		case 'orderedList':
		case 'mixed':
		case 'other':
			return true;
		default:
			return false;
	}
}

export function isBaseHalfMarkdownFormatToggleState(value: unknown): value is BaseHalfMarkdownFormatToggleState {
	return typeof value === 'boolean' || value === 'mixed';
}

export function isBaseHalfMarkdownFormatState(value: unknown): value is IBaseHalfMarkdownFormatState {
	const candidate = value as Partial<IBaseHalfMarkdownFormatState> | undefined;
	return !!candidate
		&& typeof candidate.ready === 'boolean'
		&& typeof candidate.editable === 'boolean'
		&& isBaseHalfMarkdownFormatBlockType(candidate.blockType)
		&& isBaseHalfMarkdownFormatToggleState(candidate.bold)
		&& isBaseHalfMarkdownFormatToggleState(candidate.italic);
}
