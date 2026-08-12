/**
 * 変更を「意図」の単位に束ねる（tasks.md T-114）。
 *
 * README の原則は「1 コミット = 1 つの意図」。守るのが難しいのは、作業していると
 * **複数の意図の変更が作業ツリーに同時に溜まる**からで、あとから手で仕分けるのは骨が折れる。
 * ここはその仕分けを機械側から手伝う。
 *
 * この開発自体が実例になっている — 5 つの AI が 1 つの作業ツリーを共有していて、
 * `git commit -a` は**他人の変更を巻き込む**。だから「自分の意図の分だけ」を
 * `git add -- <パス>` で組む必要があり、その組み立てをここが出す。
 *
 * **判断はしない。束ねて見せるだけ。** どれを 1 つのコミットにするかは人が決める。
 * VS Code に依存しないので単体で検証できる。
 */

export interface ChangedFile {
	/** リポジトリ相対のパス */
	path: string;
	/** git status --porcelain の 2 文字（`??` は追跡外） */
	status: string;
}

export interface CommitGroup {
	/** 見出し。そのままコミットメッセージの 1 行目の下敷きになる */
	title: string;
	/** なぜこの束なのか */
	reason: string;
	files: string[];
}

/** `git status --porcelain` の出力を読む。rename は `->` の右側（今の名前）を採る */
export function parseStatus(porcelain: string): ChangedFile[] {
	const files: ChangedFile[] = [];
	for (const line of porcelain.split('\n')) {
		if (line.length < 4) {
			continue;
		}
		const status = line.slice(0, 2);
		let path = line.slice(3).trim();
		const arrow = path.indexOf(' -> ');
		if (arrow >= 0) {
			path = path.slice(arrow + 4);
		}
		// パスに空白が含まれると git は引用符で囲む
		if (path.startsWith('"') && path.endsWith('"')) {
			path = path.slice(1, -1);
		}
		if (path) {
			files.push({ path, status });
		}
	}
	return files;
}

/** 台帳・仕様・確認記録。実装と同じコミットに載せたいので、実装とは分けずに印だけ付ける */
const LEDGER = /^(tasks\.md|README\.md|CLAUDE\.md|AGENTS\.md)$/;
const DOCS = /^nimbus\/docs\//;
const CORE = /^src\/vs\//;

/**
 * 束の「軸」を決める。
 *
 * 意図を機械が読むことはできないので、**近さ**で代用する。実測でいちばん効いたのは
 * 「拡張の機能ごと（`core/<名前>.ts` と `<名前>View.ts` と `test/<名前>.test.ts`）」の
 * まとまりで、Nimbus のファイルの置きかたがそうなっているため。
 */
function featureKey(path: string): string | undefined {
	const match = /^extensions\/nimbus\/src\/(.+)$/.exec(path);
	if (!match) {
		return undefined;
	}
	// `core/` と `test/` は置き場所であって機能名ではないので、先に外す。
	// これで `core/usage.ts` `usageView.ts` `test/usage.test.ts` が同じ束に寄る
	const rest = match[1].replace(/^(?:core|test|tests)\//, '');
	const first = /^([A-Za-z0-9]+)/.exec(rest);
	return first ? first[1].replace(/View$/, '').toLowerCase() : undefined;
}

/** 束ねる前に、明らかに別物のものを先に分ける */
function bucketOf(path: string): 'core' | 'ledger' | 'docs' | 'feature' {
	if (CORE.test(path)) {
		return 'core';
	}
	if (LEDGER.test(path)) {
		return 'ledger';
	}
	if (DOCS.test(path)) {
		return 'docs';
	}
	return 'feature';
}

/**
 * 変更を意図ごとに束ねる。
 *
 * 順番は「実装 → コア → 記録」。記録（台帳・仕様）は実装と同じコミットに載せるのが
 * この開発の約束なので、**最後に単独の束として出して「どれかに混ぜてください」と促す**。
 */
export function groupChanges(files: readonly ChangedFile[]): CommitGroup[] {
	const features = new Map<string, string[]>();
	const other: string[] = [];
	const core: string[] = [];
	const ledger: string[] = [];
	const docs: string[] = [];

	for (const file of files) {
		switch (bucketOf(file.path)) {
			case 'core':
				core.push(file.path);
				continue;
			case 'ledger':
				ledger.push(file.path);
				continue;
			case 'docs':
				docs.push(file.path);
				continue;
			default:
				break;
		}
		const key = featureKey(file.path);
		if (!key) {
			other.push(file.path);
			continue;
		}
		features.set(key, [...(features.get(key) ?? []), file.path]);
	}

	const groups: CommitGroup[] = [];
	// 束が大きい順。まとまりの強いものから片付けるほうが、残りが見通しやすい
	for (const [key, paths] of [...features].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
		groups.push({
			title: `${key} まわり`,
			reason: '同じ機能のファイル（実装・ビュー・テストが同じ名前で揃っている）',
			files: paths.sort()
		});
	}
	if (other.length > 0) {
		groups.push({
			title: 'その他の変更',
			reason: '機能名で束ねられなかったもの。意図が違うものが混ざっている可能性がある',
			files: other.sort()
		});
	}
	if (core.length > 0) {
		groups.push({
			title: 'コア（src/vs）の変更',
			reason: 'upstream 由来のコード。`nimbus/docs/core-changes.md` への記録も要る',
			files: core.sort()
		});
	}
	if (docs.length > 0) {
		groups.push({
			title: '仕様・確認記録',
			reason: '実装と同じコミットに載せる約束なので、上の束のどれかに混ぜる',
			files: docs.sort()
		});
	}
	if (ledger.length > 0) {
		groups.push({
			title: '台帳（tasks.md など）',
			reason: '実装と同じコミットに載せる約束なので、上の束のどれかに混ぜる',
			files: ledger.sort()
		});
	}
	return groups;
}

/** シェルに貼れる形。空白や記号が入っても壊れないよう単引用符で囲む */
function quote(path: string): string {
	return `'${path.replace(/'/g, `'\\''`)}'`;
}

/**
 * 束ごとの `git add -- …` を作る。
 * `git add -A` を出さないのは、**他のセッションの変更を巻き込むため**。
 */
export function addCommandFor(group: CommitGroup): string {
	return `git add -- ${group.files.map(quote).join(' ')}`;
}

/** 人が読んで判断するための一枚。そのままエディタに出す */
export function formatPlan(groups: readonly CommitGroup[]): string {
	if (groups.length === 0) {
		return '# コミットの分けかた\n\n変更はありません。\n';
	}
	const lines = [
		'# コミットの分けかた',
		'',
		'README の「1 コミット = 1 つの意図」を機械側から手伝うための下書き。',
		'**束ねて見せているだけで、正しさは保証しない。** どれを 1 つのコミットにするかは自分で決める。',
		'',
		`変更 ${groups.reduce((sum, g) => sum + g.files.length, 0)} ファイルを ${groups.length} 束に分けた。`,
		'',
		'> 複数のセッションが同じ作業ツリーを共有しているときは、',
		'> `git add -A` や `git commit -a` を使わない（他のセッションの変更を巻き込む）。',
		''
	];
	groups.forEach((group, index) => {
		lines.push(
			`## ${index + 1}. ${group.title}`,
			'',
			group.reason,
			'',
			...group.files.map((file) => `- \`${file}\``),
			'',
			'```sh',
			addCommandFor(group),
			'```',
			''
		);
	});
	return lines.join('\n');
}
