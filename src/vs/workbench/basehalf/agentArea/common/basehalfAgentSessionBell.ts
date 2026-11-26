/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The bell of a session on its tab and on the title bar's button (docs/specs/agent-area-terminal.md, The bell).
// The base keeps a bell for `terminal.integrated.bellDuration` after a ring. A session that is not in view keeps
// it until it comes into view, and from then for the same time, as if it rang at that moment. A bell that rang
// while the Agent Area was hidden shows on the title bar's button until the area is shown.

export interface IBaseHalfAgentSessionBell {
	/** The base still shows the bell: its time after the last ring has not ended. */
	readonly ringing: boolean;
	/** The bell rang while the session was not in view, and the session has not been in view since. */
	readonly unseen: boolean;
	/** The session came into view with an unseen bell, and the time of a bell has not ended since. */
	readonly lingering: boolean;
	/** The bell rang while the Agent Area was hidden, and the area has not been shown since. */
	readonly hidden: boolean;
}

export const BASEHALF_AGENT_SESSION_NO_BELL: IBaseHalfAgentSessionBell = { ringing: false, unseen: false, lingering: false, hidden: false };

/**
 * A program rang the bell. `inView`: the Agent Area is shown and the session's tab is in front. `areaShown`:
 * the Agent Area is shown, with any tab in front.
 */
export function baseHalfAgentSessionBellRang(bell: IBaseHalfAgentSessionBell, inView: boolean, areaShown: boolean): IBaseHalfAgentSessionBell {
	return { ...bell, ringing: true, unseen: bell.unseen || !inView, hidden: bell.hidden || !areaShown };
}

/** The Agent Area is shown: its tabs show the bells from now. Returns the same object when nothing changes. */
export function baseHalfAgentSessionBellAreaShown(bell: IBaseHalfAgentSessionBell): IBaseHalfAgentSessionBell {
	return bell.hidden ? { ...bell, hidden: false } : bell;
}

/** The base's time for the bell ended. */
export function baseHalfAgentSessionBellEnded(bell: IBaseHalfAgentSessionBell): IBaseHalfAgentSessionBell {
	return { ...bell, ringing: false };
}

/**
 * The session is in view. An unseen bell lingers from now: the caller ends it with
 * {@link baseHalfAgentSessionBellLingered} after the time of a bell. Returns the same object when no bell was
 * unseen.
 */
export function baseHalfAgentSessionBellSeen(bell: IBaseHalfAgentSessionBell): IBaseHalfAgentSessionBell {
	return bell.unseen ? { ...bell, unseen: false, lingering: true } : bell;
}

/** The time of a bell ended after the session came into view. */
export function baseHalfAgentSessionBellLingered(bell: IBaseHalfAgentSessionBell): IBaseHalfAgentSessionBell {
	return { ...bell, lingering: false };
}

export function baseHalfAgentSessionShowsBell(bell: IBaseHalfAgentSessionBell): boolean {
	return bell.ringing || bell.unseen || bell.lingering;
}

/**
 * Whether the title bar's button of the Agent Area shows the dot of a bell: a session that is there rang while
 * the Agent Area was hidden, and the area has not been shown since. The time of a bell does not end it.
 */
export function baseHalfAgentAreaButtonShowsBell(bells: Iterable<IBaseHalfAgentSessionBell>): boolean {
	for (const bell of bells) {
		if (bell.hidden) {
			return true;
		}
	}
	return false;
}
