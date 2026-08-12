/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IMacroService = createDecorator<IMacroService>('macroService');

/**
 * Storage key holding every saved macro, as JSON.
 */
export const MACROS_STORAGE_KEY = 'nimbus.macros';

/**
 * One recorded command invocation.
 */
export interface IMacroStep {
	readonly commandId: string;
	readonly args: readonly unknown[];
}

export interface IMacro {
	readonly name: string;
	readonly steps: readonly IMacroStep[];
}

/**
 * Result of ending a recording: the macro plus how many invocations had to be
 * dropped because their arguments could not be replayed.
 */
export interface IRecordingResult {
	readonly macro: IMacro;
	readonly skipped: number;
}

export interface IMacroService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeRecording: Event<void>;

	readonly isRecording: boolean;

	/**
	 * How many steps the in-progress recording has captured so far.
	 */
	readonly recordedStepCount: number;

	startRecording(): void;

	/**
	 * Ends the recording and saves it under `name`, returning the stored macro.
	 */
	stopRecording(name: string): IRecordingResult;

	cancelRecording(): void;

	list(): readonly IMacro[];

	play(name: string): Promise<void>;

	delete(name: string): void;
}

/**
 * Commands that must never be recorded, because replaying them would either
 * recurse into the macro system, tear down the window, or block playback on a
 * picker waiting for input.
 */
const NON_RECORDABLE_COMMANDS = new Set([
	'workbench.action.reloadWindow',
	'workbench.action.quit',
	'workbench.action.closeWindow',
	'workbench.action.showCommands',
	'workbench.action.quickOpen',
	'workbench.action.quickOpenNavigateNext',
	'workbench.action.quickOpenNavigatePrevious',
	'workbench.action.gotoLine',
	'workbench.action.openSettings',
]);

const NON_RECORDABLE_PREFIXES = ['nimbus.macros.'];

/**
 * Whether a command invocation belongs in a macro.
 */
export function isRecordableCommand(commandId: string): boolean {
	if (!commandId) {
		return false;
	}

	if (NON_RECORDABLE_COMMANDS.has(commandId)) {
		return false;
	}

	return !NON_RECORDABLE_PREFIXES.some(prefix => commandId.startsWith(prefix));
}

/**
 * Returns a replayable copy of `args`, or `undefined` when the arguments cannot
 * survive a round trip through storage. Live objects such as editor instances
 * or URIs carrying prototypes would be silently corrupted, so the whole step is
 * dropped instead of being replayed with the wrong values.
 */
export function serializableArgs(args: readonly unknown[]): unknown[] | undefined {
	const replayable = args.every(arg =>
		arg !== undefined
		&& typeof arg !== 'function'
		&& typeof arg !== 'symbol'
		&& typeof arg !== 'bigint');

	if (!replayable) {
		return undefined;
	}

	try {
		const json = JSON.stringify(args);
		const parsed = JSON.parse(json) as unknown[];
		return JSON.stringify(parsed) === json ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Resolves a name collision by suffixing a counter, so saving twice under the
 * same name keeps both macros instead of silently replacing one.
 */
export function uniqueMacroName(taken: readonly string[], desired: string): string {
	const trimmed = desired.trim();
	const used = new Set(taken);

	if (!used.has(trimmed)) {
		return trimmed;
	}

	for (let i = 2; i <= used.size + 1; i++) {
		const candidate = `${trimmed} (${i})`;
		if (!used.has(candidate)) {
			return candidate;
		}
	}

	return `${trimmed} (${used.size + 2})`;
}

function isMacroStep(value: unknown): value is IMacroStep {
	const step = value as IMacroStep | undefined;
	return !!step && typeof step.commandId === 'string' && Array.isArray(step.args);
}

/**
 * Reads macros back from storage, dropping anything malformed rather than
 * throwing — a corrupted entry must not make every other macro unreachable.
 */
export function parseMacros(raw: string | undefined): IMacro[] {
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

	return parsed
		.filter((entry): entry is IMacro => {
			const macro = entry as IMacro | undefined;
			return !!macro
				&& typeof macro.name === 'string'
				&& macro.name.length > 0
				&& Array.isArray(macro.steps)
				&& macro.steps.every(isMacroStep);
		})
		.map(macro => ({ name: macro.name, steps: macro.steps }));
}

export function stringifyMacros(macros: readonly IMacro[]): string {
	return JSON.stringify(macros);
}
