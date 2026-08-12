/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { assignMnemonic, BOOKMARKS_STORAGE_KEY, IBookmark, IBookmarksService, parseBookmarks, sortBookmarks, stringifyBookmarks, toggleBookmark } from '../common/bookmarks.js';

/**
 * Bookmarks live in workspace storage: they point at lines in this project, so
 * carrying them to another one would only produce dead links.
 */
export class BookmarksService extends Disposable implements IBookmarksService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private cache: IBookmark[] | undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
	}

	list(): readonly IBookmark[] {
		this.cache ??= parseBookmarks(this.storageService.get(BOOKMARKS_STORAGE_KEY, StorageScope.WORKSPACE));
		return this.cache;
	}

	forResource(resource: URI): readonly IBookmark[] {
		const key = resource.toString();
		return this.list().filter(bookmark => bookmark.uri === key);
	}

	toggle(resource: URI, line: number, preview: string): void {
		this.save(toggleBookmark(this.list(), resource.toString(), line, preview));
	}

	setMnemonic(resource: URI, line: number, preview: string, mnemonic: string): void {
		this.save(assignMnemonic(this.list(), resource.toString(), line, preview, mnemonic));
	}

	find(mnemonic: string): IBookmark | undefined {
		const label = mnemonic.toUpperCase();
		return this.list().find(bookmark => bookmark.mnemonic === label);
	}

	clearAll(): void {
		this.save([]);
	}

	private save(bookmarks: readonly IBookmark[]): void {
		this.cache = sortBookmarks(bookmarks);
		this.storageService.store(BOOKMARKS_STORAGE_KEY, stringifyBookmarks(this.cache), StorageScope.WORKSPACE, StorageTarget.USER);
		this._onDidChange.fire();
	}
}
