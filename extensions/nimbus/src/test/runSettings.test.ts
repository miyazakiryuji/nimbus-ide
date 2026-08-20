/**
 * 走らせかた（モデル・エフォート）の整えかた（T-291）。
 *
 * **候補は SDK から引く。** 手で並べた一覧は必ず古くなるし、
 * モデルごとに使えるエフォートが違う。ここで確かめるのは
 * 「受け取ったものを、空欄を作らずに画面へ出せる形にできるか」。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	effortLabel,
	effortsFor,
	findModel,
	modelLabel,
	toModelOptions,
	type SdkModelInfo
} from '../core/runSettings';

const MODELS: SdkModelInfo[] = [
	{
		value: 'opus',
		resolvedModel: 'claude-opus-5',
		displayName: 'Opus 5',
		description: '最も賢い',
		supportsEffort: true,
		supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
	},
	{
		value: 'sonnet',
		resolvedModel: 'claude-sonnet-5',
		displayName: 'Sonnet 5',
		description: '速い',
		supportsEffort: true,
		supportedEffortLevels: ['medium', 'high']
	},
	{ value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku 4.5', supportsEffort: false }
];

test('SDK の一覧を、そのまま選ばせられる形にする（T-291）', () => {
	assert.deepStrictEqual(toModelOptions(MODELS), [
		{
			value: 'opus',
			label: 'Opus 5',
			description: '最も賢い',
			efforts: ['low', 'medium', 'high', 'xhigh', 'max']
		},
		{ value: 'sonnet', label: 'Sonnet 5', description: '速い', efforts: ['medium', 'high'] },
		{ value: 'haiku', label: 'Haiku 4.5', description: '', efforts: [] }
	]);
});

test('名前が無いモデルは id で出す。値の無い行は落とす（T-291）', () => {
	assert.deepStrictEqual(
		toModelOptions([{ value: 'custom-1' }, { value: '' } as SdkModelInfo, undefined as unknown as SdkModelInfo]),
		[{ value: 'custom-1', label: 'custom-1', description: '', efforts: [] }]
	);
});

test('知らないエフォートの段は落とす（生の英語を画面に出さない）（T-291）', () => {
	assert.deepStrictEqual(
		toModelOptions([{ value: 'x', supportedEffortLevels: ['low', 'ludicrous', 'max'] }])[0].efforts,
		['low', 'max']
	);
});

test('セッションが名乗る id と一覧の別名を突き合わせる（T-291）', () => {
	assert.deepStrictEqual(
		[
			findModel(MODELS, 'opus')?.value,
			findModel(MODELS, 'claude-sonnet-5')?.value,
			// `[1m]` のような後ろ足しが付いても拾う
			findModel(MODELS, 'claude-opus-5[1m]')?.value,
			findModel(MODELS, '知らないモデル')?.value,
			findModel(MODELS, undefined)?.value
		],
		['opus', 'sonnet', 'opus', undefined, undefined]
	);
});

test('帯に出す文字は、分からなくても空欄にしない（T-291）', () => {
	assert.deepStrictEqual(
		[
			modelLabel(MODELS, 'claude-opus-5[1m]'),
			modelLabel(MODELS, '知らないモデル'),
			modelLabel(MODELS, undefined),
			effortLabel('xhigh'),
			effortLabel(undefined),
			effortLabel('ludicrous')
		],
		['Opus 5', '知らないモデル', undefined, '特高', '既定', '既定']
	);
});

test('エフォートを持たないモデルでは、選ばせない（T-291）', () => {
	assert.deepStrictEqual(
		[effortsFor(MODELS, 'claude-haiku-4-5'), effortsFor(MODELS, 'sonnet'), effortsFor(MODELS, undefined)],
		[[], ['medium', 'high'], []]
	);
});
