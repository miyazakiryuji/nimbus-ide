/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildRecordArgs,
	buildTranscribeArgs,
	cleanTranscript,
	confirmationMessage,
	defaultDevice,
	describeMissing,
	ENGINES,
	parseAudioDevices,
	pickEngine,
	riskyWords
} from '../core/voiceInput';

test('入っているものから選ぶ。何も無ければ選ばない', () => {
	assert.strictEqual(pickEngine([])?.command, undefined);
	assert.strictEqual(pickEngine(['whisper'])?.command, 'whisper');
	// 2 つ入っていれば、入れた意図が明らかなほうを好む
	assert.strictEqual(pickEngine(['whisper', 'mlx_whisper'])?.command, 'mlx_whisper');
});

test('録音は 16 kHz・モノラル（書き起こしがどれもその形に落とすため）', () => {
	assert.deepStrictEqual(buildRecordArgs({ seconds: 15, device: 0, outputPath: '/tmp/a.wav' }), [
		'-y',
		'-f',
		'avfoundation',
		'-i',
		':0',
		'-t',
		'15',
		'-ac',
		'1',
		'-ar',
		'16000',
		'/tmp/a.wav'
	]);
});

test('0 秒を頼まれても 1 秒は録る', () => {
	assert.strictEqual(buildRecordArgs({ seconds: 0, device: 0, outputPath: '/tmp/a.wav' })[6], '1');
});

test('書き起こしの引数は、ツールごとに違う形になる', () => {
	const [mlx, , cpp] = ENGINES;
	const options = { audioPath: '/tmp/a.wav', outputDir: '/tmp/out', modelPath: '/m/ggml.bin' };
	assert.deepStrictEqual(buildTranscribeArgs(mlx, options), [
		'/tmp/a.wav',
		'--language',
		'ja',
		'--output_format',
		'txt',
		'--output_dir',
		'/tmp/out'
	]);
	assert.deepStrictEqual(buildTranscribeArgs(cpp, options), [
		'-m',
		'/m/ggml.bin',
		'-f',
		'/tmp/a.wav',
		'-l',
		'ja',
		'-otxt',
		'-of',
		'/tmp/out/voice'
	]);
});

test('言葉は指定できる（既定は日本語）', () => {
	assert.ok(buildTranscribeArgs(ENGINES[1], { audioPath: '/a', outputDir: '/o', language: 'en' }).includes('en'));
});

test('時刻の印を落として、1 つの指示にまとめる', () => {
	assert.strictEqual(
		cleanTranscript('[00:00.000 --> 00:02.000]  テストを通して\n\n[00:02.000 --> 00:03.000] ください\n'),
		'テストを通して ください'
	);
});

test('聞き取れなければ、それらしい文をでっち上げない', () => {
	assert.strictEqual(cleanTranscript('\n\n   \n'), '');
	assert.ok(confirmationMessage('').includes('聞き取れませんでした'));
});

test('どんな内容でも、送る前に確認する', () => {
	assert.ok(confirmationMessage('テストを通して').includes('これで送りますか'));
});

test('取り消しの利かない言葉が入っていたら、何が引っかかったかも言う', () => {
	assert.deepStrictEqual(riskyWords('ブランチを削除して強制 push して'), ['消す', '強制', '外に出す']);
	const message = confirmationMessage('ブランチを削除して');
	assert.ok(message.includes('消す'));
	assert.ok(message.includes('読み直してください'));
});

test('聞き間違いで困らない言葉は、危ない扱いにしない', () => {
	assert.deepStrictEqual(riskyWords('テストを通しておいて'), []);
});

test('入っていないときは、入れかたと「外に送らない」ことを言う', () => {
	const text = describeMissing(false);
	assert.ok(text.includes('brew install ffmpeg'));
	assert.ok(text.includes('pip install -U openai-whisper'));
	assert.ok(text.includes('どれも外に送りません'));
	// ffmpeg があるときは、そちらは済みとして出す
	assert.ok(describeMissing(true).includes('✅ 録音'));
});

/** 実機の `ffmpeg -list_devices` 出力（2026-08-13 に採取した形） */
const DEVICE_LIST = [
	'[AVFoundation indev @ 0x1] AVFoundation video devices:',
	'[AVFoundation indev @ 0x1] [0] FaceTime HD Camera',
	'[AVFoundation indev @ 0x1] AVFoundation audio devices:',
	'[AVFoundation indev @ 0x1] [0] BlackHole 2ch',
	'[AVFoundation indev @ 0x1] [1] MacBook Airのマイク',
	'[AVFoundation indev @ 0x1] [2] Microsoft Teams Audio',
	'[AVFoundation indev @ 0x1] [3] iPhoneのマイク'
].join('\n');

test('音声デバイスだけを読む（映像のほうを混ぜない）', () => {
	assert.deepStrictEqual(parseAudioDevices(DEVICE_LIST), [
		{ index: 0, name: 'BlackHole 2ch' },
		{ index: 1, name: 'MacBook Airのマイク' },
		{ index: 2, name: 'Microsoft Teams Audio' },
		{ index: 3, name: 'iPhoneのマイク' }
	]);
});

test('既定は仮想オーディオではなくマイク（0 番決め打ちにしない）', () => {
	// 実機では 0 番が BlackHole だった。決め打ちだと喋っても何も録れない
	assert.deepStrictEqual(defaultDevice(parseAudioDevices(DEVICE_LIST)), { index: 1, name: 'MacBook Airのマイク' });
});

test('マイクらしい名前が無ければ、ループバック以外を選ぶ', () => {
	assert.deepStrictEqual(defaultDevice([{ index: 0, name: 'BlackHole 2ch' }, { index: 1, name: 'USB Audio' }]), {
		index: 1,
		name: 'USB Audio'
	});
	// それも無ければ、あるものを使う（勝手に諦めない）
	assert.deepStrictEqual(defaultDevice([{ index: 0, name: 'BlackHole 2ch' }]), { index: 0, name: 'BlackHole 2ch' });
	assert.strictEqual(defaultDevice([]), undefined);
});
