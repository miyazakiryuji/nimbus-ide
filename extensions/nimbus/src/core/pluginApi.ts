/**
 * 他の拡張が Nimbus に機能を足すための約束（tasks.md T-092）。
 *
 * ここは**契約と検査だけ**。VS Code にも SDK にも依存しないので単体で検証できる。
 * 実際の受け口は `src/nimbusApi.ts`。
 *
 * 方針は 2 つ。
 *
 * **1. 足せるのは「読ませるもの」と「作らせるもの」だけ。**
 * 権限の判断（`core/risk.ts` / `core/secrets.ts` / `core/permissionRules.ts`）には
 * 触らせない。ここを開くと、拡張を 1 つ入れただけで承認の意味が消える。
 *
 * **2. 名前は必ず拡張 ID で namespace を切る。**
 * 誰が足したものかが分からないと、動きがおかしいときに切り分けられない。
 */

/** 拡張が足せるもの */
export type ContributionKind =
	/** セッションへ渡す文脈（読ませるもの） */
	| 'context'
	/** コックピットから呼べる定型の指示（作らせるもの） */
	| 'action';

export interface PluginContribution {
	kind: ContributionKind;
	/** 拡張の中で一意な名前。`nimbus.` で始めてはいけない（本体と紛れる） */
	id: string;
	/** 一覧に出す名前 */
	label: string;
	description?: string;
}

/** 登録されたもの。誰が足したかを必ず持つ */
export interface RegisteredContribution extends PluginContribution {
	/** 足した拡張の ID */
	extensionId: string;
	/** 画面と記録で使う一意な名前（`<拡張 ID>/<id>`） */
	qualifiedId: string;
}

export type RegisterResult =
	| { ok: true; registered: RegisteredContribution }
	| { ok: false; reason: string };

/** `publisher.name` の形。ここを緩めると出どころが辿れなくなる */
const EXTENSION_ID = /^[a-z0-9][\w-]*\.[a-z0-9][\w-]*$/i;

/** 使ってよい ID。記号を許すと画面と記録の両方で扱いにくくなる */
const CONTRIBUTION_ID = /^[a-z0-9][\w-]*$/i;

/** 1 拡張が足してよい数の上限。無制限にすると一覧が使えなくなる */
export const MAX_PER_EXTENSION = 20;

/** 表示名の上限。長い名前で一覧を壊されないようにする */
const MAX_LABEL = 60;

/**
 * 登録してよいかを判断する。
 *
 * **断るときは必ず理由を言う。** 拡張を書いている人は Nimbus の中を見られないので、
 * 「登録できませんでした」だけでは直しようがない。
 */
export function validate(
	extensionId: string,
	contribution: PluginContribution,
	existing: readonly RegisteredContribution[]
): RegisterResult {
	if (!EXTENSION_ID.test(extensionId)) {
		return { ok: false, reason: `拡張 ID の形が違います（publisher.name の形で渡してください）: ${extensionId}` };
	}
	if (!CONTRIBUTION_ID.test(contribution.id)) {
		return { ok: false, reason: `id は英数字と - _ だけにしてください: ${contribution.id}` };
	}
	if (contribution.id.startsWith('nimbus')) {
		return { ok: false, reason: 'id を nimbus で始めることはできません（本体のものと紛れます）' };
	}
	const label = contribution.label.trim();
	if (label.length === 0) {
		return { ok: false, reason: 'label が空です' };
	}
	if (label.length > MAX_LABEL) {
		return { ok: false, reason: `label が長すぎます（${MAX_LABEL} 文字まで）` };
	}
	const mine = existing.filter((item) => item.extensionId === extensionId);
	if (mine.length >= MAX_PER_EXTENSION) {
		return { ok: false, reason: `1 つの拡張が足せるのは ${MAX_PER_EXTENSION} 件までです` };
	}
	const qualifiedId = `${extensionId}/${contribution.id}`;
	if (existing.some((item) => item.qualifiedId === qualifiedId)) {
		return { ok: false, reason: `同じ id が既に登録されています: ${qualifiedId}` };
	}
	return { ok: true, registered: { ...contribution, label, extensionId, qualifiedId } };
}

/**
 * 拡張が足した文脈を、セッションへ渡す形にまとめる。
 *
 * **出どころを必ず添える。** 誰が足した文脈なのかが分からないと、
 * 妙な前提が入ったときに、どの拡張を外せばいいかが分からない。
 */
export function formatContext(items: readonly { qualifiedId: string; label: string; text: string }[]): string {
	const usable = items.filter((item) => item.text.trim().length > 0);
	if (usable.length === 0) {
		return '';
	}
	const lines = ['## 拡張が足した前提', ''];
	for (const item of usable) {
		lines.push(`### ${item.label}（${item.qualifiedId}）`, '', item.text.trim(), '');
	}
	return lines.join('\n').trimEnd();
}

/** 1 つの拡張が渡してよい文脈の大きさ。1 つが枠を食い尽くさないようにする */
export const MAX_CONTEXT_BYTES = 16 * 1024;

/** 大きすぎる文脈を切る。**切ったことを本文に書く**（黙って切ると嘘になる） */
export function clampContext(text: string, max = MAX_CONTEXT_BYTES): string {
	const bytes = Buffer.byteLength(text, 'utf8');
	if (bytes <= max) {
		return text;
	}
	// UTF-8 の途中で切らないように、文字単位で削る
	let result = text;
	while (Buffer.byteLength(result, 'utf8') > max - 64 && result.length > 0) {
		result = result.slice(0, Math.floor(result.length * 0.9));
	}
	return `${result}\n（長いので ${bytes} バイトのうちここまでを渡しました）`;
}
