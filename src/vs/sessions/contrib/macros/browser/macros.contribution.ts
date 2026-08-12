/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../../workbench/services/statusbar/browser/statusbar.js';
import { IMacro, IMacroService } from '../common/macros.js';
import { MacroService } from './macroService.js';

registerSingleton(IMacroService, MacroService, InstantiationType.Delayed);

const MACRO_CATEGORY = localize2('macros.category', "Macro");

const START_RECORDING_COMMAND_ID = 'nimbus.macros.startRecording';
const STOP_RECORDING_COMMAND_ID = 'nimbus.macros.stopRecording';
const CANCEL_RECORDING_COMMAND_ID = 'nimbus.macros.cancelRecording';
const PLAY_COMMAND_ID = 'nimbus.macros.play';
const DELETE_COMMAND_ID = 'nimbus.macros.delete';

const MacroRecordingContext = new RawContextKey<boolean>('nimbusMacroRecording', false);

interface IMacroPick extends IQuickPickItem {
	readonly macro: IMacro;
}

function toMacroPicks(macros: readonly IMacro[]): IMacroPick[] {
	return macros.map(macro => ({
		macro,
		label: macro.name,
		description: localize('macros.stepCount', "{0} steps", macro.steps.length),
	}));
}

async function pickMacro(accessor: ServicesAccessor, placeHolder: string): Promise<IMacro | undefined> {
	const macroService = accessor.get(IMacroService);
	const quickInputService = accessor.get(IQuickInputService);
	const notificationService = accessor.get(INotificationService);

	const macros = macroService.list();
	if (macros.length === 0) {
		notificationService.info(localize('macros.none', "No macros have been recorded yet. Run \"Macro: Start Recording\" to record one."));
		return undefined;
	}

	const picked = await quickInputService.pick(toMacroPicks(macros), { placeHolder });

	return picked?.macro;
}

/**
 * Recording is a mode, and a mode the user forgets they are in is a trap — so
 * it gets a persistent status bar entry that doubles as the stop button.
 */
class MacroRecordingIndicator extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'nimbus.macros.recordingIndicator';

	private readonly entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly recordingContext: IContextKey<boolean>;

	constructor(
		@IMacroService private readonly macroService: IMacroService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this.recordingContext = MacroRecordingContext.bindTo(contextKeyService);
		this._register(this.macroService.onDidChangeRecording(() => this.update()));
		this.update();
	}

	private update(): void {
		const recording = this.macroService.isRecording;
		this.recordingContext.set(recording);

		if (!recording) {
			this.entry.clear();
			return;
		}

		const label = localize('macros.recording', "Recording Macro");
		const entry: IStatusbarEntry = {
			name: label,
			text: `$(record) ${localize('macros.recordingSteps', "Recording macro ({0})", this.macroService.recordedStepCount)}`,
			ariaLabel: label,
			tooltip: localize('macros.recordingTooltip', "Click to stop recording and save the macro"),
			command: STOP_RECORDING_COMMAND_ID,
			kind: 'prominent',
		};

		if (this.entry.value) {
			this.entry.value.update(entry);
		} else {
			this.entry.value = this.statusbarService.addEntry(entry, MacroRecordingIndicator.ID, StatusbarAlignment.RIGHT, 100);
		}
	}
}

registerWorkbenchContribution2(MacroRecordingIndicator.ID, MacroRecordingIndicator, WorkbenchPhase.AfterRestored);

registerAction2(class StartRecordingAction extends Action2 {

	constructor() {
		super({
			id: START_RECORDING_COMMAND_ID,
			title: localize2('macros.start', "Start Recording"),
			category: MACRO_CATEGORY,
			f1: true,
			precondition: MacroRecordingContext.negate(),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IMacroService).startRecording();
	}
});

registerAction2(class StopRecordingAction extends Action2 {

	constructor() {
		super({
			id: STOP_RECORDING_COMMAND_ID,
			title: localize2('macros.stop', "Stop Recording and Save..."),
			category: MACRO_CATEGORY,
			f1: true,
			precondition: MacroRecordingContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const macroService = accessor.get(IMacroService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		if (!macroService.isRecording) {
			return;
		}

		const name = await quickInputService.input({
			prompt: localize('macros.namePrompt', "Name for this macro"),
			value: localize('macros.defaultName', "Macro {0}", macroService.list().length + 1),
		});

		if (name === undefined) {
			// Cancelling the name prompt keeps recording, so nothing is lost.
			return;
		}

		if (name.trim().length === 0) {
			notificationService.warn(localize('macros.emptyName', "A macro needs a name. Recording is still running."));
			return;
		}

		const { macro, skipped } = macroService.stopRecording(name);

		if (skipped > 0) {
			notificationService.warn(localize('macros.savedWithSkips', "Saved '{0}' with {1} steps. {2} command(s) were left out because their arguments cannot be replayed.", macro.name, macro.steps.length, skipped));
		} else {
			notificationService.info(localize('macros.saved', "Saved '{0}' with {1} steps.", macro.name, macro.steps.length));
		}
	}
});

registerAction2(class CancelRecordingAction extends Action2 {

	constructor() {
		super({
			id: CANCEL_RECORDING_COMMAND_ID,
			title: localize2('macros.cancel', "Cancel Recording"),
			category: MACRO_CATEGORY,
			f1: true,
			precondition: MacroRecordingContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IMacroService).cancelRecording();
	}
});

registerAction2(class PlayMacroAction extends Action2 {

	constructor() {
		super({
			id: PLAY_COMMAND_ID,
			title: localize2('macros.play', "Play Macro..."),
			category: MACRO_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const macroService = accessor.get(IMacroService);

		const macro = await pickMacro(accessor, localize('macros.pickToPlay', "Select a macro to play"));
		if (macro) {
			await macroService.play(macro.name);
		}
	}
});

registerAction2(class DeleteMacroAction extends Action2 {

	constructor() {
		super({
			id: DELETE_COMMAND_ID,
			title: localize2('macros.delete', "Delete Macro..."),
			category: MACRO_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const macroService = accessor.get(IMacroService);
		const dialogService = accessor.get(IDialogService);

		const macro = await pickMacro(accessor, localize('macros.pickToDelete', "Select a macro to delete"));
		if (!macro) {
			return;
		}

		const { confirmed } = await dialogService.confirm({
			message: localize('macros.confirmDelete', "Delete '{0}'?", macro.name),
			detail: localize('macros.confirmDeleteDetail', "This macro is deleted permanently and cannot be restored."),
			primaryButton: localize({ key: 'macros.deleteButton', comment: ['&& denotes a mnemonic'] }, "&&Delete"),
			type: 'warning',
		});

		if (confirmed) {
			macroService.delete(macro.name);
		}
	}
});
