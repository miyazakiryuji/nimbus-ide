/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * How many results each category contributes before the list stops being
 * scannable. Search Everywhere is a glance-and-pick surface, not a report.
 */
export const CATEGORY_LIMITS = {
	actions: 10,
	files: 15,
	symbols: 10,
} as const;

/**
 * Which categories a query is asking for. A leading sigil narrows the search
 * the way VS Code users already expect from Quick Open.
 */
export const enum SearchScope {
	All,
	Actions,
	Files,
	Symbols,
}

export interface IParsedQuery {
	readonly scope: SearchScope;
	readonly term: string;
}

/**
 * Splits a leading sigil off the query. `>` narrows to actions and `#` to
 * symbols, matching Quick Open; anything else searches everything.
 */
export function parseQuery(input: string): IParsedQuery {
	const trimmed = input.trim();

	if (trimmed.startsWith('>')) {
		return { scope: SearchScope.Actions, term: trimmed.slice(1).trim() };
	}

	if (trimmed.startsWith('#')) {
		return { scope: SearchScope.Symbols, term: trimmed.slice(1).trim() };
	}

	return { scope: SearchScope.All, term: trimmed };
}

export function includesCategory(scope: SearchScope, category: SearchScope): boolean {
	return scope === SearchScope.All || scope === category;
}

// ── calculator ────────────────────────────────────────────────────────────

const FUNCTIONS: Readonly<Record<string, (value: number) => number>> = {
	sqrt: Math.sqrt,
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	abs: Math.abs,
	ln: Math.log,
	log: Math.log10,
	floor: Math.floor,
	ceil: Math.ceil,
	round: Math.round,
};

const CONSTANTS: Readonly<Record<string, number>> = {
	pi: Math.PI,
	e: Math.E,
};

type Token =
	| { readonly kind: 'number'; readonly value: number; readonly plain: boolean }
	| { readonly kind: 'identifier'; readonly value: string }
	| { readonly kind: 'operator'; readonly value: string }
	| { readonly kind: 'paren'; readonly value: '(' | ')' };

const OPERATORS = new Set(['+', '-', '*', '/', '%', '^']);

/**
 * `plain` marks a run-of-the-mill decimal literal. A query that is nothing but
 * one of those ("42") is a search term, not a sum worth answering.
 */
function tokenize(input: string): Token[] | undefined {
	const tokens: Token[] = [];
	let i = 0;

	while (i < input.length) {
		const char = input[i];

		if (char === ' ' || char === '\t') {
			i++;
			continue;
		}

		if (char === '(' || char === ')') {
			tokens.push({ kind: 'paren', value: char });
			i++;
			continue;
		}

		if (OPERATORS.has(char)) {
			tokens.push({ kind: 'operator', value: char });
			i++;
			continue;
		}

		const radix = /^0([xbo])([0-9a-fA-F]+)/.exec(input.slice(i));
		if (radix) {
			const base = radix[1] === 'x' ? 16 : radix[1] === 'b' ? 2 : 8;
			const value = parseInt(radix[2], base);
			if (!Number.isFinite(value)) {
				return undefined;
			}
			tokens.push({ kind: 'number', value, plain: false });
			i += radix[0].length;
			continue;
		}

		const decimal = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(input.slice(i));
		if (decimal) {
			tokens.push({ kind: 'number', value: Number(decimal[0]), plain: true });
			i += decimal[0].length;
			continue;
		}

		const identifier = /^[a-zA-Z]+/.exec(input.slice(i));
		if (identifier) {
			tokens.push({ kind: 'identifier', value: identifier[0].toLowerCase() });
			i += identifier[0].length;
			continue;
		}

		return undefined;
	}

	return tokens;
}

class Parser {

	private index = 0;

	constructor(private readonly tokens: readonly Token[]) { }

	get atEnd(): boolean {
		return this.index >= this.tokens.length;
	}

	private peek(): Token | undefined {
		return this.tokens[this.index];
	}

