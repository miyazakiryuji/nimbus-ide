/**
 * 手元の端末から承認だけする（tasks.md T-054 / T-086）。
 *
 * いちばん多い時間の損は、**進んでいないことに気づいていない時間**。
 * 席を立った 1 時間、エージェントは最初の承認待ちで止まっていた、が実際に起きる。
 *
 * 承認だけなら、机の前にいなくてもできる。**同じ Wi-Fi の中でだけ**開く小さな画面を出して、
 * 「許す・断る」の 2 つだけを押せるようにする。
 *
 * ## ここで守ること
 *
 * この口は**エージェントに何かをさせる口**なので、緩いと事故る。設計として:
 *
 * 1. **既定では開かない。** 明示的に開いたときだけ動く
 * 2. **合言葉が要る。** 開くたびに作り直す（前に開いた URL は次には効かない）
 * 3. **できるのは承認だけ。** 指示は送れない・履歴は読めない・ファイルは見られない
 * 4. **黙って開きっぱなしにしない。** 使われないまま時間が経ったら閉じる
 * 5. **秘密は載せない。** 画面に出す文からは、渡す前に秘密を伏せる
 *
 * VS Code に依存しない（合言葉の生成と HTTP は呼び出し側）。
 */

/** 手元の端末に見せる 1 件。**中身は要約だけ**（ファイルの中身は載せない） */
export interface RemoteItem {
	id: string;
	toolName: string;
	summary: string;
	/** 高いものを先に見せる */
	risk: 'low' | 'medium' | 'high';
	/** 待ち始めてからの秒数 */
	waitingSeconds: number;
}

export type RemoteRoute =
	| { kind: 'page' }
	| { kind: 'list' }
	| { kind: 'decide'; id: string; allow: boolean }
	| { kind: 'unauthorized' }
	| { kind: 'notfound' };

/**
 * 道を割り出す。**合言葉は道の先頭に置く**
 * （クエリだとログや履歴に残りやすく、`Referer` で外へ漏れる経路がある）。
 *
 * - `/<token>/` — 画面
 * - `/<token>/api/list` — 一覧
 * - `/<token>/api/allow/<id>` `/<token>/api/deny/<id>` — 答える
 */
export function matchRoute(pathname: string, token: string): RemoteRoute {
	const parts = pathname.split('/').filter((part) => part.length > 0);
	if (parts.length === 0 || parts[0] !== token) {
		return { kind: 'unauthorized' };
	}
	const rest = parts.slice(1);
	if (rest.length === 0) {
		return { kind: 'page' };
	}
	if (rest[0] !== 'api') {
		return { kind: 'notfound' };
	}
	if (rest[1] === 'list' && rest.length === 2) {
		return { kind: 'list' };
	}
	if ((rest[1] === 'allow' || rest[1] === 'deny') && rest.length === 3 && rest[2].length > 0) {
		return { kind: 'decide', id: decodeURIComponent(rest[2]), allow: rest[1] === 'allow' };
	}
	return { kind: 'notfound' };
}

/** 手元の端末で開く URL */
export function pairingUrl(host: string, port: number, token: string): string {
	return `http://${host}:${port}/${token}/`;
}

/** 危ないものを先に、同じ危なさなら待っている順に */
export function orderItems(items: readonly RemoteItem[]): RemoteItem[] {
	const weight = { high: 0, medium: 1, low: 2 };
	return [...items].sort(
		(a, b) => weight[a.risk] - weight[b.risk] || b.waitingSeconds - a.waitingSeconds
	);
}

/** 開いたままにしてよいか。使われないまま時間が経ったら閉じる */
export function shouldClose(lastSeen: number, now: number, idleMs: number): boolean {
	return now - lastSeen >= idleMs;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const RISK_LABEL: Record<RemoteItem['risk'], string> = { high: '要注意', medium: '確認', low: '軽い' };

/** 待ち時間の言い方。**秒は見せない**（1 秒ごとに変わる数字は落ち着かない） */
export function waitingLabel(seconds: number): string {
	if (seconds < 60) {
		return 'たった今';
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes} 分待ち`;
	}
	return `${Math.floor(minutes / 60)} 時間待ち`;
}

/**
 * 手元の端末に出す画面。
 *
 * **外に何も取りに行かない**（同じ Wi-Fi の中だけで開くので、CDN は届かないことがある）。
 * 押せるのは「許す」と「断る」だけ。
 */
export function renderPage(title: string): string {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; font-family: -apple-system, system-ui, sans-serif; }
body { margin: 0; padding: 16px; background: Canvas; color: CanvasText; }
h1 { font-size: 17px; margin: 0 0 12px; }
.item { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 12px; padding: 12px; margin-bottom: 12px; }
.tool { font-weight: 600; font-size: 15px; }
.meta { font-size: 13px; opacity: .7; margin: 2px 0 10px; }
.summary { font-size: 14px; white-space: pre-wrap; word-break: break-word; margin-bottom: 12px; }
.row { display: flex; gap: 8px; }
button { flex: 1; padding: 12px; font-size: 15px; border-radius: 10px; border: 0; }
.allow { background: #2f7d32; color: #fff; }
.deny { background: color-mix(in srgb, CanvasText 12%, transparent); color: CanvasText; }
.empty { opacity: .6; font-size: 14px; }
.high { border-color: #c25a00; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div id="list"><p class="empty">読み込んでいます…</p></div>
<script>
const base = location.pathname.replace(/\\/$/, '');
async function refresh() {
  try {
    const res = await fetch(base + '/api/list');
    if (!res.ok) { return; }
    render(await res.json());
  } catch (e) { /* 圏外。次の周回で拾う */ }
}
function render(items) {
  const list = document.getElementById('list');
  if (!items.length) { list.innerHTML = '<p class="empty">待っているものはありません。</p>'; return; }
  list.innerHTML = items.map(item =>
    '<div class="item ' + (item.risk === 'high' ? 'high' : '') + '">' +
    '<div class="tool">' + item.toolName + '</div>' +
    '<div class="meta">' + item.riskLabel + '・' + item.waiting + '</div>' +
    '<div class="summary">' + item.summary + '</div>' +
    '<div class="row">' +
    '<button class="deny" data-id="' + item.id + '" data-allow="0">断る</button>' +
    '<button class="allow" data-id="' + item.id + '" data-allow="1">許す</button>' +
    '</div></div>').join('');
  for (const button of list.querySelectorAll('button')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const verb = button.dataset.allow === '1' ? 'allow' : 'deny';
      await fetch(base + '/api/' + verb + '/' + encodeURIComponent(button.dataset.id), { method: 'POST' });
      refresh();
    });
  }
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>
`;
}

/** 一覧として返す形。**要約は escape 済み**で渡す（画面側でそのまま入れるので） */
export function renderList(items: readonly RemoteItem[]): string {
	return JSON.stringify(
		orderItems(items).map((item) => ({
			id: item.id,
			toolName: escapeHtml(item.toolName),
			summary: escapeHtml(item.summary),
			risk: item.risk,
			riskLabel: RISK_LABEL[item.risk],
			waiting: waitingLabel(item.waitingSeconds)
		}))
	);
}

/** 開いたことを人に伝える文。**閉じ方まで書く**（開けっぱなしが事故のもと） */
export function describeServer(url: string, idleMinutes: number): string {
	return [
		'同じ Wi-Fi の中から、承認だけできる画面を開きました。',
		`  ${url}`,
		'',
		`できるのは「許す・断る」だけです。指示は送れません。${idleMinutes} 分使われなければ自動で閉じます。`,
		'この URL は開くたびに変わります（前の URL は効きません）。'
	].join('\n');
}
