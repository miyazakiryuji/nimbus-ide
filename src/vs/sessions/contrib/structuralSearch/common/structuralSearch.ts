/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Structural search matches code by shape rather than by characters.
 *
 * A pattern is ordinary code with `$name$` placeholders in it. A placeholder
 * stands for one balanced run of code, which is the part a regular expression
 * cannot express: `$x$` in `foo($x$)` matches `bar(1, baz(2))` in full instead
 * of stopping at the first `)`. Text inside strings and comments is never
 * treated as structure, so a pattern cannot match something that only looks
 * like code because it appears in a message.
 *
 * The scanner understands `//` and `#` line comments, block comments, and
 * single, double, and back quoted strings, which covers the C-like languages
 * plus the common scripting syntaxes. It is deliberately language agnostic:
 * one matcher for every file rather than a parser per language.
 */

export const MAX_MATCHES = 500;

export type PatternPart =
	| { readonly kind: 'literal'; readonly text: string }
	| { readonly kind: 'placeholder'; readonly name: string };

export interface IStructuralMatch {
	readonly start: number;
	readonly end: number;
	readonly bindings: Readonly<Record<string, string>>;
}

const PLACEHOLDER = /^\$([A-Za-z_][A-Za-z0-9_]*)\$/;

/**
 * Splits a pattern into literals and placeholders. `$$` is a literal dollar.
 * Returns `undefined` when a `$` is left dangling, because silently treating a
 * typo as literal text would quietly search for the wrong thing.
 */
export function parsePattern(pattern: string): PatternPart[] | undefined {
	const parts: PatternPart[] = [];
	let literal = '';
	let index = 0;

	const flushLiteral = () => {
		if (literal.length > 0) {
			parts.push({ kind: 'literal', text: literal });
			literal = '';
		}
	};

	while (index < pattern.length) {
		if (pattern[index] !== '$') {
			literal += pattern[index++];
			continue;
		}

		if (pattern.startsWith('$$', index)) {
			literal += '$';
			index += 2;
			continue;
		}

		const match = PLACEHOLDER.exec(pattern.slice(index));
		if (!match) {
			return undefined;
		}

		flushLiteral();
		parts.push({ kind: 'placeholder', name: match[1] });
		index += match[0].length;
	}

	flushLiteral();

	return parts.length > 0 ? parts : undefined;
}

const enum Zone {
	Code = 0,
	String = 1,
	Comment = 2,
}

interface IAnalysis {
	readonly zone: Uint8Array;
	readonly depth: Int32Array;
}

function isWhitespace(char: string): boolean {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/**
 * Classifies every character as code, string, or comment, and records the
 * bracket nesting depth at that point. Computed once per document so matching
 * stays linear in the number of candidate positions.
 */
export function analyze(text: string): IAnalysis {
	const zone = new Uint8Array(text.length);
	const depth = new Int32Array(text.length);

	let current = Zone.Code;
	let quote = '';
	let level = 0;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const next = text[i + 1] ?? '';

		if (current === Zone.Code) {
			if (char === '/' && next === '/') {
				current = Zone.Comment;
			} else if (char === '#') {
				current = Zone.Comment;
			} else if (char === '/' && next === '*') {
				current = Zone.Comment;
				quote = '*';
			} else if (char === '"' || char === '\'' || char === '`') {
				current = Zone.String;
				quote = char;
			} else if (char === '(' || char === '[' || char === '{') {
				level++;
			} else if (char === ')' || char === ']' || char === '}') {
				level = Math.max(0, level - 1);
			}
		} else if (current === Zone.String) {
			if (char === '\\') {
				zone[i] = current;
				depth[i] = level;
				i++;
				if (i < text.length) {
					zone[i] = current;
					depth[i] = level;
				}
				continue;
			}
			if (char === quote) {
				current = Zone.Code;
				quote = '';
			}
		} else if (quote === '*') {
			if (char === '*' && next === '/') {
				zone[i] = current;
				depth[i] = level;
				i++;
				zone[i] = current;
				depth[i] = level;
				current = Zone.Code;
				quote = '';
				continue;
			}
		} else if (char === '\n') {
			current = Zone.Code;
		}

		zone[i] = current;
		depth[i] = level;
	}

	return { zone, depth };
}

