/**
 * 画像の添付（T-040）の単体テスト。
 *
 * **拡張子を信じない**のがこのモジュールの肝なので、
 * 「名前は .png だが中身は違う」を必ず落とすことを押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { detectImageMediaType, describeAttachments, MAX_IMAGE_BYTES, parseDataUrl, toAttachment } from '../core/attachments';

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

test('中身のバイト列から画像の種類を決める', () => {
	assert.deepStrictEqual(
		[PNG, JPEG, GIF, WEBP].map(detectImageMediaType),
		['image/png', 'image/jpeg', 'image/gif', 'image/webp']
	);
});

test('画像でないものは種類を決めない', () => {
	assert.strictEqual(detectImageMediaType(new Uint8Array([0x25, 0x50, 0x44, 0x46])), undefined); // PDF
	assert.strictEqual(detectImageMediaType(new Uint8Array([])), undefined);
	// RIFF だが WEBP ではない（WAV）
	assert.strictEqual(detectImageMediaType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])), undefined);
});

test('名前が .png でも中身が画像でなければ送らない', () => {
	const result = toAttachment('わな.png', new Uint8Array([0x25, 0x50, 0x44, 0x46]), base64);
	assert.deepStrictEqual(result, { ok: false, reason: '画像として読めません（PNG / JPEG / GIF / WebP のみ）' });
});

test('送れる画像は base64 と種類を添えて返す', () => {
	const result = toAttachment('shot.png', PNG, base64);
	assert.ok(result.ok);
	assert.deepStrictEqual(
		{ name: result.attachment.name, mediaType: result.attachment.mediaType, byteLength: result.attachment.byteLength },
		{ name: 'shot.png', mediaType: 'image/png', byteLength: PNG.length }
	);
	assert.strictEqual(result.attachment.data, base64(PNG));
});

test('名前が無ければ既定の名前を付ける（クリップボード経由は名前が無い）', () => {
	const result = toAttachment('', PNG, base64);
	assert.ok(result.ok);
	assert.strictEqual(result.attachment.name, '画像');
});

test('空と大きすぎるものは、理由をつけて断る', () => {
	assert.deepStrictEqual(toAttachment('a.png', new Uint8Array([]), base64), { ok: false, reason: '中身が空です' });
	const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
	huge.set(PNG.slice(0, 8));
	const result = toAttachment('big.png', huge, base64);
	assert.strictEqual(result.ok, false);
	assert.ok(!result.ok && result.reason.startsWith('大きすぎます'), result.ok ? '' : result.reason);
});

test('データ URL から種類と中身を取り出す', () => {
	assert.deepStrictEqual(parseDataUrl('data:image/png;base64,AAAB'), { mediaType: 'image/png', base64: 'AAAB' });
	// 改行が混ざった長いデータでも取れる
	assert.ok(parseDataUrl('data:image/jpeg;base64,AAA\nBBB'));
});

test('データ URL でないものは取り出さない', () => {
	for (const input of ['', 'AAAB', 'data:image/png,AAAB', 'https://example.com/a.png']) {
		assert.strictEqual(parseDataUrl(input), undefined, input);
	}
});

test('添付のまとめは枚数と合計サイズを出す', () => {
	const png = toAttachment('a.png', PNG, base64);
	const jpeg = toAttachment('b.jpg', JPEG, base64);
	assert.ok(png.ok && jpeg.ok);
	assert.strictEqual(describeAttachments([png.attachment, jpeg.attachment]), '画像 2 枚（0KB）');
	assert.strictEqual(describeAttachments([]), '');
});
