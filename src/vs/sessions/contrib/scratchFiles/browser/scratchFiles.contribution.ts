/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { fromNow } from '../../../../base/common/date.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { IScratchFile, IScratchFilesService } from '../common/scratchFiles.js';
import { ScratchFilesService } from './scratchFilesService.js';

registerSingleton(IScratchFilesService, ScratchFilesService, InstantiationType.Delayed);

const SCRATCH_CATEGORY = localize2('scratchFiles.category', "Scratch");

const NEW_SCRATCH_FILE_COMMAND_ID = 'nimbus.scratchFiles.new';
const OPEN_SCRATCH_FILE_COMMAND_ID = 'nimbus.scratchFiles.open';
const DELETE_SCRATCH_FILE_COMMAND_ID = 'nimbus.scratchFiles.delete';

interface ILanguagePick extends IQuickPickItem {
	readonly languageId: string;
}

interface IScratchFilePick extends IQuickPickItem {
	readonly file: IScratchFile;
}

/**
 * Builds the language list for the new-scratch-file picker. Languages without a
 * file extension are dropped: a scratch file needs one to be named.
 */
function toLanguagePicks(languageService: ILanguageService): ILanguagePick[] {
	return languageService.getRegisteredLanguageIds()
		.filter(languageId => languageService.getExtensions(languageId).length > 0)
		.map(languageId => ({
			languageId,
			label: languageService.getLanguageName(languageId) ?? languageId,
			description: languageService.getExtensions(languageId)[0],
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Builds the picker entries for existing scratch files. The modified time is
 * shown because recency is how a scratch file is usually recognized — the names
 * themselves carry no meaning.
 */
function toScratchFilePicks(files: readonly IScratchFile[], languageService: ILanguageService): IScratchFilePick[] {
	return files.map(file => {
		const languageId = languageService.guessLanguageIdByFilepathOrFirstLine(file.resource);
		return {
			file,
			label: file.name,
			description: languageId ? languageService.getLanguageName(languageId) ?? languageId : undefined,
			detail: localize('scratchFiles.modified', "Modified {0}", fromNow(file.mtime, true)),
			iconClass: ThemeIcon.asClassName(Codicon.file),
		};
	});
}

async function pickScratchFile(accessor: ServicesAccessor, placeHolder: string): Promise<IScratchFile | undefined> {
	const scratchFilesService = accessor.get(IScratchFilesService);
	const languageService = accessor.get(ILanguageService);
	const quickInputService = accessor.get(IQuickInputService);

	const files = await scratchFilesService.list();
	if (files.length === 0) {
		return undefined;
	}

	const picked = await quickInputService.pick(toScratchFilePicks(files, languageService), { placeHolder });

	return picked?.file;
}

registerAction2(class NewScratchFileAction extends Action2 {

	constructor() {
		super({
			id: NEW_SCRATCH_FILE_COMMAND_ID,
			title: localize2('scratchFiles.new', "New Scratch File..."),
			category: SCRATCH_CATEGORY,
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyS,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const languageService = accessor.get(ILanguageService);
		const quickInputService = accessor.get(IQuickInputService);
		const scratchFilesService = accessor.get(IScratchFilesService);
		const editorService = accessor.get(IEditorService);

		const picked = await quickInputService.pick(toLanguagePicks(languageService), {
			placeHolder: localize('scratchFiles.pickLanguage', "Select a language for the scratch file"),
			matchOnDescription: true,
		});

		if (!picked) {
			return;
		}

		const resource = await scratchFilesService.create(picked.languageId);
		await editorService.openEditor({ resource });
	}
});

registerAction2(class OpenScratchFileAction extends Action2 {

	constructor() {
		super({
			id: OPEN_SCRATCH_FILE_COMMAND_ID,
			title: localize2('scratchFiles.open', "Open Scratch File..."),
			category: SCRATCH_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const scratchFilesService = accessor.get(IScratchFilesService);
		const commandService = accessor.get(ICommandService);

		// With no scratch files yet there is nothing to pick from, so go
		// straight to creating the first one instead of showing an empty list.
		if ((await scratchFilesService.list()).length === 0) {
			await commandService.executeCommand(NEW_SCRATCH_FILE_COMMAND_ID);
			return;
		}

		const file = await pickScratchFile(accessor, localize('scratchFiles.pickToOpen', "Select a scratch file to open"));
		if (!file) {
			return;
		}

		await editorService.openEditor({ resource: file.resource });
	}
});

registerAction2(class DeleteScratchFileAction extends Action2 {

	constructor() {
		super({
			id: DELETE_SCRATCH_FILE_COMMAND_ID,
			title: localize2('scratchFiles.delete', "Delete Scratch File..."),
			category: SCRATCH_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const scratchFilesService = accessor.get(IScratchFilesService);
		const dialogService = accessor.get(IDialogService);

		const file = await pickScratchFile(accessor, localize('scratchFiles.pickToDelete', "Select a scratch file to delete"));
		if (!file) {
			return;
		}

		const { confirmed } = await dialogService.confirm({
			message: localize('scratchFiles.confirmDelete', "Delete '{0}'?", file.name),
			detail: localize('scratchFiles.confirmDeleteDetail', "This scratch file is deleted permanently and cannot be restored."),
			primaryButton: localize({ key: 'scratchFiles.deleteButton', comment: ['&& denotes a mnemonic'] }, "&&Delete"),
			type: 'warning',
		});

		if (confirmed) {
			await scratchFilesService.delete(file.resource);
		}
	}
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	command: {
		id: NEW_SCRATCH_FILE_COMMAND_ID,
		title: localize({ key: 'miNewScratchFile', comment: ['&& denotes a mnemonic'] }, "New &&Scratch File..."),
	},
	group: '1_new',
	order: 3,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	command: {
		id: OPEN_SCRATCH_FILE_COMMAND_ID,
		title: localize({ key: 'miOpenScratchFile', comment: ['&& denotes a mnemonic'] }, "Open Scratc&&h File..."),
	},
	group: '2_open',
	order: 5,
});
