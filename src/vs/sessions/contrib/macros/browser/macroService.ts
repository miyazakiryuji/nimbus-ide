/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ICommandEvent, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IMacro, IMacroService, IMacroStep, IRecordingResult, isRecordableCommand, MACROS_STORAGE_KEY, parseMacros, serializableArgs, stringifyMacros, uniqueMacroName } from '../common/macros.js';

export class MacroService extends Disposable implements IMacroService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeRecording = this._register(new Emitter<void>());
	readonly onDidChangeRecording = this._onDidChangeRecording.event;

	private readonly recordingListener = this._register(new MutableDisposable());

	private recording: IMacroStep[] | undefined;
	private skipped = 0;

	/**
	 * Set while a macro is being played back, so replayed commands are not
	 * folded into a recording that happens to be running.
	 */
	private replaying = false;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
	}

	get isRecording(): boolean {
		return this.recording !== undefined;
	}

	get recordedStepCount(): number {
		return this.recording?.length ?? 0;
	}

	startRecording(): void {
		this.recording = [];
		this.skipped = 0;
		this.recordingListener.value = this.commandService.onWillExecuteCommand(event => this.record(event));
		this._onDidChangeRecording.fire();
	}

	private record(event: ICommandEvent): void {
		if (!this.recording || this.replaying || !isRecordableCommand(event.commandId)) {
			return;
		}

		const args = serializableArgs(event.args);
		if (!args) {
			this.skipped++;
			return;
		}

		this.recording.push({ commandId: event.commandId, args });
		this._onDidChangeRecording.fire();
	}

	stopRecording(name: string): IRecordingResult {
		const steps = this.recording ?? [];
		const skipped = this.skipped;

		this.discardRecording();

		const existing = this.list();
		const macro: IMacro = { name: uniqueMacroName(existing.map(entry => entry.name), name), steps };
		this.save([...existing, macro]);
		this._onDidChangeRecording.fire();

		return { macro, skipped };
	}

	cancelRecording(): void {
		this.discardRecording();
		this._onDidChangeRecording.fire();
	}

	private discardRecording(): void {
		this.recording = undefined;
		this.skipped = 0;
		this.recordingListener.clear();
	}

	list(): readonly IMacro[] {
		return parseMacros(this.storageService.get(MACROS_STORAGE_KEY, StorageScope.PROFILE));
	}

	async play(name: string): Promise<void> {
		const macro = this.list().find(entry => entry.name === name);
		if (!macro) {
			return;
		}

		this.replaying = true;
		try {
			for (const step of macro.steps) {
				await this.commandService.executeCommand(step.commandId, ...step.args);
			}
		} finally {
			this.replaying = false;
		}
	}

	delete(name: string): void {
		this.save(this.list().filter(entry => entry.name !== name));
	}

	private save(macros: readonly IMacro[]): void {
		this.storageService.store(MACROS_STORAGE_KEY, stringifyMacros(macros), StorageScope.PROFILE, StorageTarget.USER);
	}
}
