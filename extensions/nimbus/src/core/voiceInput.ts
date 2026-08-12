/**
 * 声で指示する（tasks.md T-055）。
 *
 * 手が離せないときに「テスト通しといて」だけ言えれば足りる場面がある。
 *
 * ## ここで決めたこと
 *
 * **ブラウザの音声認識（`webkitSpeechRecognition`）は使わない。** Electron では
 * 音声サービスに繋がらず、**黙って動かない**。動かないものを「実装した」にするのが
 * いちばん質が悪い。
 *
 * 代わりに、**入っていれば使う**形にする（GIF の `ffmpeg` と同じ）。
 * 録るのは `ffmpeg`、文字にするのは手元の書き起こしツール。無ければ、無いと言う。
 *
 * ## 送る前に必ず見せる
 *
 * **聞き間違いは必ず起きる。** 「テスト通して」が「テスト消して」になりうる。
 * だから**確認なしに送らない**。取り消しの利かない言葉が混ざっていたら、なお強く聞く。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface Engine {
	/** 実行するコマンド名 */
	command: string;
	label: string;
	/** モデルの場所を自分で渡す必要があるか */
	needsModelPath: boolean;
	/** 入れかた */
	install: string;
}

/**
 * 使える書き起こしツール。**上から順に好む**。
 *
 * 速い順ではなく、**入れた人の意図が明らかな順**に並べる
 * （`mlx_whisper` を入れている人は、それを使いたくて入れている）。
 */
export const ENGINES: readonly Engine[] = [
	{ command: 'mlx_whisper', label: 'mlx-whisper', needsModelPath: false, install: 'pip install mlx-whisper' },
	{ command: 'whisper', label: 'whisper', needsModelPath: false, install: 'pip install -U openai-whisper' },
	{ command: 'whisper-cli', label: 'whisper.cpp', needsModelPath: true, install: 'brew install whisper-cpp' }
];

export function pickEngine(available: readonly string[]): Engine | undefined {
	return ENGINES.find((engine) => available.includes(engine.command));
}

export interface AudioDevice {
	index: number;
	name: string;
}

/**
 * `ffmpeg -f avfoundation -list_devices true -i ""` の出力から、音声デバイスを読む。
 *
 * **番号を決め打ちにしない。** 実機で確かめたところ、`:0` は仮想オーディオ
 * （BlackHole）で、実際のマイクは 1 番だった。決め打ちだと**別のものを録る**。
 */
export function parseAudioDevices(output: string): AudioDevice[] {
	const devices: AudioDevice[] = [];
	let inAudio = false;
	for (const line of output.split('\n')) {
		if (/AVFoundation (audio|input) devices/.test(line)) {
			inAudio = /audio/.test(line);
			continue;
		}
		if (!inAudio) {
			continue;
		}
		const match = /\[(\d+)\]\s+(.+?)\s*$/.exec(line.replace(/^\[[^\]]*\]\s*/, ''));
		if (match) {
			devices.push({ index: Number(match[1]), name: match[2] });
		}
	}
	return devices;
}

/**
 * どれを既定にするか。
 *
 * **名前で選ぶ。** 仮想オーディオ（ループバック）を既定にすると、
 * 喋っていないのに「聞き取れませんでした」が続いて、原因が分からない。
 */
const LOOPBACK = /(blackhole|soundflower|loopback|aggregate|virtual|teams|zoom)/i;
const MICROPHONE = /(マイク|microphone|built-in|内蔵)/i;

export function defaultDevice(devices: readonly AudioDevice[]): AudioDevice | undefined {
	return (
		devices.find((device) => MICROPHONE.test(device.name) && !LOOPBACK.test(device.name)) ??
		devices.find((device) => !LOOPBACK.test(device.name)) ??
		devices[0]
	);
}

export interface RecordOptions {
	seconds: number;
	/** avfoundation の音声デバイス番号 */
	device: number;
	outputPath: string;
}

