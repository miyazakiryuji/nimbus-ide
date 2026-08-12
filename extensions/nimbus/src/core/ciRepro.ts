/**
 * CI と同じことを手元でやる（tasks.md T-132）。
 *
 * 「CI だけ落ちる」は、たいてい**手元と CI で違うことをしている**だけ。
 * ワークフローには何をしているかが書いてあるのに、読みに行くのが面倒で、
 * 結局 push しては待つ、を繰り返すことになる。
 *
 * ここではワークフローから**実際に打つコマンドの並び**を取り出す。
 * **走らせはしない**（重いものが混ざるので、何を打つかを見てから人が決める）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface CiStep {
	/** ジョブ名 */
	job: string;
	/** ステップ名（`name:` があれば） */
	name?: string;
	/** 実際に打つコマンド */
	run: string;
	/** そのステップが使っているアクション（`uses:`）。CI 専用かの判定に要る */
	uses?: string;
}

export interface CiEnvironment {
	/** `runs-on` の値 */
	runsOn?: string;
	/** `setup-node` などで指定された版 */
	versions: { tool: string; version: string }[];
}

/**
 * ワークフロー（YAML）から手順を取り出す。
 *
 * YAML パーサは持ち込まない。**インデントと `- run:` だけを見る**ので、
 * 込み入った書き方（アンカー・複数行の合成）は取りこぼす — 取りこぼしても
 * 「手元で試す取っかかり」としては足りる。
 */
export function parseWorkflow(yaml: string): { steps: CiStep[]; environment: CiEnvironment } {
	const lines = yaml.split('\n');
	const steps: CiStep[] = [];
	const versions: { tool: string; version: string }[] = [];
	let runsOn: string | undefined;
	let job = '(不明)';
	let stepName: string | undefined;
	let pendingTool: string | undefined;
	let lastUses: string | undefined;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		const jobMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
		if (jobMatch) {
			job = jobMatch[1];
			continue;
		}
		const runsOnMatch = /^\s*runs-on:\s*(\S.*)$/.exec(line);
		if (runsOnMatch && !runsOn) {
			runsOn = runsOnMatch[1].trim();
			continue;
		}
		const nameMatch = /^\s*-?\s*name:\s*(\S.*)$/.exec(line);
		if (nameMatch) {
			stepName = nameMatch[1].trim();
			continue;
		}
		const anyUses = /^\s*-?\s*uses:\s*(\S+)/.exec(line);
		if (anyUses) {
			lastUses = anyUses[1];
			const setup = /^actions\/setup-([a-z]+)@/.exec(anyUses[1]);
			if (setup) {
				pendingTool = setup[1];
			}
			continue;
		}
		const versionMatch = /^\s*([a-z-]*version):\s*['"]?([^'"\s]+)/.exec(line);
		if (versionMatch && pendingTool) {
			versions.push({ tool: pendingTool, version: versionMatch[2] });
			pendingTool = undefined;
			continue;
		}

		const runMatch = /^(\s*)-?\s*run:\s*(.*)$/.exec(line);
		if (!runMatch) {
			continue;
		}
		let command = runMatch[2].trim();
		// `run: |` の複数行
		if (command === '|' || command === '>' || command === '') {
			const body: string[] = [];
			const indent = runMatch[1].length;
			for (let j = i + 1; j < lines.length; j++) {
				const next = lines[j];
				if (next.trim().length === 0) {
					continue;
				}
				const nextIndent = next.length - next.trimStart().length;
				if (nextIndent <= indent) {
					break;
				}
				body.push(next.trim());
				i = j;
			}
			command = body.join('\n');
		}
		if (command.length > 0) {
			steps.push({ job, name: stepName, run: command, uses: lastUses });
			stepName = undefined;
			lastUses = undefined;
		}
	}

	return { steps, environment: { runsOn, versions } };
}

/**
 * 手元で打つ形にする。
 *
 * **CI 専用の行は落とす**（アップロードや通知は、手元で走らせても意味がない）。
 */
const CI_ONLY = /(actions\/upload|actions\/download|codecov|slack|notify|::set-output|GITHUB_TOKEN)/i;

export function toLocalScript(steps: readonly CiStep[]): string[] {
	return steps
		// コマンド本文だけでなく、そのステップが使っているアクションも見る
		// （`uses: actions/upload-artifact` のステップは、run が無害に見えても CI 専用）
		.filter((step) => !CI_ONLY.test(step.run) && !CI_ONLY.test(step.uses ?? ''))
		.flatMap((step) => step.run.split('\n'))
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'));
}

export function renderCiRepro(
	steps: readonly CiStep[],
	environment: CiEnvironment,
	local: Readonly<Record<string, string | undefined>>
): string {
	if (steps.length === 0) {
		return [
			'# CI を手元で再現する',
			'',
			'ワークフローから実行するコマンドを取り出せませんでした。',
			'（`.github/workflows/*.yml` の `run:` を見ています）',
			''
		].join('\n');
	}

	const lines = ['# CI を手元で再現する', ''];

	if (environment.runsOn || environment.versions.length > 0) {
		lines.push('## CI が使っている環境', '');
		if (environment.runsOn) {
			lines.push(`- OS: \`${environment.runsOn}\``);
		}
		for (const version of environment.versions) {
			const actual = local[version.tool];
			const mark = actual === undefined ? '❔' : actual.startsWith(version.version) ? '✅' : '⚠️';
			lines.push(`- ${mark} ${version.tool}: CI は \`${version.version}\`${actual ? ` / 手元は \`${actual}\`` : ''}`);
		}
		lines.push('', '**「CI だけ落ちる」の多くはここです。** 版が違えば、同じコマンドでも結果は変わります。', '');
	}

	lines.push('## 同じ順で打つ', '', '```bash');
	lines.push(...toLocalScript(steps));
	lines.push('```', '');
	lines.push(
		'アップロードや通知の行は落としてあります（手元で走らせても意味がないため）。',
		'**そのまま実行はしません。** 重いものが混ざるので、見てから打ってください。',
		''
	);

	return lines.join('\n');
}
