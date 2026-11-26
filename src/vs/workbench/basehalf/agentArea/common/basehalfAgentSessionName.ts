/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { BaseHalfAgentSessionKind } from './basehalfAgentArea.js';

// The name a session shows on its tab, as the base's settings of a terminal's tab say
// (docs/specs/agent-area-terminal.md, The name of a session).

/** The most characters of a name or a description that a tab takes. */
export const BASEHALF_AGENT_SESSION_NAME_LIMIT = 256;

export interface IBaseHalfAgentSessionNaming {
	readonly kind: BaseHalfAgentSessionKind;
	/** The session's own name: its agent's, Terminal, or the one its creator gave it. */
	readonly ownName: string;
	/** The title the base computes for the session's terminal from `terminal.integrated.tabs.title`. */
	readonly terminalTitle?: string;
	/** The description the base computes for the terminal from `terminal.integrated.tabs.description`. */
	readonly terminalDescription?: string;
	/** The title that the program of an agent's session set for its terminal, while that program runs. */
	readonly programTitle?: string;
	/** `terminal.integrated.tabs.allowAgentCliTitle` */
	readonly allowAgentCliTitle: boolean;
}

export interface IBaseHalfAgentSessionName {
	readonly name: string;
	/** Shown after the name; empty when the session has none. */
	readonly description: string;
}

/**
 * The name and the description of a session. A plain terminal is named by the base's title; an agent's session
 * by the title its program set, when the setting allows one, and by the agent's name otherwise: the base's
 * template would name it by its process.
 */
export function baseHalfAgentSessionName(naming: IBaseHalfAgentSessionNaming): IBaseHalfAgentSessionName {
	const ownName = oneLine(naming.ownName);
	const description = oneLine(naming.terminalDescription);
	switch (naming.kind) {
		case 'tui-codex':
		case 'tui-claude':
			return { name: (naming.allowAgentCliTitle && oneLine(naming.programTitle)) || ownName, description };
		case 'terminal':
			return { name: oneLine(naming.terminalTitle) || ownName, description };
		case 'extension-codex':
		case 'extension-claude':
			return { name: ownName, description: '' };
	}
}

/** What a tab shows: the name the user gave it, alone, or the name and the description of its session. */
export function baseHalfAgentTabName(userName: string | undefined, session: IBaseHalfAgentSessionName | undefined): IBaseHalfAgentSessionName {
	const given = oneLine(userName);
	return given ? { name: given, description: '' } : session ?? { name: '', description: '' };
}

/** A name is one line of a bounded length, whatever a program wrote. */
function oneLine(text: string | undefined): string {
	return (text ?? '').replace(/[\n\r\t]/g, '').trim().slice(0, BASEHALF_AGENT_SESSION_NAME_LIMIT);
}
