/**
 * 作業の様子を GIF にする（tasks.md T-223）。
 *
 * 「こう動いた」を伝えるのに、文章とスクショ 1 枚では足りないことがある。
 * かといって画面録画を渡すと、相手は再生ボタンを押さないといけない。
 * **GIF は貼れば動く** — Issue にも、チャットにも、そのまま置ける。
 *
 * ここで効くのは**枚数の見積もり**。GIF は 1 枚ずつ画像を持つので、
 * 何も考えずに 30 秒 × 10 fps を撮ると 300 枚になり、
 * 貼れないほど大きいファイルができあがる（そして、それに気づくのは作り終えたあと）。
 *
 * 組み立ては `ffmpeg` に任せる。**無ければ、無いと言う**。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface CapturePlan {
	/** 撮る枚数 */
	frames: number;
	/** 何ミリ秒ごとに撮るか */
	intervalMs: number;
	/** 実際に収まる長さ（秒） */
	seconds: number;
	/** 頼まれた条件を変えたなら、その理由 */
	note?: string;
}

/**
 * 枚数の上限。
 *
 * 1 枚 100 KB 前後（横 800 px の画面）として、120 枚で 10 MB 強。
 * **GitHub の Issue に貼れるのは 10 MB まで**なので、そこを目安にする。
 */
export const MAX_FRAMES = 120;

/** これより粗いと、動きが飛んで見える */
export const MIN_FPS = 1;

/** 画面の記録に 10 fps を超える必要はない（ファイルが増えるだけ） */
export const MAX_FPS = 10;

/**
 * 何枚撮るかを決める。
 *
 * **上限に当たったら、fps を落として長さを守る。**
 * 長さを削ると「見せたかった操作の途中で切れる」ので、
 * 先に落とすのは滑らかさのほう。
 */
export function planCapture(seconds: number, fps: number): CapturePlan {
	const wantSeconds = Math.max(1, Math.round(seconds));
	const wantFps = Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(fps)));
	const wantFrames = wantSeconds * wantFps;

	if (wantFrames <= MAX_FRAMES) {
		return { frames: wantFrames, intervalMs: Math.round(1000 / wantFps), seconds: wantSeconds };
	}

	// 長さは守り、滑らかさを落とす
	const fittedFps = Math.max(MIN_FPS, Math.floor(MAX_FRAMES / wantSeconds));
	const frames = wantSeconds * fittedFps;
	// **枚数で判断する。** fps を落とせたかどうかで判断すると、
	// 1 fps でも入りきらない長さのときに「落としました」と言いながら黙って切ることになる
	if (frames <= MAX_FRAMES) {
		return {
			frames,
			intervalMs: Math.round(1000 / fittedFps),
			seconds: wantSeconds,
			note: `${wantSeconds} 秒 × ${wantFps} fps は ${wantFrames} 枚になるため、${fittedFps} fps に落としました（${MAX_FRAMES} 枚まで）`
		};
	}

	// 1 fps でも収まらない長さ（120 秒超）。ここは長さを削るしかない
	return {
		frames: MAX_FRAMES,
		intervalMs: 1000,
		seconds: MAX_FRAMES,
		note: `${wantSeconds} 秒は長すぎるので、最初の ${MAX_FRAMES} 秒だけにしました（1 fps でも ${MAX_FRAMES} 枚が上限です）`
	};
}

/** 貼る前に、だいたいの大きさを言う */
export function estimateBytes(frames: number, widthPixels: number): number {
	// 横 800 px で 1 枚 100 KB を基準に、幅の 2 乗で見積もる
	const perFrame = 100 * 1024 * (widthPixels / 800) ** 2;
	return Math.round(frames * perFrame);
}

export function describeSize(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export interface GifOptions {
	/** 連番の PNG（`printf` 形式ではなく、実際のファイル名の並び） */
	inputPattern: string;
	outputPath: string;
	fps: number;
	/** 横幅。縦は比率のまま */
	width: number;
}

/**
 * `ffmpeg` の引数。
 *
 * **色は 1 度作って使い回す**（`palettegen` → `paletteuse`）。
 * 既定の 256 色に落とすだけだと、画面の文字が汚れて読めなくなる。
 * 1 回の呼び出しで済ませたいので `split` で二股にする。
 */
export function buildGifArgs(options: GifOptions): string[] {
	const filter = [
		`fps=${options.fps}`,
		`scale=${options.width}:-1:flags=lanczos`,
		'split[a][b]',
		'[a]palettegen=stats_mode=diff[p]',
		'[b][p]paletteuse=dither=bayer:bayer_scale=3'
	].join(',');

	return [
		'-y',
		'-framerate',
		String(options.fps),
		'-i',
		options.inputPattern,
		'-vf',
		filter,
		'-loop',
		'0',
		options.outputPath
	];
}

/** `ffmpeg` が無いときに、人が続けられるようにする */
export function manualInstructions(options: GifOptions): string {
	return [
		'# GIF にする',
		'',
		'`ffmpeg` が見つかりませんでした。フレームは撮ってあるので、入れたあとに次を打てば作れます。',
		'',
		'```bash',
		`ffmpeg ${buildGifArgs(options).join(' ')}`,
		'```',
		'',
		'macOS なら `brew install ffmpeg` で入ります。',
		''
	].join('\n');
}

export function renderPlan(plan: CapturePlan, widthPixels: number): string {
	const size = describeSize(estimateBytes(plan.frames, widthPixels));
	const lines = [
		`${plan.seconds} 秒 / ${plan.frames} 枚（${Math.round(1000 / plan.intervalMs)} fps）`,
		`できあがりは ${size} くらいの見込みです`
	];
	if (plan.note) {
		lines.push(plan.note);
	}
	return lines.join('。');
}
