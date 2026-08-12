/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A dependency structure matrix: who depends on whom, counted between folders
 * rather than between files, because a file-level matrix for a real project is
 * too large to read. Cycles are the payoff — they are what a matrix shows that
 * a list of imports does not.
 */

/** Files scanned before the report says it stopped early. */
export const MAX_FILES = 2000;

export const DEFAULT_DEPTH = 3;

/**
 * Module specifiers found in `text`. Covers ES imports and re-exports, dynamic
 * `import()`, and CommonJS `require()`. Matches inside strings and comments are
 * possible in principle but harmless: an unresolvable specifier is dropped.
 */
export function extractImports(text: string): string[] {
	const specifiers: string[] = [];
	const patterns = [
		/\bfrom\s+['"]([^'"]+)['"]/g,
		/\bimport\s+['"]([^'"]+)['"]/g,
		/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	];

	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			specifiers.push(match[1]);
		}
	}

	return specifiers;
}

function normalizeSegments(segments: readonly string[]): string[] | undefined {
	const result: string[] = [];

	for (const segment of segments) {
		if (segment === '' || segment === '.') {
			continue;
		}
		if (segment === '..') {
			if (result.length === 0) {
				// Escapes the workspace — outside what this report describes.
				return undefined;
			}
			result.pop();
			continue;
		}
		result.push(segment);
	}

	return result;
}

/**
 * Resolves a relative specifier against the importing file, returning a
 * workspace-relative path without an extension.
 *
 * Bare specifiers (`react`, `vs/base/common/uri`) return `undefined`: they are
 * dependencies on packages or on an alias this report cannot resolve, and
 * guessing would put invented edges in the matrix.
 */
export function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
	if (!specifier.startsWith('.')) {
		return undefined;
	}

	const fromSegments = fromFile.split('/');
	fromSegments.pop();

	const resolved = normalizeSegments([...fromSegments, ...specifier.split('/')]);
	if (!resolved || resolved.length === 0) {
		return undefined;
	}

	return resolved.join('/').replace(/\.(m|c)?[jt]sx?$/, '');
}

/**
 * Collapses a path to the folder the matrix counts by. Depth 3 turns
 * `src/vs/base/common/uri.ts` into `src/vs/base`.
 */
export function moduleKeyFor(path: string, depth: number): string {
	const segments = path.split('/').filter(segment => segment.length > 0);

	// The last segment is the file itself, so it never forms part of a folder key.
	const folders = segments.slice(0, -1);
	if (folders.length === 0) {
		return '.';
	}

	return folders.slice(0, Math.max(1, depth)).join('/');
}

export interface IMatrix {
	readonly modules: readonly string[];
	/** `counts[from][to]` — how many imports cross from one folder to another. */
	readonly counts: readonly (readonly number[])[];
}

export interface IFileImports {
	readonly path: string;
	readonly specifiers: readonly string[];
}

/**
 * Counts folder-to-folder dependencies. Imports within one folder are not
 * counted: the matrix is about coupling between modules, and a folder always
 * depends on itself.
 */
export function buildMatrix(files: readonly IFileImports[], depth: number): IMatrix {
	const edges = new Map<string, Map<string, number>>();
	const modules = new Set<string>();

	for (const file of files) {
		const from = moduleKeyFor(file.path, depth);
		modules.add(from);

		for (const specifier of file.specifiers) {
			const target = resolveSpecifier(file.path, specifier);
			if (!target) {
				continue;
			}

			const to = moduleKeyFor(`${target}.x`, depth);
			modules.add(to);

			if (to === from) {
				continue;
			}

			const row = edges.get(from) ?? new Map<string, number>();
			row.set(to, (row.get(to) ?? 0) + 1);
			edges.set(from, row);
		}
	}

	const ordered = [...modules].sort((a, b) => a.localeCompare(b));
	const index = new Map(ordered.map((name, position) => [name, position]));

	const counts = ordered.map(() => new Array<number>(ordered.length).fill(0));
	for (const [from, row] of edges) {
		for (const [to, count] of row) {
			counts[index.get(from)!][index.get(to)!] = count;
		}
	}

	return { modules: ordered, counts };
}

