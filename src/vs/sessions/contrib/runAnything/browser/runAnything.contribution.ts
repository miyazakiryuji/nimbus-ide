/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { matchesFuzzy } from '../../../../base/common/filters.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { Action2, isIMenuItem, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITerminalService } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { addToHistory, COMMAND_LIMIT, filterHistory, IRunHistoryEntry, parseHistory, RUN_ANYTHING_HISTORY_KEY, RunKind, stringifyHistory } from '../common/runAnything.js';

const RUN_ANYTHING_COMMAND_ID = 'nimbus.runAnything.open';

interface IRunPick extends IQuickPickItem {
	run(): Promise<void>;
}

type PickerEntry = IRunPick | IQuickPickSeparator;

function titleOf(title: string | ILocalizedString): string {
	return typeof title === 'string' ? title : title.value;
}

function readHistory(storageService: IStorageService): IRunHistoryEntry[] {
	return parseHistory(storageService.get(RUN_ANYTHING_HISTORY_KEY, StorageScope.WORKSPACE));
}

function remember(storageService: IStorageService, entry: IRunHistoryEntry): void {
	const updated = addToHistory(readHistory(storageService), entry);
	storageService.store(RUN_ANYTHING_HISTORY_KEY, stringifyHistory(updated), StorageScope.WORKSPACE, StorageTarget.USER);
}

async function runInTerminal(accessor: ServicesAccessor, commandLine: string): Promise<void> {
	const terminalService = accessor.get(ITerminalService);
	const storageService = accessor.get(IStorageService);

	remember(storageService, { kind: RunKind.Terminal, value: commandLine });

	const instance = await terminalService.createTerminal({});
	terminalService.setActiveInstance(instance);
	await terminalService.focusActiveInstance();
	await instance.sendText(commandLine, true);
}

async function runCommand(accessor: ServicesAccessor, commandId: string, label: string): Promise<void> {
	remember(accessor.get(IStorageService), { kind: RunKind.Command, value: commandId, label });
	await accessor.get(ICommandService).executeCommand(commandId);
}

function buildEntries(term: string, accessor: ServicesAccessor): PickerEntry[] {
	const storageService = accessor.get(IStorageService);
	const contextKeyService = accessor.get(IContextKeyService);

	const entries: PickerEntry[] = [];

	// Typing a command line and pressing Enter is the whole point, so the shell
	// entry leads — it must never be pushed below a fuzzy match.
	if (term) {
		entries.push({
			label: term,
			description: localize('runAnything.inTerminal', "Run in Terminal"),
			alwaysShow: true,
			iconClass: ThemeIcon.asClassName(Codicon.terminal),
			run: () => runInTerminal(accessor, term),
		});
	}

	const history = filterHistory(readHistory(storageService), term);
	if (history.length > 0) {
		entries.push({ type: 'separator', label: localize('runAnything.recent', "Recent") });

		for (const entry of history) {
			entries.push(entry.kind === RunKind.Terminal
				? {
					label: entry.value,
					description: localize('runAnything.inTerminal', "Run in Terminal"),
					alwaysShow: true,
					iconClass: ThemeIcon.asClassName(Codicon.history),
					run: () => runInTerminal(accessor, entry.value),
				}
				: {
					label: entry.label ?? entry.value,
					description: localize('runAnything.command', "Command"),
					alwaysShow: true,
					iconClass: ThemeIcon.asClassName(Codicon.history),
					run: () => runCommand(accessor, entry.value, entry.label ?? entry.value),
				});
		}
	}

	const commands: IRunPick[] = [];
	for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
		if (!isIMenuItem(item) || !contextKeyService.contextMatchesRules(item.when)) {
			continue;
		}

		const category = item.command.category ? titleOf(item.command.category) : undefined;
		const label = titleOf(item.command.title);
		const searchable = category ? `${category}: ${label}` : label;

		if (term && !matchesFuzzy(term, searchable, true)) {
			continue;
		}

		const commandId = item.command.id;
		commands.push({
			label,
			description: category,
			alwaysShow: true,
			iconClass: ThemeIcon.asClassName(Codicon.symbolEvent),
			run: () => runCommand(accessor, commandId, searchable),
		});

		if (commands.length >= COMMAND_LIMIT) {
			break;
		}
	}

	if (commands.length > 0) {
		entries.push({ type: 'separator', label: localize('runAnything.commands', "Commands") }, ...commands);
	}

	return entries;
}

registerAction2(class RunAnythingAction extends Action2 {

	constructor() {
		super({
			id: RUN_ANYTHING_COMMAND_ID,
			title: localize2('runAnything.open', "Run Anything"),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyR,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);

		const store = new DisposableStore();
		const picker = store.add(quickInputService.createQuickPick<IRunPick>({ useSeparators: true }));

		picker.placeholder = localize('runAnything.placeholder', "Type a command to run in the terminal, or search IDE commands");
		// Entries are already filtered by the sources; filtering twice hides them.
		picker.matchOnLabel = false;
		picker.matchOnDescription = false;

		const refresh = () => {
			picker.items = buildEntries(picker.value.trim(), accessor);
		};

		store.add(picker.onDidChangeValue(() => refresh()));
		store.add(picker.onDidAccept(async () => {
			const selected = picker.selectedItems[0];
			picker.hide();
			await selected?.run();
		}));
		store.add(picker.onDidHide(() => store.dispose()));

		refresh();
		picker.show();
	}
});
