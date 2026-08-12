/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Longest run of characters after the dot that is still treated as a command
 * search. Past this the user is clearly writing code, not looking for an action.
 */
export const MAX_QUERY_LENGTH = 30;

/**
 * How many commands the dot offers once the user starts typing. The dot is a
 * shortcut, not a second command palette.
 */
export const COMMAND_LIMIT = 12;

export interface ICommandTrigger {
	/** 1-based column of the `.` that opened the list. */
	readonly dotColumn: number;
	/** What has been typed after the dot, possibly empty. */
	readonly query: string;
}

function isQueryCharacter(char: string): boolean {
	return (char >= 'a' && char <= 'z')
		|| (char >= 'A' && char <= 'Z')
		|| (char >= '0' && char <= '9');
}

/**
 * Finds the `.` that the cursor is completing against.
 *
 * Walks back from the cursor over the word being typed and expects a dot right
 * before it. Returns `undefined` when there is no dot, when the run is too long
 * to plausibly be an action search, or when the dot follows another dot — `..`
 * is almost always a range or a path, not a request for commands.
 *
 * @param lineText the full line
 * @param column 1-based cursor column
 */
export function findCommandTrigger(lineText: string, column: number): ICommandTrigger | undefined {
	let index = column - 1;

	if (index < 0 || index > lineText.length) {
		return undefined;
	}

	let length = 0;
	while (index > 0 && isQueryCharacter(lineText[index - 1])) {
		index--;
		length++;

		if (length > MAX_QUERY_LENGTH) {
			return undefined;
		}
	}

	if (index === 0 || lineText[index - 1] !== '.') {
		return undefined;
	}

	const dotIndex = index - 1;
	if (dotIndex > 0 && lineText[dotIndex - 1] === '.') {
		return undefined;
	}

	return {
		dotColumn: dotIndex + 1,
		query: lineText.slice(index, column - 1),
	};
}
