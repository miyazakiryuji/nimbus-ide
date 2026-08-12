/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IBookmarksService = createDecorator<IBookmarksService>('bookmarksService');

export const BOOKMARKS_STORAGE_KEY = 'nimbus.bookmarks';

/**
 * The single-keystroke labels a bookmark can be reached by. Digits first
 * because they are the ones people reach for.
 */
export const MNEMONICS: readonly string[] = [
	'0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
	'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
	'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
];

export interface IBookmark {
	readonly uri: string;
	readonly line: number;
	/** Absent for a plain bookmark that is only reachable through the list. */
	readonly mnemonic?: string;
	/** Text of the line when the bookmark was made, shown in the list. */
	readonly preview: string;
}

export interface IBookmarksService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<void>;

	list(): readonly IBookmark[];

	/**
	 * Returns the bookmarks in `resource`, keyed by line.
	 */
	forResource(resource: URI): readonly IBookmark[];

	toggle(resource: URI, line: number, preview: string): void;

	/**
	 * Places a bookmark and gives it `mnemonic`, taking the mnemonic away from
	 * whichever bookmark held it before.
	 */
	setMnemonic(resource: URI, line: number, preview: string, mnemonic: string): void;

	find(mnemonic: string): IBookmark | undefined;

	clearAll(): void;
}

export function isValidMnemonic(value: string): boolean {
	return MNEMONICS.includes(value.toUpperCase());
}

function sameLocation(bookmark: IBookmark, uri: string, line: number): boolean {
	return bookmark.uri === uri && bookmark.line === line;
}

/**
 * Adds a bookmark at the location, or removes the one already there.
 * A mnemonic already assigned to that line survives the round trip only if the
 * bookmark stays — toggling off gives the mnemonic back to the pool.
 */
export function toggleBookmark(bookmarks: readonly IBookmark[], uri: string, line: number, preview: string): IBookmark[] {
	const existing = bookmarks.find(bookmark => sameLocation(bookmark, uri, line));

	if (existing) {
		return bookmarks.filter(bookmark => bookmark !== existing);
	}

	return [...bookmarks, { uri, line, preview }];
}

/**
 * Assigns `mnemonic` to a location. A mnemonic identifies exactly one place, so
 * handing it to a new line takes it off the old one rather than duplicating it.
 */
export function assignMnemonic(bookmarks: readonly IBookmark[], uri: string, line: number, preview: string, mnemonic: string): IBookmark[] {
	const label = mnemonic.toUpperCase();

	const released = bookmarks.map(bookmark =>
		bookmark.mnemonic === label ? { ...bookmark, mnemonic: undefined } : bookmark);

	const atLocation = released.find(bookmark => sameLocation(bookmark, uri, line));

	if (atLocation) {
		return released.map(bookmark =>
			bookmark === atLocation ? { ...bookmark, mnemonic: label } : bookmark);
	}

	return [...released, { uri, line, preview, mnemonic: label }];
}

/**
 * Groups by file, then by line, so the list reads like the project tree rather
 * than like the order bookmarks happened to be made in.
 */
export function sortBookmarks(bookmarks: readonly IBookmark[]): IBookmark[] {
	return [...bookmarks].sort((a, b) => a.uri.localeCompare(b.uri) || a.line - b.line);
}

/**
 * Next free mnemonic, or `undefined` when all 36 are spoken for.
 */
export function nextFreeMnemonic(bookmarks: readonly IBookmark[]): string | undefined {
	const taken = new Set(bookmarks.map(bookmark => bookmark.mnemonic).filter(Boolean));
	return MNEMONICS.find(candidate => !taken.has(candidate));
}

function isBookmark(value: unknown): value is IBookmark {
	const bookmark = value as IBookmark | undefined;
	return !!bookmark
		&& typeof bookmark.uri === 'string'
		&& bookmark.uri.length > 0
		&& typeof bookmark.line === 'number'
		&& Number.isInteger(bookmark.line)
		&& bookmark.line > 0
		&& typeof bookmark.preview === 'string'
		&& (bookmark.mnemonic === undefined || isValidMnemonic(bookmark.mnemonic));
}

/**
 * Reads bookmarks back from storage, dropping anything malformed and any
 * duplicate mnemonic so the "one mnemonic, one place" rule always holds.
 */
export function parseBookmarks(raw: string | undefined): IBookmark[] {
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

	const seenMnemonics = new Set<string>();
	const result: IBookmark[] = [];

	for (const entry of parsed) {
		if (!isBookmark(entry)) {
			continue;
		}

		if (entry.mnemonic !== undefined) {
			const label = entry.mnemonic.toUpperCase();
			if (seenMnemonics.has(label)) {
				result.push({ uri: entry.uri, line: entry.line, preview: entry.preview });
				continue;
			}
			seenMnemonics.add(label);
			result.push({ uri: entry.uri, line: entry.line, preview: entry.preview, mnemonic: label });
			continue;
		}

		result.push({ uri: entry.uri, line: entry.line, preview: entry.preview });
	}

	return result;
}

export function stringifyBookmarks(bookmarks: readonly IBookmark[]): string {
	return JSON.stringify(bookmarks);
}