	private eatOperator(...values: string[]): string | undefined {
		const token = this.peek();
		if (token?.kind === 'operator' && values.includes(token.value)) {
			this.index++;
			return token.value;
		}
		return undefined;
	}

	parseExpression(): number | undefined {
		let left = this.parseTerm();
		if (left === undefined) {
			return undefined;
		}

		for (;;) {
			const operator = this.eatOperator('+', '-');
			if (!operator) {
				return left;
			}

			const right = this.parseTerm();
			if (right === undefined) {
				return undefined;
			}

			left = operator === '+' ? left + right : left - right;
		}
	}

	private parseTerm(): number | undefined {
		let left = this.parsePower();
		if (left === undefined) {
			return undefined;
		}

		for (;;) {
			const operator = this.eatOperator('*', '/', '%');
			if (!operator) {
				return left;
			}

			const right = this.parsePower();
			if (right === undefined) {
				return undefined;
			}

			left = operator === '*' ? left * right : operator === '/' ? left / right : left % right;
		}
	}

	/**
	 * Exponentiation binds tighter than multiplication and is right associative,
	 * so `2^3^2` is 512 rather than 64.
	 */
	private parsePower(): number | undefined {
		const base = this.parseUnary();
		if (base === undefined) {
			return undefined;
		}

		if (!this.eatOperator('^')) {
			return base;
		}

		const exponent = this.parsePower();
		return exponent === undefined ? undefined : base ** exponent;
	}

	private parseUnary(): number | undefined {
		const sign = this.eatOperator('+', '-');
		if (!sign) {
			return this.parsePrimary();
		}

		const value = this.parseUnary();
		return value === undefined ? undefined : (sign === '-' ? -value : value);
	}

	private parsePrimary(): number | undefined {
		const token = this.peek();
		if (!token) {
			return undefined;
		}

		if (token.kind === 'number') {
			this.index++;
			return token.value;
		}

		if (token.kind === 'paren' && token.value === '(') {
			this.index++;
			const value = this.parseExpression();
			const closing = this.peek();
			if (value === undefined || closing?.kind !== 'paren' || closing.value !== ')') {
				return undefined;
			}
			this.index++;
			return value;
		}

		if (token.kind === 'identifier') {
			this.index++;

			const constant = CONSTANTS[token.value];
			if (constant !== undefined) {
				return constant;
			}

			const fn = FUNCTIONS[token.value];
			if (!fn) {
				return undefined;
			}

			const opening = this.peek();
			if (opening?.kind !== 'paren' || opening.value !== '(') {
				return undefined;
			}
			this.index++;

			const argument = this.parseExpression();
			const closing = this.peek();
			if (argument === undefined || closing?.kind !== 'paren' || closing.value !== ')') {
				return undefined;
			}
			this.index++;

			return fn(argument);
		}

		return undefined;
	}
}

/**
 * Evaluates a query as arithmetic, or returns `undefined` when it is not one.
 *
 * Deliberately hand-parsed rather than handed to `eval`: the query comes
 * straight from the input box, and the picker runs inside the workbench.
 *
 * A query with no operator, function, constant, or non-decimal literal is
 * treated as a search term — answering "42 = 42" is noise, not help.
 */
export function evaluateArithmetic(input: string): number | undefined {
	const tokens = tokenize(input);
	if (!tokens || tokens.length === 0) {
		return undefined;
	}

	const interesting = tokens.some(token =>
		token.kind === 'operator'
		|| token.kind === 'identifier'
		|| (token.kind === 'number' && !token.plain));

	if (!interesting) {
		return undefined;
	}

	const parser = new Parser(tokens);
	const value = parser.parseExpression();

	if (value === undefined || !parser.atEnd || !Number.isFinite(value)) {
		return undefined;
	}

	return value;
}

/**
 * Trims floating point noise (`0.30000000000000004`) without turning whole
 * numbers into decimals.
 */
export function formatNumber(value: number): string {
	if (Number.isInteger(value)) {
		return String(value);
	}

	return String(Number(value.toPrecision(12)));
}
