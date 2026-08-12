/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { QueryBuilder } from '../../../../workbench/services/search/common/queryBuilder.js';
import { ISearchService } from '../../../../workbench/services/search/common/search.js';
import { buildMatrix, DEFAULT_DEPTH, extractImports, IFileImports, MAX_FILES, renderReport } from '../common/dependencyMatrix.js';

const SHOW_COMMAND_ID = 'nimbus.dependencyMatrix.show';

/**
 * Extensions the import scanner understands. Anything else would need its own
 * notion of what an import looks like.
 */
const SOURCE_GLOB = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

/** Files read at once. Enough to keep the disk busy without opening everything. */
const READ_BATCH = 50;

async function collectImports(accessor: ServicesAccessor, root: URI, report: (done: number) => void, token: CancellationToken): Promise<{ files: IFileImports[]; truncated: boolean }> {
	const searchService = accessor.get(ISearchService);
	const fileService = accessor.get(IFileService);
	const instantiationService = accessor.get(IInstantiationService);
	const contextService = accessor.get(IWorkspaceContextService);

	const queryBuilder = instantiationService.createInstance(QueryBuilder);
	const query = queryBuilder.file(contextService.getWorkspace().folders, {
		includePattern: [SOURCE_GLOB],
		maxResults: MAX_FILES + 1,
	});

	const complete = await searchService.fileSearch(query, token);
	const resources = complete.results.map(match => match.resource);
	const truncated = resources.length > MAX_FILES;
	const scanned = truncated ? resources.slice(0, MAX_FILES) : resources;

	const files: IFileImports[] = [];

	for (let offset = 0; offset < scanned.length; offset += READ_BATCH) {
		if (token.isCancellationRequested) {
			break;
		}

		const batch = scanned.slice(offset, offset + READ_BATCH);
		const contents = await Promise.all(batch.map(async resource => {
			try {
				const content = await fileService.readFile(resource);
				return { resource, text: content.value.toString() };
			} catch {
				// An unreadable file is simply not part of the picture.
				return undefined;
			}
		}));

		for (const entry of contents) {
			if (!entry) {
				continue;
			}

			const path = relativePath(root, entry.resource);
			if (!path) {
				continue;
			}

			files.push({ path, specifiers: extractImports(entry.text) });
		}

		report(files.length);
	}

	return { files, truncated };
}

registerAction2(class ShowDependencyMatrixAction extends Action2 {

	constructor() {
		super({
			id: SHOW_COMMAND_ID,
			title: localize2('dependencyMatrix.show', "Show Dependency Structure Matrix"),
			category: localize2('dependencyMatrix.category', "Analyze"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const contextService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);
		const progressService = accessor.get(IProgressService);
		const editorService = accessor.get(IEditorService);

		const folders = contextService.getWorkspace().folders;
		if (folders.length === 0) {
			notificationService.info(localize('dependencyMatrix.noWorkspace', "Open a folder first — the matrix is built from the files in the workspace."));
			return;
		}

		const depthPick = await quickInputService.pick([
			{ label: localize('dependencyMatrix.depth2', "2 levels"), description: 'src/vs', depth: 2 },
			{ label: localize('dependencyMatrix.depth3', "3 levels"), description: 'src/vs/base', depth: DEFAULT_DEPTH },
			{ label: localize('dependencyMatrix.depth4', "4 levels"), description: 'src/vs/base/common', depth: 4 },
		], {
			placeHolder: localize('dependencyMatrix.pickDepth', "How coarsely should folders be grouped?"),
		});

		if (!depthPick) {
			return;
		}

		const root = folders[0].uri;

		const report = await progressService.withProgress({
			location: ProgressLocation.Notification,
			title: localize('dependencyMatrix.working', "Building dependency matrix"),
			cancellable: true,
		}, async progress => {
			const collected = await collectImports(accessor, root, done => {
				progress.report({ message: localize('dependencyMatrix.scanned', "{0} files read", done) });
			}, CancellationToken.None);

			const matrix = buildMatrix(collected.files, depthPick.depth);

			return renderReport({
				matrix,
				depth: depthPick.depth,
				scannedFiles: collected.files.length,
				truncated: collected.truncated,
			});
		});

		await editorService.openEditor({
			resource: undefined,
			contents: report,
			languageId: 'plaintext',
			options: { pinned: true },
		});
	}
});
