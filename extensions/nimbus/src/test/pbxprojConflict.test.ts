/**
 * Xcode プロジェクトの衝突解消（T-199）の単体テスト。
 *
 * **半端に直さないこと**が要点。1 つでも怪しければ何も書き換えない。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { describeResult, parseConflicts, resolveBlock, resolvePbxproj } from '../core/pbxprojConflict';

const conflict = (ours: string[], theirs: string[]): string =>
	['前の行', '<<<<<<< HEAD', ...ours, '=======', ...theirs, '>>>>>>> other', '後の行'].join('\n');

const entry = (id: string, name: string): string => `\t\t${id} /* ${name} */ = {isa = PBXBuildFile; };`;

test('衝突の塊を取り出す', () => {
	const blocks = parseConflicts(conflict([entry('A'.repeat(24), 'a.swift')], [entry('B'.repeat(24), 'b.swift')]));
	assert.deepStrictEqual({ count: blocks.length, line: blocks[0].line, ours: blocks[0].ours.length }, {
		count: 1,
		line: 1,
		ours: 1
	});
});

test('両側がエントリを足しただけなら、両方残す', () => {
	const merged = resolveBlock({
		line: 0,
		ours: [entry('A'.repeat(24), 'a.swift')],
		theirs: [entry('B'.repeat(24), 'b.swift')]
	});
	assert.strictEqual(merged?.length, 2);
});

test('同じエントリは 1 つに畳む', () => {
	const same = entry('A'.repeat(24), 'a.swift');
	assert.strictEqual(resolveBlock({ line: 0, ours: [same], theirs: [same] })?.length, 1);
});

test('構造（括弧や isa の並び）を触っていたら解かない', () => {
	assert.strictEqual(resolveBlock({ line: 0, ours: ['\t\t};'], theirs: ['\t\tbuildPhases = ('] }), undefined);
});

test('全部解ければ中身を返し、衝突マーカーが消える', () => {
	const result = resolvePbxproj(conflict([entry('A'.repeat(24), 'a.swift')], [entry('B'.repeat(24), 'b.swift')]));
	assert.deepStrictEqual(
		{
			resolved: result.resolved,
			hasMarker: /<{7}|={7}|>{7}/.test(result.content ?? ''),
			keepsBoth: (result.content ?? '').includes('a.swift') && (result.content ?? '').includes('b.swift'),
			keepsSurrounding: (result.content ?? '').startsWith('前の行') && (result.content ?? '').endsWith('後の行')
		},
		{ resolved: 1, hasMarker: false, keepsBoth: true, keepsSurrounding: true }
	);
});

test('1 つでも解けない塊があれば、何も書き換えない', () => {
	const source = [
		conflict([entry('A'.repeat(24), 'a.swift')], [entry('B'.repeat(24), 'b.swift')]),
		conflict(['\t\tbuildPhases = ('], ['\t\t};'])
	].join('\n');
	const result = resolvePbxproj(source);
	assert.deepStrictEqual({ content: result.content, resolved: result.resolved }, { content: undefined, resolved: 0 });
});

test('衝突が無ければ、その旨を返す', () => {
	assert.strictEqual(resolvePbxproj('ふつうの中身').reason, '衝突は見つかりませんでした');
});

test('解けたときは、確かめる場所まで書く', () => {
	const result = resolvePbxproj(conflict([entry('A'.repeat(24), 'a.swift')], [entry('B'.repeat(24), 'b.swift')]));
	assert.ok(describeResult(result).includes('Xcode で開いて確かめて'));
});