/**
 * Strongly connected components of size two or more — every set of folders that
 * can reach each other, which is exactly what a dependency cycle is.
 *
 * Iterative Tarjan, so a deep graph cannot overflow the stack.
 */
export function findCycles(matrix: IMatrix): string[][] {
	const size = matrix.modules.length;
	const index = new Array<number>(size).fill(-1);
	const low = new Array<number>(size).fill(0);
	const onStack = new Array<boolean>(size).fill(false);
	const stack: number[] = [];
	const cycles: string[][] = [];

	let counter = 0;

	for (let root = 0; root < size; root++) {
		if (index[root] !== -1) {
			continue;
		}

		const work: { node: number; next: number }[] = [{ node: root, next: 0 }];

		while (work.length > 0) {
			const frame = work[work.length - 1];
			const node = frame.node;

			if (frame.next === 0) {
				index[node] = low[node] = counter++;
				stack.push(node);
				onStack[node] = true;
			}

			let recursed = false;
			while (frame.next < size) {
				const neighbour = frame.next++;
				if (matrix.counts[node][neighbour] === 0) {
					continue;
				}

				if (index[neighbour] === -1) {
					work.push({ node: neighbour, next: 0 });
					recursed = true;
					break;
				}

				if (onStack[neighbour]) {
					low[node] = Math.min(low[node], index[neighbour]);
				}
			}

			if (recursed) {
				continue;
			}

			if (low[node] === index[node]) {
				const component: string[] = [];
				for (;;) {
					const member = stack.pop()!;
					onStack[member] = false;
					component.push(matrix.modules[member]);
					if (member === node) {
						break;
					}
				}

				if (component.length > 1) {
					cycles.push(component.sort((a, b) => a.localeCompare(b)));
				}
			}

			work.pop();
			if (work.length > 0) {
				const parent = work[work.length - 1].node;
				low[parent] = Math.min(low[parent], low[node]);
			}
		}
	}

	return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

function padEnd(value: string, width: number): string {
	return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padStart(value: string, width: number): string {
	return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

/**
 * Renders the matrix as aligned text. Columns are numbered rather than named,
 * because folder names are far too wide to head a column; the numbers are
 * spelled out in the legend beside each row.
 */
export function renderMatrix(matrix: IMatrix): string {
	if (matrix.modules.length === 0) {
		return '';
	}

	const cellWidth = Math.max(3, String(matrix.modules.length).length + 1);
	const labelWidth = Math.max(...matrix.modules.map((name, i) => `${i + 1}. ${name}`.length));

	const header = padEnd('', labelWidth + 2)
		+ matrix.modules.map((_, i) => padStart(String(i + 1), cellWidth)).join('');

	const rows = matrix.modules.map((name, from) => {
		const label = padEnd(`${from + 1}. ${name}`, labelWidth);
		const cells = matrix.counts[from]
			.map((count, to) => padStart(from === to ? '—' : count === 0 ? '.' : String(count), cellWidth))
			.join('');
		return `${label}  ${cells}`;
	});

	return [header, ...rows].join('\n');
}

export interface IReportInput {
	readonly matrix: IMatrix;
	readonly depth: number;
	readonly scannedFiles: number;
	readonly truncated: boolean;
}

/**
 * The full report. Cycles come first: they are the finding, the matrix is the
 * evidence.
 */
export function renderReport(input: IReportInput): string {
	const cycles = findCycles(input.matrix);
	const lines: string[] = [];

	lines.push('Dependency Structure Matrix');
	lines.push('===========================');
	lines.push('');
	lines.push(`Folders: ${input.matrix.modules.length}   Files scanned: ${input.scannedFiles}   Grouped at depth: ${input.depth}`);

	if (input.truncated) {
		lines.push(`Note: stopped after ${MAX_FILES} files, so this is a partial picture.`);
	}

	lines.push('');
	lines.push(cycles.length === 0
		? 'Cycles: none.'
		: `Cycles: ${cycles.length}`);

	for (const cycle of cycles) {
		lines.push(`  - ${cycle.join('  <->  ')}`);
	}

	lines.push('');
	lines.push('Rows depend on columns. A dash is the folder itself; a dot is no dependency.');
	lines.push('');
	lines.push(renderMatrix(input.matrix));
	lines.push('');

	return lines.join('\n');
}
