/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const USAGE_STORAGE_KEY = 'nimbus.productivityGuide.usage';

/**
 * How many entries each half of the guide shows. The guide exists to point at a
 * few things worth changing, not to dump a census.
 */
export const GUIDE_LIMIT = 25;

export interface IUsage {
	readonly count: number;
	/** Epoch milliseconds of the most recent invocation. */
	readonly last: number;
}

export type UsageStats = Readonly<Record<string, IUsage>>;

export interface IFeature {
	readonly commandId: string;
	readonly label: string;
	/** Rendered keybinding, when the command has one. */
	readonly keybinding?: string;
}

export interface IUsedFeature extends IFeature {
	readonly count: number;
	readonly last: number;
}

/**
 * Commands whose counts say nothing about how the IDE is being used — the guide
 * itself, and the palette that is the fallback for everything.
 */
const IGNORED_COMMANDS = new Set([
	'nimbus.productivityGuide.show',
	'workbench.action.showCommands',
]);

export function isTrackableCommand(commandId: string): boolean {
	return commandId.length > 0 && !IGNORED_COMMANDS.has(commandId);
}

export function recordUsage(stats: UsageStats, commandId: string, now: number): UsageStats {
	if (!isTrackableCommand(commandId)) {
		return stats;
	}

	const previous = stats[commandId];

	return { ...stats, [commandId]: { count: (previous?.count ?? 0) + 1, last: now } };
}

/**
 * Most-used first. Ties break on the more recent one, then on the id so the
 * order does not shuffle between openings.
 */
export function rankByUsage(stats: UsageStats, features: readonly IFeature[], limit = GUIDE_LIMIT): IUsedFeature[] {
	const used: IUsedFeature[] = [];

	for (const feature of features) {
		const usage = stats[feature.commandId];
		if (usage) {
			used.push({ ...feature, count: usage.count, last: usage.last });
		}
	}

	return used
		.sort((a, b) => b.count - a.count || b.last - a.last || a.commandId.localeCompare(b.commandId))
		.slice(0, limit);
}

/**
 * Shortcuts that exist but have never been pressed. This is the half of the
 * guide that can actually change how someone works — a command with a key that
 * is never used is a key going to waste.
 */
export function unusedShortcuts(stats: UsageStats, features: readonly IFeature[], limit = GUIDE_LIMIT): IFeature[] {
	return features
		.filter(feature => feature.keybinding && !stats[feature.commandId])
		.sort((a, b) => a.label.localeCompare(b.label))
		.slice(0, limit);
}

export function totalInvocations(stats: UsageStats): number {
	return Object.values(stats).reduce((sum, usage) => sum + usage.count, 0);
}

function isUsage(value: unknown): value is IUsage {
	const usage = value as IUsage | undefined;
	return !!usage
		&& typeof usage.count === 'number'
		&& Number.isFinite(usage.count)
		&& usage.count > 0
		&& typeof usage.last === 'number'
		&& Number.isFinite(usage.last);
}

export function parseStats(raw: string | undefined): UsageStats {
	if (!raw) {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return {};
	}

	const result: Record<string, IUsage> = {};
	for (const [commandId, usage] of Object.entries(parsed)) {
		if (isTrackableCommand(commandId) && isUsage(usage)) {
			result[commandId] = { count: usage.count, last: usage.last };
		}
	}

	return result;
}

export function stringifyStats(stats: UsageStats): string {
	return JSON.stringify(stats);
}
