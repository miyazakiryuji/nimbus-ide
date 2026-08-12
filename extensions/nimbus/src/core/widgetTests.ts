/**
 * Widget テスト / ゴールデンテストの雛形づくり（tasks.md T-193）。
 *
 * 「テストを書いて」と頼むだけなら Claude Code 単体でできる。エディタの上に乗る意味は、
 * **開いているファイルから widget の実際の形（コンストラクタの引数）を読み取り、
 * 規約どおりの場所に置く**ところにある。引数を取り違えた雛形は、そのままでは通らない。
 *
 * Dart の完全なパーサは持たない（持つべきでもない）。ここで扱うのは
 * **雛形を作るのに足りるだけ**の読み取りで、読み切れないものは黙って諦める。
 * 中途半端に埋めるより「引数はご自身で」と言うほうが安全なので。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface WidgetParam {
	name: string;
	type: string;
	/** 名前つき引数か（`{...}` の中にあるか） */
	named: boolean;
	/** `required` が付いているか */
	required: boolean;
}

export interface WidgetInfo {
	name: string;
	/** StatelessWidget / StatefulWidget のどちらを継承しているか */
	kind: 'stateless' | 'stateful';
	params: WidgetParam[];
}

/** コメントと文字列を潰す。中に出てくる `class` や括弧に引っかからないようにするため */
function stripNoise(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/\/\/[^\n]*/g, ' ')
		.replace(/'''[\s\S]*?'''/g, "''")
		.replace(/"""[\s\S]*?"""/g, '""')
		.replace(/'(?:\\.|[^'\\\n])*'/g, "''")
		.replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/** `(` から対応する `)` までを返す。見つからなければ undefined */
function balanced(source: string, open: number): string | undefined {
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		const ch = source[i];
		if (ch === '(') {
			depth++;
		} else if (ch === ')') {
			depth--;
			if (depth === 0) {
				return source.slice(open + 1, i);
			}
		}
	}
	return undefined;
}

