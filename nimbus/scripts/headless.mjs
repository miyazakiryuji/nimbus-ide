#!/usr/bin/env node
/**
 * ヘッドレス Nimbus（tasks.md T-093）。
 *
 * GUI を立ち上げずに、**画面と同じワークフロー**を CI から回す。
 * 判断の中身（`core/*`）は画面側と同じものを読み込むので、
 * 「手元では通るのに CI では違う」が起きない。
 *
 * 使いかた:
 *   node nimbus/scripts/headless.mjs --list
 *   node nimbus/scripts/headless.mjs --workflow "不具合を直す" --input "起動時に落ちる" --yes
 *   node nimbus/scripts/headless.mjs --workflow 1 --input "..." --dry-run
 *
 * CI で使うときの約束:
 *   - **人がいない**ので、確認（`confirm`）は飛ばす。飛ばしてよいと `--yes` で明示させる
 *   - 危ないツールは**その場で落とす**（承認待ちで固まらせない）
 *   - `--require-tests` を付けると、テストが通った証拠が無い限り終了コードを 1 にする
 */
import { createRequire } from 'node:module';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, '../../extensions/nimbus');
const require = createRequire(import.meta.url);

/** 判断の中身は画面側と同じものを使う。二重に書くと必ずずれる */
function loadCore(name) {
	const built = resolve(EXT, `out/core/${name}.js`);
	if (!existsSync(built)) {
		fail(
			`${built} がありません。先にビルドしてください:\n`
			+ '  npm --prefix extensions/nimbus run compile'
		);
	}
	return require(built);
}

function fail(message) {
	process.stderr.write(`nimbus: ${message}\n`);
	process.exit(2);
}

// --- 引数 ---------------------------------------------------------------

function parseArgs(argv) {
	const options = {
		workflow: undefined,
		input: '',
		profile: '調べるだけ',
		cwd: process.cwd(),
		maxTurns: 30,
		json: undefined,
		list: false,
		dryRun: false,
		yes: false,
		requireTests: false
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			const value = argv[++i];
			if (value === undefined) {
				fail(`${arg} に値がありません`);
			}
			return value;
		};
		switch (arg) {
			case '--list': options.list = true; break;
			case '--dry-run': options.dryRun = true; break;
			case '--yes': case '-y': options.yes = true; break;
			case '--require-tests': options.requireTests = true; break;
			case '--workflow': case '-w': options.workflow = next(); break;
			case '--input': case '-i': options.input = next(); break;
			case '--profile': case '-p': options.profile = next(); break;
			case '--cwd': options.cwd = resolve(next()); break;
			case '--max-turns': options.maxTurns = Number(next()); break;
			case '--json': options.json = resolve(next()); break;
			case '--help': case '-h': usage(); process.exit(0); break;
			default: fail(`知らない引数です: ${arg}（--help で使いかたを出します）`);
		}
	}
	if (!Number.isFinite(options.maxTurns) || options.maxTurns <= 0) {
		fail('--max-turns は 1 以上の数にしてください');
	}
	return options;
}

function usage() {
	process.stdout.write(
		[
			'ヘッドレス Nimbus — GUI 抜きで同じワークフローを回す',
			'',
			'  --list                 使えるワークフローを出す',
			'  -w, --workflow <名前|番号>  回すワークフロー',
			'  -i, --input <文>       1 段目の {{...}} に入れる文',
			'  -p, --profile <名前>   権限プロファイル（既定: 調べるだけ）',
			'      --cwd <パス>       作業ディレクトリ（既定: いまの場所）',
			'      --max-turns <数>   1 段あたりの上限（既定: 30）',
			'      --json <パス>      1 行 1 件で出来事を書き出す（NDJSON）',
			'      --dry-run          API を呼ばずに、何を送るかだけ出す',
			'  -y, --yes              人の確認を飛ばすことに同意する',
			'      --require-tests    テストが通った証拠が無ければ失敗にする',
			''
		].join('\n')
	);
}

// --- 出力 ---------------------------------------------------------------

function makeWriter(jsonPath) {
	return (record) => {
		if (jsonPath) {
			appendFileSync(jsonPath, `${JSON.stringify(record)}\n`);
		}
	};
}

// --- 本体 ---------------------------------------------------------------

/**
 * ツールを通してよいか。**CI には承認する人がいない**ので、
 * 迷ったら通さずに落とす。待たせると CI が固まる。
 */