function isWordCharacter(char: string | undefined): boolean {
	return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

/**
 * Matches a literal fragment. Whitespace is elastic at token boundaries, so
 * `foo( x )` and `foo(x)` both match the pattern `foo($a$)` — but never inside
 * a word, because `foo` must not match `f oo`.
 */
function matchLiteral(text: string, position: number, literal: string): number | undefined {
	let target = position;
	let index = 0;
	let previous: string | undefined;

	while (index < literal.length) {
		if (isWhitespace(literal[index])) {
			while (index < literal.length && isWhitespace(literal[index])) {
				index++;
			}
			while (target < text.length && isWhitespace(text[target])) {
				target++;
			}
			previous = ' ';
			continue;
		}

		const expected = literal[index];
		if (!isWordCharacter(expected) || !isWordCharacter(previous)) {
			while (target < text.length && isWhitespace(text[target])) {
				target++;
			}
		}

		if (target >= text.length || text[target] !== expected) {
			return undefined;
		}

		previous = expected;
		target++;
		index++;
	}

	return target;
}

/**
 * A placeholder may end only where the code is balanced again and we are back
 * in real code — that is what stops `$x$` in `foo($x$)` from ending inside a
 * nested call or in the middle of a string.
 */
function canEndPlaceholder(analysis: IAnalysis, start: number, end: number): boolean {
	if (end <= start) {
		return false;
	}

	const baseDepth = analysis.depth[start];

	for (let i = start; i < end; i++) {
		if (analysis.depth[i] < baseDepth) {
			return false;
		}
	}

	return analysis.depth[end - 1] === baseDepth && analysis.zone[end - 1] === Zone.Code;
}

function matchParts(
	text: string,
	analysis: IAnalysis,
	parts: readonly PatternPart[],
	partIndex: number,
	position: number,
	bindings: Record<string, string>,
): { end: number; bindings: Record<string, string> } | undefined {

	if (partIndex >= parts.length) {
		return { end: position, bindings };
	}

	const part = parts[partIndex];

	if (part.kind === 'literal') {
		const next = matchLiteral(text, position, part.text);
		return next === undefined ? undefined : matchParts(text, analysis, parts, partIndex + 1, next, bindings);
	}

	const bound = bindings[part.name];
	if (bound !== undefined) {
		// The same placeholder twice means the same code twice.
		const next = matchLiteral(text, position, bound);
		return next === undefined ? undefined : matchParts(text, analysis, parts, partIndex + 1, next, bindings);
	}

	let start = position;
	while (start < text.length && isWhitespace(text[start])) {
		start++;
	}

	for (let end = start + 1; end <= text.length; end++) {
		if (!canEndPlaceholder(analysis, start, end)) {
			continue;
		}

		const captured = text.slice(start, end);
		const attempt = matchParts(text, analysis, parts, partIndex + 1, end, { ...bindings, [part.name]: captured });
		if (attempt) {
			return attempt;
		}
	}

	return undefined;
}

/**
 * Finds every non-overlapping match of `pattern` in `text`.
 */
export function findStructuralMatches(text: string, pattern: string, limit = MAX_MATCHES): IStructuralMatch[] {
	const parts = parsePattern(pattern);
	if (!parts) {
		return [];
	}

	const analysis = analyze(text);
	const matches: IStructuralMatch[] = [];

	for (let start = 0; start < text.length && matches.length < limit; start++) {
		if (isWhitespace(text[start]) || analysis.zone[start] !== Zone.Code) {
			continue;
		}

		const attempt = matchParts(text, analysis, parts, 0, start, {});
		if (!attempt || attempt.end === start) {
			continue;
		}

		matches.push({ start, end: attempt.end, bindings: attempt.bindings });
		start = attempt.end - 1;
	}

	return matches;
}

/**
 * Fills `$name$` in a replacement template from a match. An unknown name is
 * left as written rather than replaced with nothing, so a typo shows up in the
 * preview instead of quietly deleting code.
 */
export function applyReplacement(template: string, bindings: Readonly<Record<string, string>>): string {
	const parts = parsePattern(template);
	if (!parts) {
		return template;
	}

	return parts
		.map(part => part.kind === 'literal' ? part.text : bindings[part.name] ?? `$${part.name}$`)
		.join('');
}

/**
 * Names a pattern uses, in order of first appearance — used to tell the user
 * which placeholders a replacement can refer to.
 */
export function placeholderNames(pattern: string): string[] {
	const parts = parsePattern(pattern) ?? [];
	const seen = new Set<string>();

	for (const part of parts) {
		if (part.kind === 'placeholder') {
			seen.add(part.name);
		}
	}

	return [...seen];
}
