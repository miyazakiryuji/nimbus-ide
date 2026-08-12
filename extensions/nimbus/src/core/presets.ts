/**
 * 使い始めの設定を用意する（tasks.md T-203 言語別プリセット / T-204 セットアップ）。
 *
 * 最初の設定は、**何を決めればいいのか分からない**のが本当の壁。
 * 項目を並べて「好きに設定してください」と言われても、初めての人は決められない。
 *
 * ここでは**その言語でよく使う形**を用意する。合わなければ後から変えればいい。
 * **決め打ちを押し付けるのではなく、決めなくても始められるようにする**のが狙い。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export type PresetId = 'flutter' | 'node' | 'go' | 'swift' | 'general';

export interface Preset {
	id: PresetId;
	label: string;
	/** どういうときに選ぶか */
	detail: string;
	/** そのまま `settings.json` に入れる値 */
	settings: Record<string, unknown>;
	/** CLAUDE.md に足す節（見出し → 本文） */
	claudeMdSections: { heading: string; body: string }[];
}

const COMMON_SAFETY: Record<string, unknown> = {
	'nimbus.permissions.showDiffBeforeApproval': true,
	'nimbus.safety.blockProtectedReads': true
};

export const PRESETS: Preset[] = [
	{
		id: 'flutter',
		label: 'Flutter / Dart',
		detail: 'モバイルアプリ。ビルドが重いので、確認の回数を減らす向き',
		settings: {
			...COMMON_SAFETY,
			'nimbus.build.command': 'flutter build apk --debug',
			'nimbus.tasks.maxConcurrent': 2
		},
		claudeMdSections: [
			{
				heading: 'よく使うコマンド',
				body: ['```bash', 'flutter pub get', 'flutter test', 'flutter run', '```'].join('\n')
			},
			{
				heading: 'やってほしくないこと',
				body: [
					'- 生成物（`*.g.dart` / `*.freezed.dart`）を直接編集しない。元のファイルを直して生成し直す',
					'- `pubspec.yaml` を変えたら `flutter pub get`、プラグインを足したら `pod install` まで',
					'- 画面の文言は直書きせず、`.arb` に置く'
				].join('\n')
			}
		]
	},
	{
		id: 'node',
		label: 'Node / TypeScript',
		detail: 'サーバー・CLI・拡張機能',
		settings: { ...COMMON_SAFETY, 'nimbus.build.command': 'npm run build', 'nimbus.tasks.maxConcurrent': 3 },
		claudeMdSections: [
			{ heading: 'よく使うコマンド', body: ['```bash', 'npm install', 'npm test', 'npm run build', '```'].join('\n') },
			{
				heading: 'やってほしくないこと',
				body: ['- `any` で型を潰さない。分からないなら聞く', '- 依存を足す前に、標準機能で足りないかを確かめる'].join('\n')
			}
		]
	},
	{
		id: 'go',
		label: 'Go',
		detail: 'サーバー・CLI',
		settings: { ...COMMON_SAFETY, 'nimbus.build.command': 'go build ./...', 'nimbus.tasks.maxConcurrent': 3 },
		claudeMdSections: [
			{ heading: 'よく使うコマンド', body: ['```bash', 'go test ./...', 'go vet ./...', '```'].join('\n') },
			{ heading: 'やってほしくないこと', body: '- エラーを握りつぶさない。返すか、その場で扱うかを決める' }
		]
	},
	{
		id: 'swift',
		label: 'Swift / iOS',
		detail: 'Apple 向けのアプリ',
		settings: { ...COMMON_SAFETY, 'nimbus.tasks.maxConcurrent': 2 },
		claudeMdSections: [
			{ heading: 'やってほしくないこと', body: '- `project.pbxproj` を手で編集しない（衝突したら Nimbus の解決を使う）' }
		]
	},
	{
		id: 'general',
		label: 'そのほか',
		detail: '言語を決めずに始める',
		settings: { ...COMMON_SAFETY },
		claudeMdSections: [
			{
				heading: 'プロジェクトの概要',
				body: '<!-- 何を作っているか、誰のためか、今どの段階か -->'
			}
		]
	}
];

/** リポジトリの中身から、どのプリセットが合いそうかを当てる */
export function guessPreset(fileNames: readonly string[]): PresetId {
	const names = new Set(fileNames.map((name) => name.split('/').pop() ?? name));
	if (names.has('pubspec.yaml')) {
		return 'flutter';
	}
	if (names.has('go.mod')) {
		return 'go';
	}
	if (names.has('Package.swift') || [...names].some((name) => name.endsWith('.xcodeproj'))) {
		return 'swift';
	}
	if (names.has('package.json')) {
		return 'node';
	}
	return 'general';
}

export interface SetupStep {
	title: string;
	done: boolean;
	/** まだのときにやること */
	todo?: string;
}

export interface SetupState {
	hasClaudeCode: boolean;
	hasClaudeMd: boolean;
	isTrusted: boolean;
	hasPreset: boolean;
}

/**
 * 使い始めに要るものが揃っているかを並べる。
 *
 * **できていないものだけを責めない。** 何をすればいいかを必ず添える。
 */
export function setupSteps(state: SetupState): SetupStep[] {
	return [
		{
			title: 'Claude Code が見つかっている',
			done: state.hasClaudeCode,
			todo: state.hasClaudeCode ? undefined : 'Claude Code を入れるか、設定 `nimbus.claudeCodeExecutable` にパスを書きます'
		},
		{
			title: 'このフォルダを信頼している',
			done: state.isTrusted,
			todo: state.isTrusted ? undefined : 'Nimbus は信頼したフォルダでのみ動きます（Claude を実行するため）'
		},
		{
			title: 'CLAUDE.md がある',
			done: state.hasClaudeMd,
			todo: state.hasClaudeMd ? undefined : '「CLAUDE.md に節を足す」から作れます。無くても動きますが、毎回同じ説明が要ります'
		},
		{
			title: '言語に合わせた設定が入っている',
			done: state.hasPreset,
			todo: state.hasPreset ? undefined : 'このウィザードで入れられます（あとから変えられます）'
		}
	];
}

export function renderSetup(steps: readonly SetupStep[]): string {
	const remaining = steps.filter((step) => !step.done);
	const lines = ['# 使い始めの確認', ''];

	for (const step of steps) {
		lines.push(`- ${step.done ? '✅' : '⬜️'} ${step.title}`);
		if (!step.done && step.todo) {
			lines.push(`  → ${step.todo}`);
		}
	}
	lines.push('');

	lines.push(
		remaining.length === 0
			? '揃っています。コックピットに指示を書いて始められます。'
			: `残り ${remaining.length} 件。**全部そろっていなくても始められます**（上から順にやる必要はありません）。`
	);
	lines.push('');
	return lines.join('\n');
}
