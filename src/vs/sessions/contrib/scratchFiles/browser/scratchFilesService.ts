/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { extensionForLanguage, IScratchFile, IScratchFilesService, nextScratchName, SCRATCH_FOLDER_NAME, sortScratchFiles } from '../common/scratchFiles.js';

/**
 * Keeps scratch files in the user data home rather than the workspace, so they
 * outlive the project that happened to be open when they were created.
 */
export class ScratchFilesService implements IScratchFilesService {

	declare readonly _serviceBrand: undefined;

	readonly scratchHome: URI;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IEnvironmentService environmentService: IEnvironmentService,
	) {
		this.scratchHome = joinPath(environmentService.userRoamingDataHome, SCRATCH_FOLDER_NAME);
	}

	async create(languageId: string): Promise<URI> {
		const extension = extensionForLanguage(this.languageService.getExtensions(languageId));
		const taken = (await this.list()).map(file => file.name);
		const resource = joinPath(this.scratchHome, nextScratchName(taken, extension));

		await this.fileService.createFile(resource, VSBuffer.fromString(''));

		return resource;
	}

	async list(): Promise<IScratchFile[]> {
		if (!(await this.fileService.exists(this.scratchHome))) {
			return [];
		}

		const folder = await this.fileService.resolve(this.scratchHome, { resolveMetadata: true });
		const files = (folder.children ?? [])
			.filter(child => !child.isDirectory)
			.map(child => ({ resource: child.resource, name: child.name, mtime: child.mtime }));

		return sortScratchFiles(files);
	}

	async delete(resource: URI): Promise<void> {
		await this.fileService.del(resource, { useTrash: false });
	}
}
