/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IScratchFilesService = createDecorator<IScratchFilesService>('scratchFilesService');

/**
 * Name of the folder that holds scratch files, relative to the user data home.
 */
export const SCRATCH_FOLDER_NAME = 'scratches';

/**
 * Extension used when a language declares none of its own.
 */
export const DEFAULT_SCRATCH_EXTENSION = '.txt';

/**
 * A scratch file: a throwaway buffer that lives outside any project, so it
 * survives switching workspaces and closing windows.
 */
export interface IScratchFile {
	readonly resource: URI;
	readonly name: string;
	readonly mtime: number;
}

export interface IScratchFilesService {
	readonly _serviceBrand: undefined;

	/**
	 * Folder that holds every scratch file.
	 */
	readonly scratchHome: URI;

	/**
	 * Creates an empty scratch file for the given language and returns it.
	 */
	create(languageId: string): Promise<URI>;

	/**
	 * Lists existing scratch files, most recently modified first.
	 */
	list(): Promise<IScratchFile[]>;

	/**
	 * Removes a scratch file.
	 */
	delete(resource: URI): Promise<void>;
}

/**
 * Picks the next free scratch file name, mirroring IntelliJ IDEA's numbering:
 * `scratch.ts`, then `scratch_1.ts`, `scratch_2.ts`, and so on. Gaps left by
 * deleted files are reused, so the numbering stays dense.
 *
 * @param taken names already present in the scratch folder
 * @param extension file extension including the leading dot, for example `.ts`
 */
export function nextScratchName(taken: readonly string[], extension: string): string {
	const used = new Set(taken);
	const base = `scratch${extension}`;
	if (!used.has(base)) {
		return base;
	}

	for (let i = 1; i <= used.size; i++) {
		const candidate = `scratch_${i}${extension}`;
		if (!used.has(candidate)) {
			return candidate;
		}
	}

	// Every `scratch_1..n` is taken, so `n + 1` is guaranteed to be free.
	return `scratch_${used.size + 1}${extension}`;
}

/**
 * Resolves the extension a scratch file should get for a language. Languages
 * register their extensions in preference order, so the first one wins.
 */
export function extensionForLanguage(extensions: readonly string[]): string {
	return extensions.length > 0 ? extensions[0] : DEFAULT_SCRATCH_EXTENSION;
}

/**
 * Orders scratch files so the most recently modified one comes first, which is
 * almost always the one being looked for. Ties fall back to the name to keep
 * the order stable between calls.
 */
export function sortScratchFiles(files: readonly IScratchFile[]): IScratchFile[] {
	return [...files].sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
}
