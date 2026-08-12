/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const RUN_ANYTHING_HISTORY_KEY = 'nimbus.runAnything.history';

/**
 * How many past runs to keep. Long enough to cover a working session, short
 * enough that the list stays useful without filtering.
 */
export const HISTORY_LIMIT = 30;

/**
 * How many commands the picker offers alongside history — beyond this the list
 * stops being scannable and the command palette is the better tool.
 */
export const COMMAND_LIMIT = 10;

export const enum RunKind {
	Terminal = 'terminal',
	Command = 'command',
}

export interface IRunHistoryEntry {
	readonly kind: RunKind;
	/** Shell command line, or a command id. */
	readonly value: string;
	/** Human-readable name for a command; absent for shell entries. */
	readonly label?: string;
}

function sameEntry(a: IRunHistoryEntry, b: IRunHistoryEntry): boolean {
	return a.kind === b.kind && a.value === b.value;
}

/**
 * Puts `entry` at the front, removing any earlier run of the same thing so the
 * list reads as "what I ran, most recent first" rather than accumulating
 * duplicates of whatever gets run most.
 */
export function addToHistory(history: readonly IRunHistoryEntry[], entry: IRunHistoryEntry, limit = HISTORY_LIMIT): IRunHistoryEntry[] {
	return [entry, ...history.filter(existing => !sameEntry(existing, entry))].slice(0, limit);
}

/**
 * Case-insensitive substring match over what the user actually sees.
 */
export function filterHistory(history: readonly IRunHistoryEntry[], term: string): IRunHistoryEntry[] {
	if (!term) {
		return [...history];
	}

	const needle = term.toLowerCase();
	return history.filter(entry =>
		entry.value.toLowerCase().includes(needle)
		|| (entry.label?.toLowerCase().includes(needle) ?? false));
}

function isHistoryEntry(value: unknown): value is IRunHistoryEntry {
	const entry = value as IRunHistoryEntry | undefined;
	return !!entry
		&& (entry.kind === RunKind.Terminal || entry.kind === RunKind.Command)
		&& typeof entry.value === 'string'
		&& entry.value.length > 0
		&& (entry.label === undefined || typeof entry.label === 'string');
}

export function parseHistory(raw: string | undefined): IRunHistoryEntry[] {
	if (!raw) {
		return [];
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}

	if (!Array.isArray(parsed)) {
		return [];
	}

	return parsed.filter(isHistoryEntry).slice(0, HISTORY_LIMIT);
}

export function stringifyHistory(history: readonly IRunHistoryEntry[]): string {
	return JSON.stringify(history);
}