/**
 * 録る引数（`ffmpeg`）。
 *
 * **16 kHz・モノラル**にする。書き起こしツールがどれもその形に落とすので、
 * 先に合わせておくと変換が 1 回減る。
 */
export function buildRecordArgs(options: RecordOptions): string[] {
	return [
		'-y',
		'-f',
		'avfoundation',
		'-i',
		`:${options.device}`,
		'-t',
		String(Math.max(1, Math.round(options.seconds))),
		'-ac',
		'1',
		'-ar',
		'16000',
		options.outputPath
	];
}

export interface TranscribeOptions {
	audioPath: string;
	outputDir: string;
	/** 話している言葉。既定は日本語 */
	language?: string;
	/** whisper.cpp のときだけ要る */
	modelPath?: string;
}

/** 文字にする引数。ツールごとに書き方が違うので、ここに閉じ込める */
export function buildTranscribeArgs(engine: Engine, options: TranscribeOptions): string[] {
	const language = options.language ?? 'ja';
	if (engine.command === 'whisper-cli') {
		return ['-m', options.modelPath ?? '', '-f', options.audioPath, '-l', language, '-otxt', '-of', `${options.outputDir}/voice`];
	}
	return [
		options.audioPath,
		'--language',
		language,
		'--output_format',
		'txt',
		'--output_dir',
		options.outputDir
	];
}

/**
 * 書き起こしを、指示として読める形にする。
 *
 * 時刻の印（`[00:00.000 --> 00:02.000]`）が付くツールがあるので落とす。
 * **空になったら空を返す** — それらしい文をでっち上げない。
 */
export function cleanTranscript(raw: string): string {
	return raw
		.split('\n')
		.map((line) => line.replace(/^\s*\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/, '').trim())
		.filter((line) => line.length > 0)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** 取り消しの利かない言葉。**聞き間違いで起きると困る順** */
const RISKY = [
	{ pattern: /(消し|消す|削除|捨て)/, label: '消す' },
	{ pattern: /(force|強制)/i, label: '強制' },
	{ pattern: /(reset|戻し|巻き戻)/i, label: '戻す' },
	{ pattern: /(push|上げ|出し)/i, label: '外に出す' },
	{ pattern: /(本番|production|deploy|デプロイ)/i, label: '本番に触る' }
];

/** 強く確認したほうがよい言葉が入っているか */
export function riskyWords(text: string): string[] {
	return RISKY.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label);
}

/**
 * 確認の文。
 *
 * **どんな内容でも確認する。** 危ない語があるときは、何が引っかかったかも言う。
 */
export function confirmationMessage(text: string): string {
	const risky = riskyWords(text);
	if (text.length === 0) {
		return '聞き取れませんでした。もう一度どうぞ。';
	}
	return risky.length > 0
		? `「${text}」と聞こえました。**${risky.join('・')}** に関わる言葉が入っています。送る前に読み直してください。`
		: `「${text}」と聞こえました。これで送りますか。`;
}

/** 何も入っていないときに、人が続けられるようにする */
export function describeMissing(hasFfmpeg: boolean): string {
	const lines = ['# 声で指示する', '', '使うには、手元に 2 つ要ります。', ''];
	lines.push(hasFfmpeg ? '- ✅ 録音（`ffmpeg`）' : '- ⛔️ 録音（`ffmpeg`）— `brew install ffmpeg`');
	lines.push('- ⛔️ 書き起こし — 次のどれか 1 つ');
	for (const engine of ENGINES) {
		lines.push(`    - ${engine.label} — \`${engine.install}\``);
	}
	lines.push(
		'',
		'**どれも外に送りません。** 録った音も、文字にしたものも、手元で処理します。',
		'',
		'ブラウザの音声認識は使いません。Electron では音声サービスに繋がらず、黙って動かないためです。',
		''
	);
	return lines.join('\n');
}
