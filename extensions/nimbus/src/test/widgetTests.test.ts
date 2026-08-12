/**
 * Widget テストの雛形づくり（T-193）の単体テスト。
 *
 * 雛形は「そのまま `flutter test` に通せること」が値打ちなので、
 * **コンストラクタの引数を取り違えない**ことを重点的に押さえる。
 * Dart の完全なパーサではないので、読み切れないものを**黙って埋めない**ことも確かめる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildTestSource,
	findWidgets,
	packageImport,
	packageNameOf,
	snake,
	testPathFor
} from '../core/widgetTests';

test('StatelessWidget と StatefulWidget を拾い、それ以外は拾わない', () => {
	const source = `
		class Card extends StatelessWidget {}
		class Counter extends StatefulWidget {}
		class Model extends ChangeNotifier {}
		class Base {}
	`;
	assert.deepStrictEqual(
		findWidgets(source).map((w) => [w.name, w.kind]),
		[['Card', 'stateless'], ['Counter', 'stateful']]
	);
});

test('名前つき引数を required つきで読み、key は落とす', () => {
	const source = `
		class Greeting extends StatelessWidget {
			const Greeting({super.key, required this.name, this.times = 1});
			final String name;
			final int times;
		}
	`;
	assert.deepStrictEqual(findWidgets(source)[0].params, [
		{ name: 'name', type: 'String', named: true, required: true },
		{ name: 'times', type: 'int', named: true, required: false }
	]);
});

test('`this.x` の型はフィールド宣言から補う（型が書かれていないため）', () => {
	const source = `
		class Tile extends StatelessWidget {
			const Tile({required this.label, required this.onTap});
			final String label;
			final VoidCallback onTap;
		}
	`;
	assert.deepStrictEqual(
		findWidgets(source)[0].params.map((p) => `${p.name}:${p.type}`),
		['label:String', 'onTap:VoidCallback']
	);
});

test('総称型のカンマで引数を割らない', () => {
	const source = `
		class Chart extends StatelessWidget {
			const Chart({required this.points, required this.labels});
			final Map<String, int> points;
			final List<String> labels;
		}
	`;
	assert.deepStrictEqual(
		findWidgets(source)[0].params.map((p) => `${p.name}:${p.type}`),
		['points:Map<String, int>', 'labels:List<String>']
	);
});

test('コメントや文字列の中の class に引っかからない', () => {
	const source = `
		// class Fake extends StatelessWidget {}
		/* class AlsoFake extends StatelessWidget {} */
		const note = 'class Quoted extends StatelessWidget {}';
		class Real extends StatelessWidget {}
	`;
	assert.deepStrictEqual(findWidgets(source).map((w) => w.name), ['Real']);
});

test('位置引数も読む', () => {
	const source = `
		class Box extends StatelessWidget {
			const Box(this.width, this.height);
			final double width;
			final double height;
		}
	`;
	assert.deepStrictEqual(
		findWidgets(source)[0].params.map((p) => [p.name, p.named]),
		[['width', false], ['height', false]]
	);
});

test('テストの置き場所は lib/ を test/ に写し、_test を付ける', () => {
	assert.deepStrictEqual(
		[
			testPathFor('lib/widgets/card.dart'),
			testPathFor('lib/main.dart'),
			testPathFor('test/foo.dart'),
			testPathFor('lib/foo.txt')
		],
		['test/widgets/card_test.dart', 'test/main_test.dart', undefined, undefined]
	);
});

test('import は相対パスではなく package: で書く', () => {
	assert.deepStrictEqual(
		[packageImport('my_app', 'lib/widgets/card.dart'), packageImport('my_app', 'bin/x.dart')],
		['package:my_app/widgets/card.dart', undefined]
	);
	assert.deepStrictEqual(
		[packageNameOf('name: my_app\nversion: 1.0.0\n'), packageNameOf('version: 1.0.0\n')],
		['my_app', undefined]
	);
});

test('ゴールデン画像の名前は snake_case', () => {
	assert.deepStrictEqual(['MyCard', 'HTTPClient', 'A'].map(snake), ['my_card', 'http_client', 'a']);
});

test('引数の無い widget は const で組み立てる', () => {
	const source = 'class Plain extends StatelessWidget { const Plain({super.key}); }';
	const out = buildTestSource({ widget: findWidgets(source)[0], importPath: 'package:app/plain.dart', golden: false });
	assert.ok(out.includes('body: Plain()'), out);
	assert.ok(out.includes('expect(find.byType(Plain), findsOneWidget);'), out);
	assert.ok(!out.includes('matchesGoldenFile'), 'golden を頼んでいないのに入っている');
});

test('型の分かる引数には値を入れ、分からない型は埋めずに TODO を残す', () => {
	const source = `
		class Mixed extends StatelessWidget {
			const Mixed({required this.title, required this.count, required this.flag, required this.repo});
			final String title;
			final int count;
			final bool flag;
			final UserRepository repo;
		}
	`;
	const out = buildTestSource({ widget: findWidgets(source)[0], importPath: 'package:app/mixed.dart', golden: false });
	// それらしい値を入れて「通ったつもり」にさせない
	assert.ok(out.includes("title: 'テキスト'"), out);
	assert.ok(out.includes('count: 0'), out);
	assert.ok(out.includes('flag: false'), out);
	assert.ok(out.includes('repo: null /* TODO: UserRepository を渡す */'), out);
});

test('ゴールデンを頼むと、基準画像の作りかたまで書いておく', () => {
	const source = 'class MyCard extends StatelessWidget { const MyCard({super.key}); }';
	const out = buildTestSource({ widget: findWidgets(source)[0], importPath: 'package:app/my_card.dart', golden: true });
	assert.ok(out.includes("matchesGoldenFile('goldens/my_card.png')"), out);
	assert.ok(out.includes('--update-goldens'), '初回の作りかたが書かれていない');
});

test('雛形は import と group を備えた、そのまま置ける形になっている', () => {
	const source = 'class Plain extends StatelessWidget { const Plain({super.key}); }';
	const out = buildTestSource({ widget: findWidgets(source)[0], importPath: 'package:app/plain.dart', golden: false });
	assert.deepStrictEqual(out.split('\n').slice(0, 6), [
		"import 'package:flutter/material.dart';",
		"import 'package:flutter_test/flutter_test.dart';",
		"import 'package:app/plain.dart';",
		'',
		'void main() {',
		"  group('Plain', () {"
	]);
});
