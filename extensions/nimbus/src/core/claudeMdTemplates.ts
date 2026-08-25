/**
 * CLAUDE.md のテンプレート（tasks.md T-319）。
 *
 * 白紙から書き始めるのが重い、が起点。だからテンプレートは**書き出しの足場**であって、
 * 埋め草ではない — **分かるものは数えた事実で埋め**（`conventions.ts` の結果・実在する
 * 走らせ方）、分からないところだけを TODO として残す。推測を書き込まない。
 *
 * VS Code 非依存（事実を受け取り、本文を返す）。
 */

export const TEMPLATE_IDS = ['minimal', 'app', 'parallel', 'flutter', 'library'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** 差し込む事実。**取れなかったものは undefined のまま渡す**（節ごと省くか TODO になる） */
export interface TemplateFacts {
	projectName: string;
	/** 数えた書き方（`renderConventions` の文） */
	conventions?: string;
	/** 実在する走らせ方（package.json の scripts など） */
	runCommands?: readonly string[];
	/** pubspec.yaml が居るか */
	flutter?: boolean;
}

export interface TemplateChoice {
	id: TemplateId;
	label: string;
	description: string;
}

export function templateChoices(): TemplateChoice[] {
	return [
		{ id: 'minimal', label: '最小', description: '何をするか / 触ってよい場所 / 走らせ方 の 3 見出しだけ' },
		{ id: 'app', label: 'アプリ開発', description: 'ビルド・テスト・依存の入れ方・環境変数' },
		{ id: 'parallel', label: '並行開発', description: 'コミットの作法・触らない場所・記録の直しかた（Nimbus 自身が使っている型）' },
		{ id: 'flutter', label: 'Flutter / モバイル', description: '実機とシミュレータ・ホットリロードの前提' },
		{ id: 'library', label: 'ライブラリ / 公開リポジトリ', description: '秘密を書かない・リリース手順' }
	];
}

/** 事実から、最初に出す候補を決める（選び直せるので、外れても 1 押し増えるだけ） */
export function suggestTemplate(facts: TemplateFacts): TemplateId {
	return facts.flutter ? 'flutter' : 'minimal';
}

/** 走らせ方の節。実在するコマンドが取れていればそれを、無ければ TODO を書く */
function runSection(facts: TemplateFacts): string[] {
	const lines = ['## 走らせ方', ''];
	if (facts.runCommands && facts.runCommands.length > 0) {
		lines.push('<!-- 実在するコマンドから写した。使わないものは消す -->');
		for (const command of facts.runCommands.slice(0, 12)) {
			lines.push(`- \`${command}\``);
		}
	} else {
		lines.push('<!-- TODO: ビルド・テスト・起動のコマンドを書く（例: `npm test`） -->');
	}
	lines.push('');
	return lines;
}

/** 数えた書き方の節。取れていないときは節ごと出さない（空の節は読む邪魔にしかならない） */
function conventionsSection(facts: TemplateFacts): string[] {
	if (!facts.conventions) {
		return [];
	}
	return ['## 書き方（数えた事実）', '', '<!-- このリポジトリのソースを数えた結果。ズレていたら直す -->', facts.conventions.trim(), ''];
}

export function renderTemplate(id: TemplateId, facts: TemplateFacts): string {
	const head = [`# ${facts.projectName}`, ''];
	const about = ['## 何をするプロジェクトか', '', '<!-- TODO: 1〜3 行で。ここが空だと、他のすべての指示が浮く -->', ''];
	const touch = [
		'## 触ってよい場所・いけない場所',
		'',
		'<!-- TODO: 例: `src/` は自由 / `generated/` は再生成でしか変えない -->',
		''
	];
	switch (id) {
		case 'minimal':
			return [...head, ...about, ...touch, ...runSection(facts), ...conventionsSection(facts)].join('\n');
		case 'app':
			return [
				...head,
				...about,
				...runSection(facts),
				'## 依存の入れ方',
				'',
				'<!-- TODO: 例: `npm ci`（`npm install` で lock を動かさない） -->',
				'',
				'## 環境変数・秘密',
				'',
				'- 秘密は `.env`（コミットしない）。<!-- TODO: 必要な変数の名前だけを列挙する（値は書かない） -->',
				'',
				...touch,
				...conventionsSection(facts)
			].join('\n');
		case 'parallel':
			return [
				...head,
				...about,
				'## 複数のセッションで並行開発する（Nimbus の型）',
				'',
				'- **作業の前に、タスクの板へ書き出す**（着手・担当・日付）。板に無い作業は他から見えない',
				'- **コミットは細かく、必ず push**（`git pull --rebase` → `git push`）。溜めるほど競合が解けなくなる',
				'- `git add -A` を使わない。**自分が書いたと分かるファイルだけ**をパス名指しで組む',
				'- 他のセッションの未コミット変更を `stash` / `checkout --` / `reset --hard` で消さない',
				'- 直した不具合には回帰テストを 1 本足し、**実装と同じコミットで**記録も直す',
				'',
				...runSection(facts),
				...touch,
				...conventionsSection(facts)
			].join('\n');
		case 'flutter':
			return [
				...head,
				...about,
				...runSection(facts),
				'## 実機とシミュレータ',
				'',
				'<!-- TODO: 例: 動作確認はまずシミュレータ（`flutter run -d ios`）。実機の登録手順はここに -->',
				'',
				'## ホットリロードの前提',
				'',
				'- `flutter run` を人が起こしている前提なら、エージェントは再起動せずリロードに任せる',
				'<!-- TODO: 状態が壊れる操作（restart が要るもの）があれば書く -->',
				'',
				...touch,
				...conventionsSection(facts)
			].join('\n');
		case 'library':
			return [
				...head,
				...about,
				'## 公開リポジトリの約束',
				'',
				'- **秘密を書かない**（資格情報・内部 URL・実名）。コミット前に diff を読む',
				'- 破壊的変更は CHANGELOG に書き、非互換の理由を残す',
				'',
				...runSection(facts),
				'## リリース手順',
				'',
				'<!-- TODO: 版の上げ方・タグ・公開コマンド（例: `npm version patch && npm publish`） -->',
				'',
				...touch,
				...conventionsSection(facts)
			].join('\n');
	}
}

/**
 * 利用者が設定で足したテンプレート（`nimbus.claudeMd.templates`）に事実を差し込む。
 * `{{project}}` と `{{conventions}}` だけを置き換える — 覚えることを増やさない。
 */
export function renderCustomTemplate(body: string, facts: TemplateFacts): string {
	return body
		.replaceAll('{{project}}', facts.projectName)
		.replaceAll('{{conventions}}', facts.conventions?.trim() ?? '');
}