function makeCanUseTool({ risk, secrets, profile, write, log }) {
	return async (toolName, input) => {
		const blocked = secrets.findBlockedRead(toolName, input);
		if (profile.blockProtectedReads && blocked) {
			const reason = `秘匿ファイルの読み取りを止めました: ${blocked.path}`;
			write({ kind: 'tool-denied', tool: toolName, reason });
			log(`  ✗ ${toolName} — ${reason}`);
			return { behavior: 'deny', message: reason };
		}
		const assessment = risk.assessToolRisk(toolName, input);
		if (assessment.level === 'danger') {
			const reason = `危険と判定しました（${assessment.reasons.join(' / ')}）。ヘッドレスでは承認できません`;
			write({ kind: 'tool-denied', tool: toolName, reason });
			log(`  ✗ ${toolName} — ${reason}`);
			return { behavior: 'deny', message: reason };
		}
		write({ kind: 'tool-allowed', tool: toolName, level: assessment.level });
		return { behavior: 'allow', updatedInput: input };
	};
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const workflows = loadCore('workflow');
	const profiles = loadCore('policyProfiles');
	const evidence = loadCore('evidence');
	const risk = loadCore('risk');
	const secrets = loadCore('secrets');

	if (options.list) {
		workflows.BUILTIN_WORKFLOWS.forEach((flow, index) => {
			process.stdout.write(`${index}. ${flow.name} — ${flow.description}\n`);
			for (const step of flow.steps) {
				process.stdout.write(`     ${step.name}${step.confirm ? '（確認あり）' : ''}\n`);
			}
		});
		return 0;
	}

	if (options.workflow === undefined) {
		usage();
		fail('--workflow を指定してください（--list で一覧を出します）');
	}
	const index = Number(options.workflow);
	const flow = Number.isInteger(index)
		? workflows.BUILTIN_WORKFLOWS[index]
		: workflows.BUILTIN_WORKFLOWS.find((f) => f.name === options.workflow);
	if (!flow) {
		fail(`そのワークフローはありません: ${options.workflow}（--list で一覧を出します）`);
	}
	const profile = profiles.findProfile(profiles.BUILTIN_PROFILES, options.profile);

	// 確認のある段を、黙って飛ばさない。飛ばすと分かったうえで回してもらう
	const needsConfirm = flow.steps.filter((step) => step.confirm).map((step) => step.name);
	if (needsConfirm.length > 0 && !options.yes && !options.dryRun) {
		fail(
			`このワークフローには人の確認がある段があります（${needsConfirm.join(' / ')}）。\n`
			+ 'ヘッドレスでは確認できないので、飛ばしてよいなら --yes を付けてください。'
		);
	}

	const write = makeWriter(options.json);
	const log = (message) => process.stdout.write(`${message}\n`);

	log(`ワークフロー: ${flow.name}`);
	log(`プロファイル: ${profile.name}（${profile.description}）`);
	log(`作業場所: ${options.cwd}`);
	if (needsConfirm.length > 0) {
		log(`確認を飛ばす段: ${needsConfirm.join(' / ')}`);
	}
	log('');
	write({ kind: 'start', workflow: flow.name, profile: profile.name, cwd: options.cwd });

	if (options.dryRun) {
		flow.steps.forEach((step, stepIndex) => {
			log(`--- ${stepIndex + 1}/${flow.steps.length} ${step.name} ---`);
			log(workflows.fillStep(step, options.input));
			log('');
			write({ kind: 'step-dry-run', step: step.name, prompt: workflows.fillStep(step, options.input) });
		});
		log('（--dry-run のため API は呼んでいません）');
		return 0;
	}

	const { query } = await import(resolve(EXT, 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'))
		.catch(() => import('@anthropic-ai/claude-agent-sdk'));

	const canUseTool = makeCanUseTool({ risk, secrets, profile, write, log });
	const events = [];
	let sessionId;

	for (const [stepIndex, step] of flow.steps.entries()) {
		const prompt = workflows.fillStep(step, options.input);
		log(`--- ${stepIndex + 1}/${flow.steps.length} ${step.name} ---`);
		write({ kind: 'step-start', step: step.name });

		const sandbox = profiles.toSdkSandbox(profile.sandbox);
		const response = query({
			prompt,
			options: {
				cwd: options.cwd,
				maxTurns: options.maxTurns,
				permissionMode: profile.permissionMode,
				canUseTool,
				...(sandbox ? { sandbox } : {}),
				// 段をまたいで同じ話を続ける。段ごとに忘れると調査の意味が無くなる
				...(sessionId ? { resume: sessionId } : {})
			}
		});

		let stepFailed;
		for await (const message of response) {
			write({ kind: 'sdk', step: step.name, message });
			if (message.type === 'system' && message.subtype === 'init') {
				sessionId = message.session_id;
			} else if (message.type === 'assistant') {
				for (const block of message.message.content ?? []) {
					if (block.type === 'text' && block.text.trim()) {
						log(block.text.trim());
					} else if (block.type === 'tool_use') {
						// 呼び出しも残す。`collectEvidence` は呼び出しと結果を
						// toolUseId で対応づけるので、片方だけでは何も拾えない
						events.push({
							kind: 'tool-use',
							sessionId: sessionId ?? 'headless',
							timestamp: events.length,
							toolUseId: block.id,
							toolName: block.name,
							input: block.input
						});
					}
				}
			} else if (message.type === 'user') {
				// ツールの結果から、テストの通り／落ちを拾う（画面側と同じ判定）
				for (const block of message.message.content ?? []) {
					if (block.type === 'tool_result') {
						const text = typeof block.content === 'string'
							? block.content
							: (block.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
						events.push({
							kind: 'tool-result',
							sessionId: sessionId ?? 'headless',
							timestamp: events.length,
							toolUseId: block.tool_use_id,
							isError: Boolean(block.is_error),
							preview: text
						});
					}
				}
			} else if (message.type === 'result') {
				if (message.subtype !== 'success') {
					stepFailed = message.subtype;
				}
				write({ kind: 'step-end', step: step.name, subtype: message.subtype });
			} else if (message.type === 'tool_use' || message.type === 'stream_event') {
				// 進行の細かい粒は NDJSON にだけ残す（画面が無いので流すと読めない）
			}
		}
		log('');
		if (stepFailed) {
			log(`${step.name} で止まりました（${stepFailed}）。ここで終わります。`);
			write({ kind: 'aborted', step: step.name, reason: stepFailed });
			return 1;
		}
	}

	// テストの証拠を見る。**通ったログが無いのに「できた」と言わせない**
	const collected = evidence.collectEvidence(events);
	log(evidence.describeEvidence(collected));
	write({ kind: 'evidence', evidence: collected });

	if (options.requireTests && !evidence.isBackedByTests(collected)) {
		log('テストが通った証拠がありません（--require-tests）。失敗として終わります。');
		return 1;
	}
	return 0;
}

main().then(
	(code) => process.exit(code),
	(error) => {
		process.stderr.write(`nimbus: ${error?.stack ?? error}\n`);
		process.exit(2);
	}
);