/** 深さ 0 のカンマで割る。`Map<String, int> x` を 2 つに割らないため */
function splitTopLevel(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (const ch of text) {
		if ('([{<'.includes(ch)) {
			depth++;
		} else if (')]}>'.includes(ch)) {
			depth--;
		}
		if (ch === ',' && depth === 0) {
			parts.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	if (current.trim()) {
		parts.push(current);
	}
	return parts;
}

/**
 * コンストラクタの引数を読む。
 * `this.foo` の形は型が書かれていないので、同じクラスのフィールド宣言から型を拾う。
 */
function parseParams(signature: string, fieldTypes: Map<string, string>): WidgetParam[] {
	const params: WidgetParam[] = [];
	// 名前つき `{...}` と、位置 `[...]` を分ける
	const namedMatch = /\{([\s\S]*)\}/.exec(signature);
	const positional = signature.replace(/\{[\s\S]*\}/, '').replace(/\[[\s\S]*\]/, '');

	const read = (chunk: string, named: boolean): void => {
		for (const raw of splitTopLevel(chunk)) {
			const part = raw.trim().replace(/=[\s\S]*$/, '').trim();
			if (!part) {
				continue;
			}
			const required = /\brequired\b/.test(part);
			const body = part.replace(/\brequired\b/, '').trim();
			// key は雛形に出さない（Flutter 側の作法で、テストからは渡さない）
			const thisField = /^this\.(\w+)$/.exec(body);
			if (thisField) {
				const name = thisField[1];
				if (name === 'key') {
					continue;
				}
				params.push({ name, type: fieldTypes.get(name) ?? 'dynamic', named, required });
				continue;
			}
			const typed = /^([\w<>,\s?.]+?)\s+(\w+)$/.exec(body);
			if (typed) {
				const name = typed[2];
				if (name === 'key') {
					continue;
				}
				params.push({ name, type: typed[1].replace(/\s+/g, ' ').trim(), named, required });
			}
		}
	};

	read(positional, false);
	if (namedMatch) {
		read(namedMatch[1], true);
	}
	return params;
}

/** クラス本体からフィールドの型を拾う（`final String title;`） */
function readFieldTypes(body: string): Map<string, string> {
	const types = new Map<string, string>();
	for (const match of body.matchAll(/(?:final|const|late)\s+([\w<>,\s?.]+?)\s+(\w+)\s*[;=]/g)) {
		types.set(match[2], match[1].replace(/\s+/g, ' ').trim());
	}
	return types;
}

/**
 * Dart のソースから widget を拾う。
 * `class X extends StatelessWidget` / `StatefulWidget` だけを対象にする。
 */
export function findWidgets(source: string): WidgetInfo[] {
	const clean = stripNoise(source);
	const widgets: WidgetInfo[] = [];
	for (const match of clean.matchAll(/\bclass\s+(\w+)\s+extends\s+(StatelessWidget|StatefulWidget)\b/g)) {
		const name = match[1];
		const kind = match[2] === 'StatelessWidget' ? 'stateless' : 'stateful';
		// クラス本体（次の class までで十分。雛形づくりの範囲では取りこぼしても害が無い）
		const start = match.index ?? 0;
		const nextClass = clean.indexOf('class ', start + 6);
		const body = clean.slice(start, nextClass > 0 ? nextClass : undefined);

		const fieldTypes = readFieldTypes(body);
		// `const X({...})` / `X({...})` — クラス名と同じ名前の関数がコンストラクタ
		const ctor = new RegExp(`(?:const\\s+)?${name}\\s*\\(`).exec(body);
		const signature = ctor ? balanced(body, (ctor.index ?? 0) + ctor[0].length - 1) : undefined;
		widgets.push({ name, kind, params: signature ? parseParams(signature, fieldTypes) : [] });
	}
	return widgets;
}

/**
 * `lib/a/b.dart` に対するテストの置き場所は `test/a/b_test.dart`。
 * Dart / Flutter の規約で、これ以外に置くと `flutter test` の対象から外れることがある。
 */
export function testPathFor(libRelativePath: string): string | undefined {
	const path = libRelativePath.replace(/\\/g, '/');
	if (!path.startsWith('lib/') || !path.endsWith('.dart')) {
		return undefined;
	}
	return `test/${path.slice('lib/'.length).replace(/\.dart$/, '_test.dart')}`;
}

/** 型から「とりあえず通る値」を作る。分からないものは null にせず、印を残して人に埋めさせる */
function sampleValue(type: string): string {
	const base = type.replace(/\?$/, '').trim();
	if (/^String$/.test(base)) {
		return "'テキスト'";
	}
	if (/^(int|num)$/.test(base)) {
		return '0';
	}
	if (/^double$/.test(base)) {
		return '0.0';
	}
	if (/^bool$/.test(base)) {
		return 'false';
	}
	if (/^List</.test(base)) {
		return 'const []';
	}
	if (/^Map</.test(base)) {
		return 'const {}';
	}
	if (/^(VoidCallback|Function)/.test(base) || /^void\s+Function/.test(base)) {
		return '() {}';
	}
	if (/^Widget$/.test(base)) {
		return 'const SizedBox()';
	}
	// 分からない型は埋めない。それらしい値を入れて「通ったつもり」にさせるほうが害が大きい
	return `null /* TODO: ${base} を渡す */`;
}

/** widget を組み立てる 1 行 */
function construct(widget: WidgetInfo): string {
	if (widget.params.length === 0) {
		return `const ${widget.name}()`;
	}
	const args = widget.params.map((p) => (p.named ? `${p.name}: ${sampleValue(p.type)}` : sampleValue(p.type)));
	return `${widget.name}(${args.join(', ')})`;
}

export interface TestSourceOptions {
	widget: WidgetInfo;
	/** テストから見た import。`package:app/a/b.dart` の形 */
	importPath: string;
	/** ゴールデンも一緒に作るか */
	golden: boolean;
}

/**
 * テストの雛形。**落ちる状態では作らない**（赤いまま放置されると、そのうち誰も見なくなる）。
 * 代わりに「何を確かめるか」を TODO で明示して、書き足す場所を示す。
 */
export function buildTestSource({ widget, importPath, golden }: TestSourceOptions): string {
	const build = construct(widget);
	const lines = [
		"import 'package:flutter/material.dart';",
		"import 'package:flutter_test/flutter_test.dart';",
		`import '${importPath}';`,
		'',
		'void main() {',
		`  group('${widget.name}', () {`,
		`    testWidgets('組み立てられる', (tester) async {`,
		`      await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ${build.startsWith('const ') ? build.slice(6) : build})));`,
		'',
		`      expect(find.byType(${widget.name}), findsOneWidget);`,
		'      // TODO: この widget が何を見せるはずかを書く（find.text(...) など）',
		'    });'
	];

	if (golden) {
		lines.push(
			'',
			`    testWidgets('見た目が変わっていない', (tester) async {`,
			`      await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ${build.startsWith('const ') ? build.slice(6) : build})));`,
			'',
			'      // 初回は `flutter test --update-goldens` で基準の画像を作る',
			`      await expectLater(find.byType(${widget.name}), matchesGoldenFile('goldens/${snake(widget.name)}.png'));`,
			'    });'
		);
	}

	lines.push('  });', '}', '');
	return lines.join('\n');
}

/** `MyCard` → `my_card`。ゴールデン画像の名前は Dart の作法に合わせる */
export function snake(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.toLowerCase();
}

/**
 * `lib/a/b.dart` → `package:<name>/a/b.dart`。
 * テストからは相対パスではなく package: で参照するのが Dart の作法。
 */
export function packageImport(packageName: string, libRelativePath: string): string | undefined {
	const path = libRelativePath.replace(/\\/g, '/');
	if (!path.startsWith('lib/')) {
		return undefined;
	}
	return `package:${packageName}/${path.slice('lib/'.length)}`;
}

/** `pubspec.yaml` から package 名を読む。読めなければ undefined */
export function packageNameOf(pubspec: string): string | undefined {
	const match = /^name:\s*([A-Za-z_][\w]*)\s*$/m.exec(pubspec);
	return match ? match[1] : undefined;
}
