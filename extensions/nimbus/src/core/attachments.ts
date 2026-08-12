/**
 * 画像の添付（tasks.md T-040）。
 *
 * Figma や実機のスクショを貼って「この通りに直して」と言えるようにする。
 * UI の調整は、言葉で説明するより 1 枚見せるほうが速い。
 *
 * **拡張子を信じない。** 貼り付けやドロップで来るものは名前が当てにならない
 * （クリップボード経由だと名前が無いこともある）ので、先頭のバイト列で種類を決める。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** モデルが受け取れる画像。ここに無い形式は送らない */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/**
 * 1 枚あたりの上限。大きすぎる画像は文脈を一気に食い潰すうえ、
 * API 側でも弾かれる。**送る前に**止めて、理由を言う。
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface Signature {
	mediaType: ImageMediaType;
	bytes: number[];
	/** WebP のように、先頭から少し離れた位置に印があるもの用 */
	offset?: number;
}

// 先頭のバイト列（マジックナンバー）。拡張子ではなく中身で判断する
const SIGNATURES: Signature[] = [
	{ mediaType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
	{ mediaType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
	{ mediaType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
	// WebP は "RIFF....WEBP"。4 バイト目からの長さを挟むので位置をずらして見る
	{ mediaType: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }
];

function startsWith(bytes: Uint8Array, signature: Signature): boolean {
	const offset = signature.offset ?? 0;
	if (bytes.length < offset + signature.bytes.length) {
		return false;
	}
	return signature.bytes.every((byte, index) => bytes[offset + index] === byte);
}

/** 中身から画像の種類を決める。分からなければ undefined（＝送らない） */
export function detectImageMediaType(bytes: Uint8Array): ImageMediaType | undefined {
	return SIGNATURES.find((signature) => startsWith(bytes, signature))?.mediaType;
}

export interface Attachment {
	name: string;
	mediaType: ImageMediaType;
	/** base64（データ URL のヘッダは含めない） */
	data: string;
	byteLength: number;
}

export type AttachmentResult = { ok: true; attachment: Attachment } | { ok: false; reason: string };

/**
 * 送ってよい添付かを判定し、送れる形に整える。
 * **断るときは必ず理由を返す**（黙って落とすと「貼ったのに無視された」に見える）。
 */
export function toAttachment(name: string, bytes: Uint8Array, toBase64: (bytes: Uint8Array) => string): AttachmentResult {
	if (bytes.length === 0) {
		return { ok: false, reason: '中身が空です' };
	}
	if (bytes.length > MAX_IMAGE_BYTES) {
		const mb = (bytes.length / 1024 / 1024).toFixed(1);
		return { ok: false, reason: `大きすぎます（${mb}MB・上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB）` };
	}
	const mediaType = detectImageMediaType(bytes);
	if (!mediaType) {
		return { ok: false, reason: '画像として読めません（PNG / JPEG / GIF / WebP のみ）' };
	}
	return {
		ok: true,
		attachment: { name: name || '画像', mediaType, data: toBase64(bytes), byteLength: bytes.length }
	};
}

/** データ URL（`data:image/png;base64,…`）から中身を取り出す。Webview からはこの形で来る */
export function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | undefined {
	const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
	if (!match) {
		return undefined;
	}
	return { mediaType: match[1], base64: match[2] };
}

/** 添付を 1 行で説明する（コックピットの表示とログに使う） */
export function describeAttachments(attachments: readonly Attachment[]): string {
	if (attachments.length === 0) {
		return '';
	}
	const total = attachments.reduce((sum, attachment) => sum + attachment.byteLength, 0);
	return `画像 ${attachments.length} 枚（${Math.round(total / 1024)}KB）`;
}
