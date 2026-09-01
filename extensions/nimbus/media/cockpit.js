// @ts-check
/**
 * コックピットの表示層（T-271）。VS Code のチャットと同じ作りに寄せてある。
 *
 * 状態は拡張ホスト側が持つので、ここは受け取ったものを描くだけ。
 * **Markdown もここでは解析しない** — 塊にしたものが送られてくるので、それを DOM に写す。
 * `innerHTML` は使わない（応答やツール結果をそのまま HTML として解釈させない）。
 */
(function () {
	const vscode = acquireVsCodeApi();

	const log = /** @type {HTMLElement} */ (document.getElementById('log'));
	const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
	const composer = /** @type {HTMLElement} */ (document.getElementById('composer'));
	const sendButton = /** @type {HTMLButtonElement} */ (document.getElementById('send'));
	const interruptButton = /** @type {HTMLButtonElement} */ (document.getElementById('interrupt'));
	const attachButton = /** @type {HTMLButtonElement} */ (document.getElementById('attach'));
	const attachmentsBar = /** @type {HTMLElement} */ (document.getElementById('attachments'));
	const approvalsArea = /** @type {HTMLElement} */ (document.getElementById('approvals'));
	const sessionTabs = /** @type {HTMLElement} */ (document.getElementById('sessionTabs'));
	const railSash = /** @type {HTMLElement} */ (document.getElementById('railSash'));
	const homeBar = /** @type {HTMLElement} */ (document.getElementById('homeBar'));
	const homeBack = /** @type {HTMLButtonElement} */ (document.getElementById('homeBack'));
	const homeBarSession = /** @type {HTMLElement} */ (document.getElementById('homeBarSession'));
	const groupTabs = /** @type {HTMLElement} */ (document.getElementById('groupTabs'));
	const homePanel = /** @type {HTMLElement} */ (document.getElementById('home'));
	const quotaLine = /** @type {HTMLElement} */ (document.getElementById('quota'));
	const pickPolicy = /** @type {HTMLButtonElement} */ (document.getElementById('pickPolicy'));
	const pickModel = /** @type {HTMLButtonElement} */ (document.getElementById('pickModel'));
	const pickEffort = /** @type {HTMLButtonElement} */ (document.getElementById('pickEffort'));
	const sessionState = /** @type {HTMLElement} */ (document.getElementById('sessionState'));
	const statusText = /** @type {HTMLElement} */ (document.getElementById('statusText'));
	const statusMeta = /** @type {HTMLElement} */ (document.getElementById('statusMeta'));

	/** コックピットは Claude、ヘルプはゆあ。表示名だけを差し替える */
	const ASSISTANT = document.body.dataset.assistant || 'Claude';

	/** ツール呼び出しの行。結果が返ったら同じ行を書き換える */
	const toolRows = new Map();
	/** 実行中の表示 */
	let workingRow = null;
	let workingSince = 0;
	let workingTimer = 0;
	let running = false;
	/** 送った文の控え。↑ で戻れるようにする */
	const history = [];
	let historyIndex = -1;
	/** スラッシュコマンドの候補（拡張から届く） */
	let commands = [];
	/** タブ（束）ごとのセッション（T-314）。Home と 2 段タブ列の材料 */
	let homeGroups = [];
	/** Home（束一覧）を開いているか */
	let homeOpen = false;
	/** 広い面の上段で選んでいるタブ。null なら前面セッションのタブに従う */
	let viewGroupId = null;
	/** 使い始めの「準備」（T-285）。足りないものは、詰まる場所に出す */
	let readiness = [];

	/**
	 * 状態の言葉。**帯（`core/sessionTabs.ts` の `label`）と同じ語を使う**（T-288）。
	 * 実物を見たら、帯が「作業中」・入力欄が「実行中」と、隣り合う 2 か所で
	 * 同じ状態を別の言葉で言っていた。読む側は別の状態だと思う。
	 */
	const STATUS_LABEL = {
		'starting': '作業中',
		'running': '作業中',
		'awaiting-input': 'あなたの番',
		'interrupted': '中断',
		'completed': '完了',
		'error': 'エラー'
	};

	// ───────────────────────── 絵柄 ─────────────────────────
	//
	// codicon のフォントは webview の CSP（font-src なし）では読めないので、
	// 必要なものだけ SVG で持つ。外から何も読み込まないぶん、確実に出る。

	const PATHS = {
		close: 'M8 6.9 12.9 2 14 3.1 9.1 8 14 12.9 12.9 14 8 9.1 3.1 14 2 12.9 6.9 8 2 3.1 3.1 2z',
		pin: 'M9.9 1.2 14.8 6.1l-1.1 1.1-.9-.2-2.5 2.5.4 2.9-1.1 1.1-3.1-3.1-3.4 3.4-.8-.8 3.4-3.4L2.6 6.5l1.1-1.1 2.9.4L9.1 3.3l-.2-.9z',
		send: 'M1.7 14.3 14.5 8 1.7 1.7 1.6 6.6 10 8l-8.4 1.4z',
		stop: 'M4 4h8v8H4z',
		attach: 'M9.5 2a3.5 3.5 0 0 1 3.5 3.5v5a2.5 2.5 0 0 1-5 0V6h1.2v4.5a1.3 1.3 0 0 0 2.6 0v-5A2.3 2.3 0 0 0 9.5 3.2 2.3 2.3 0 0 0 7.2 5.5v5.8a3.5 3.5 0 0 0 7 0V6h1.2v5.3a4.7 4.7 0 0 1-9.4 0V5.5A3.5 3.5 0 0 1 9.5 2z',
		copy: 'M4 2h7v2h1V1H3v10h3v-1H4z M6 5h7v10H6z M7 6v8h5V6z',
		insert: 'M8 1v9.2l3.1-3.1.9.9L7.5 12.6 3 8l.9-.9L7 10.2V1zM2 14h12v1H2z',
		newFile: 'M9 1H3v14h10V5zm3 4h-3V2zM7 7h1v2h2v1H8v2H7v-2H5V9h2z',
		terminal: 'M2 3h12v10H2zm1 1v8h10V4zM4.5 6l2 2-2 2 .7.7L7.9 8 5.2 5.3zM8.5 10h3v1h-3z',
		dot: 'M8 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z',
		add: 'M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z',
		chevron: 'M6 4l4 4-4 4z',
		check: 'M6.3 12.7 2 8.4l1-1 3.3 3.3L13 4l1 1z',
		error: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.8 11H7.2v-1.6h1.6zm0-2.8H7.2V4h1.6z',
		spinner: 'M8 1.5A6.5 6.5 0 1 0 14.5 8H13A5 5 0 1 1 8 3z',
		close: 'M4.3 3.3 8 7l3.7-3.7.7.7L8.7 7.7l3.7 3.7-.7.7L8 8.4l-3.7 3.7-.7-.7 3.7-3.7-3.7-3.7z',
		user: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1.2c-2.7 0-5 1.4-5 3.1V14h10v-1.7c0-1.7-2.3-3.1-5-3.1z',
		cloud: 'M12.2 13H4.6A3.6 3.6 0 0 1 4.2 6a4.4 4.4 0 0 1 8.3.9 3.1 3.1 0 0 1-.3 6.1z',
		menu: 'M2 4h12v1.4H2zM2 7.3h12v1.4H2zM2 10.6h12V12H2z',
		edit: 'M11.1 2.2a1.6 1.6 0 0 1 2.3 0l.4.4a1.6 1.6 0 0 1 0 2.3l-7.3 7.3-3.2.9.9-3.2zM10 4.5l1.5 1.5',
		home: 'M8 2 2 7.4l.9 1L4 7.4V13h3.2V9.6h1.6V13H12V7.4l1.1 1 .9-1z',
		move: 'M9.2 4.2 12.9 8l-3.7 3.8-1-1 2-2.1H3.5V7.3h6.7l-2-2.1z',
		// 一覧から会話へ戻る（T-345）。ブラウザの戻ると同じ向き
		back: 'M7.4 2.5 8.5 3.6 5.1 7H14v2H5.1l3.4 3.4-1.1 1.1L1.9 8z'
	};

	/** @param {string} name @param {string} [className] */
	/**
	 * アイコンを 1 つ作る。
	 *
	 * **寸法と色はここで付ける。** 付けないと、SVG は既定の 300×150 まで伸び、
	 * 塗りは黒になる。実際にシェブロンがそうなっていて、折りたたみの見出しが
	 * **巨大な黒い三角形**になっていた（T-287）。呼ぶ側の CSS 頼みにすると、
	 * 書き忘れた 1 か所がこうなるので、作るところで決めきる。
	 *
	 * 大きさは 16（base）か 12（compact）の 2 つだけ。**14 は常に間違い**
	 * （design-philosophy「Icon sizes」）。文字の横に並ぶ小さな字面は compact。
	 */
	function icon(name, className, size = 16) {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('width', String(size));
		svg.setAttribute('height', String(size));
		svg.setAttribute('aria-hidden', 'true');
		if (className) {
			svg.setAttribute('class', className);
		}
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', PATHS[name] ?? PATHS.check);
		// テーマに従う。指定が無いと既定の黒になり、暗いテーマで沈む
		path.setAttribute('fill', 'currentColor');
		svg.appendChild(path);
		return svg;
	}

	/** アイコンだけのボタン */
	function iconButton(name, title, onClick, className) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = `icon-button${className ? ` ${className}` : ''}`;
		button.title = title;
		button.setAttribute('aria-label', title);
		button.appendChild(icon(name));
		button.addEventListener('click', onClick);
		return button;
	}

	// ───────────────────────── 会話の列 ─────────────────────────

	function atBottom() {
		return log.scrollHeight - log.scrollTop - log.clientHeight < 40;
	}

	/*
	 * 文字を選んでいるあいだは、追いかけの自動スクロールを止める（T-339）。
	 * 応答が流れている最中に引くと、掴んだ場所が足元で動いて**引いた範囲と違うところが選ばれる**
	 * （実測: 上から下へ引いたのに、上の古い発言が選ばれて止まった）。
	 */
	let selectingText = false;
	let followedBeforeSelect = false;
	log.addEventListener('mousedown', () => {
		selectingText = true;
		followedBeforeSelect = atBottom();
	});
	// 面の外で指を離すこともあるので、離したことは window で拾う
	window.addEventListener('mouseup', () => {
		if (!selectingText) {
			return;
		}
		selectingText = false;
		// ただの click だったのなら追いかけへ戻す。選んだのなら、その場に留める
		if (!(window.getSelection()?.toString() ?? '') && followedBeforeSelect) {
			log.scrollTop = log.scrollHeight;
		}
	});

	function stickToBottom(was) {
		if (was && !selectingText) {
			log.scrollTop = log.scrollHeight;
		}
	}

	/**
	 * 1 つの発言。VS Code のチャットと同じで「アバター＋名前」の見出しに本文が続く。
	 * @param {string} kind user | assistant | system | error | thinking
	 * @param {string|null} who 見出しに出す名前。null なら見出しを出さない
	 */
	function turn(kind, who, iconName) {
		const was = atBottom();
		clearWelcome();
		const element = document.createElement('div');
		element.className = `turn ${kind}`;
		if (who) {
			const header = document.createElement('div');
			header.className = 'turn-header';
			const avatar = document.createElement('span');
			avatar.className = 'avatar';
			avatar.appendChild(icon(iconName ?? 'cloud'));
			header.appendChild(avatar);
			const name = document.createElement('h3');
			name.className = 'username';
			name.textContent = who;
			header.appendChild(name);
			element.appendChild(header);
		}
		const body = document.createElement('div');
		body.className = 'turn-body';
		element.appendChild(body);
		log.appendChild(element);
		stickToBottom(was);
		return { element, body };
	}

	/** 文字だけの発言 */
	function plainTurn(kind, who, text, iconName) {
		const { element, body } = turn(kind, who, iconName);
		const paragraph = document.createElement('p');
		paragraph.textContent = text;
		body.appendChild(paragraph);
		return element;
	}

	/**
	 * 送った指示を、押して直せるようにする（T-363・利用者依頼 2026-08-31）。
	 *
	 * **GitHub Copilot の「Edit request」に合わせた**（同梱の upstream 実装を読んで写した。
	 * `src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts` の
	 * `chat.editRequests === 'inline'` の枝）。要は次の 2 つ:
	 *
	 * - **発言そのものが押せる**（鉛筆を別に置かない）。ホバーで何が起きるかを言う
	 * - **押した瞬間には何も壊さない。** 壊れるのは送信を押したとき。だから
	 *   「直そうとしてやめた」で何も失われない
	 *
	 * 押しても編集に入らない場面も Copilot と同じ — **リンクの上・文字を選んでいるとき**・
	 * コードブロックの中。とくに選択は T-339 で直したばかりなので、ここを壊さない。
	 */
	function makeEditable(element) {
		const index = document.querySelectorAll('.turn.user').length - 1;
		element.classList.add('editable');
		element.title = '押すと、この指示を直せます';
		element.addEventListener('click', (event) => {
			if (event.target instanceof HTMLElement && event.target.closest('a, pre, code')) {
				return; // リンクとコードは、押した先が別にある
			}
			const selection = window.getSelection();
			if (selection && !selection.isCollapsed && selection.toString().length > 0) {
				return; // 文字を選んでいる最中（T-339 で直した選択を奪わない）
			}
			vscode.postMessage({ type: 'editRequest', turnIndex: index });
		});
		return element;
	}

	// ───────────────────────── 本文（塊 → DOM） ─────────────────────────

	/** 行の中の断片を並べる */
	function appendSpans(parent, spans) {
		for (const span of spans ?? []) {
			if (span.kind === 'code') {
				const code = document.createElement('code');
				code.className = 'inline';
				code.textContent = span.text;
				parent.appendChild(code);
			} else if (span.kind === 'strong') {
				const strong = document.createElement('strong');
				strong.textContent = span.text;
				parent.appendChild(strong);
			} else if (span.kind === 'em') {
				const em = document.createElement('em');
				em.textContent = span.text;
				parent.appendChild(em);
			} else if (span.kind === 'link') {
				const link = document.createElement('a');
				link.href = span.href;
				link.textContent = span.text;
				parent.appendChild(link);
			} else {
				parent.appendChild(document.createTextNode(span.text));
			}
		}
	}

	/**
	 * コードブロック。VS Code のチャットと同じ 4 つの操作を付ける。
	 * 出てきたコードを手で選び直して貼るのは、何十回もやると効いてくる。
	 */
	function appendCodeBlock(parent, block) {
		const wrapper = document.createElement('div');
		wrapper.className = 'codeblock';

		const header = document.createElement('div');
		header.className = 'codeblock-header';
		const language = document.createElement('span');
		language.className = 'codeblock-language';
		language.textContent = block.language || 'text';
		header.appendChild(language);

		const actions = document.createElement('div');
		actions.className = 'codeblock-actions';
		const post = (action) => () =>
			vscode.postMessage({ type: 'code', action, text: block.text, language: block.language ?? '' });
		actions.appendChild(iconButton('copy', '写す', post('copy')));
		actions.appendChild(iconButton('insert', 'エディタへ入れる', post('insert')));
		actions.appendChild(iconButton('newFile', '新しいファイルにする', post('newFile')));
		actions.appendChild(iconButton('terminal', 'ターミナルへ送る（実行はしない）', post('terminal')));
		header.appendChild(actions);
		wrapper.appendChild(header);

		const pre = document.createElement('pre');
		const code = document.createElement('code');
		code.textContent = block.text;
		pre.appendChild(code);
		wrapper.appendChild(pre);
		parent.appendChild(wrapper);
	}

	/** 塊の列を本文へ */
	function appendBlocks(parent, blocks) {
		for (const block of blocks ?? []) {
			switch (block.kind) {
				case 'heading': {
					const heading = document.createElement(`h${Math.min(block.level + 1, 4)}`);
					appendSpans(heading, block.spans);
					parent.appendChild(heading);
					break;
				}
				case 'code':
					appendCodeBlock(parent, block);
					break;
				case 'table': {
					// 表（T-304）。Claude はよく表で答えるのに種類が無く、
					// `| 項目 | 値 |` がそのまま段落として並んでいた
					const table = document.createElement('table');
					table.className = 'md-table';
					const head = document.createElement('thead');
					const headRow = document.createElement('tr');
					for (const cell of block.header) {
						const th = document.createElement('th');
						appendSpans(th, cell);
						headRow.appendChild(th);
					}
					head.appendChild(headRow);
					table.appendChild(head);
					const body = document.createElement('tbody');
					for (const row of block.rows) {
						const tr = document.createElement('tr');
						for (const cell of row) {
							const td = document.createElement('td');
							appendSpans(td, cell);
							tr.appendChild(td);
						}
						body.appendChild(tr);
					}
					table.appendChild(body);
					// 幅の狭いサイドバーでは表がはみ出す。**横に逃がす**（縦に潰さない）
					const scroller = document.createElement('div');
					scroller.className = 'md-table-scroll';
					scroller.appendChild(table);
					parent.appendChild(scroller);
					break;
				}
				case 'list': {
					const list = document.createElement(block.ordered ? 'ol' : 'ul');
					for (const item of block.items) {
						const li = document.createElement('li');
						appendSpans(li, item);
						list.appendChild(li);
					}
					parent.appendChild(list);
					break;
				}
				case 'quote': {
					const quote = document.createElement('blockquote');
					appendSpans(quote, block.spans);
					parent.appendChild(quote);
					break;
				}
				case 'rule':
					parent.appendChild(document.createElement('hr'));
					break;
				default: {
					const paragraph = document.createElement('p');
					appendSpans(paragraph, block.spans);
					parent.appendChild(paragraph);
				}
			}
		}
	}

	/** 応答ごとの操作（写す・やり直す） */
	function appendTurnActions(element, text) {
		const actions = document.createElement('div');
		actions.className = 'turn-actions';
		actions.appendChild(iconButton('copy', '応答を写す', () => vscode.postMessage({ type: 'copyText', text })));
		element.appendChild(actions);
	}

	// ───────────────────────── 折りたたみ（ツール・思考） ─────────────────────────

	/**
	 * 畳んだ 1 行。押すと中身が出る。
	 * ツールの呼び出しは列に流し続けると会話が読めなくなるので、既定は畳む。
	 */
	function collapsible(title, detail, state) {
		const was = atBottom();
		clearWelcome();
		const wrapper = document.createElement('div');
		wrapper.className = 'turn tool';

		const box = document.createElement('div');
		box.className = 'collapsible';

		const summary = document.createElement('button');
		summary.type = 'button';
		summary.className = 'collapsible-summary';
		summary.title = '中身を開く／閉じる';
		summary.appendChild(icon('chevron', 'chevron', 12));
		const stateIcon = icon(state ?? 'spinner', `state-icon${state ? '' : ' running'}`);
		summary.appendChild(stateIcon);
		const label = document.createElement('span');
		label.className = 'collapsible-title';
		label.textContent = title;
		summary.appendChild(label);
		const note = document.createElement('span');
		note.className = 'collapsible-note';
		summary.appendChild(note);
		/*
		 * 文字を選ぼうと引いたぶんは、開閉に数えない（T-339）。
		 * ツール名とコマンドは**写したい筆頭**なのに、引くと必ず click が続けて走って畳みが動き、
		 * 選んだそばから中身が出たり消えたりしていた（実測: 直し前は 100% 開いた）。
		 */
		let pressedAt = null;
		summary.addEventListener('mousedown', (e) => { pressedAt = { x: e.clientX, y: e.clientY }; });
		summary.addEventListener('click', (e) => {
			const dragged = pressedAt && (Math.abs(e.clientX - pressedAt.x) > 3 || Math.abs(e.clientY - pressedAt.y) > 3);
			pressedAt = null;
			if (dragged) {
				return;
			}
			box.classList.toggle('open');
		});
		box.appendChild(summary);

		const body = document.createElement('pre');
		body.className = 'collapsible-detail';
		body.textContent = detail ?? '';
		box.appendChild(body);

		wrapper.appendChild(box);
		log.appendChild(wrapper);
		stickToBottom(was);
		return { box, stateIcon, note, body, summary, label };
	}

	// ───────────────────────── 実行中の表示 ─────────────────────────

	function showWorking() {
		if (workingRow) {
			return;
		}
		const was = atBottom();
		workingRow = document.createElement('div');
		workingRow.className = 'working';
		workingRow.appendChild(icon('spinner', 'state-icon running'));
		const text = document.createElement('span');
		text.textContent = '考えています…';
		workingRow.appendChild(text);
		log.appendChild(workingRow);
		stickToBottom(was);
		workingSince = Date.now();
		workingTimer = setInterval(() => {
			const seconds = Math.round((Date.now() - workingSince) / 1000);
			text.textContent = `考えています… ${seconds}s`;
		}, 1000);
	}

	function hideWorking() {
		if (workingTimer) {
			clearInterval(workingTimer);
			workingTimer = 0;
		}
		if (workingRow) {
			workingRow.remove();
			workingRow = null;
		}
	}

	function setRunning(next) {
		running = next;
		sendButton.hidden = next;
		interruptButton.hidden = !next;
		if (next) {
			showWorking();
		} else {
			hideWorking();
		}
	}

	// ───────────────────────── 空のときの案内 ─────────────────────────

	const SUGGESTIONS = [
		'このリポジトリの構成を教えて',
		'いま開いているファイルの気になるところを挙げて',
		'テストを走らせて、落ちたら直して'
	];

	/**
	 * 足りていないものを、コックピットの中に出す（T-285）。
	 *
	 * これまで案内は**送ろうとして初めて**トーストで出て、しかも設定名を告げるだけだった。
	 * 詰まる場所と直す場所を同じにする（人間工学 E2）。ボタンは押したら直るところまで（T-244）。
	 */
	function renderReadiness(parent) {
		const blocked = readiness.filter((check) => check.state === 'blocked');
		if (blocked.length === 0) {
			return false;
		}
		const box = document.createElement('div');
		box.className = 'readiness';

		const title = document.createElement('h2');
		title.textContent = '使い始める前に';
		box.appendChild(title);

		const lead = document.createElement('p');
		lead.textContent = `あと ${blocked.length} 件で送れるようになります。`;
		box.appendChild(lead);

		for (const check of blocked) {
			const row = document.createElement('div');
			row.className = 'readiness-item';

			const head = document.createElement('div');
			head.className = 'readiness-head';
			head.appendChild(icon('error', 'state-icon'));
			const name = document.createElement('span');
			name.className = 'readiness-title';
			name.textContent = check.title;
			head.appendChild(name);
			row.appendChild(head);

			const detail = document.createElement('p');
			detail.className = 'readiness-detail';
			detail.textContent = check.detail;
			row.appendChild(detail);

			if (check.actions.length > 0) {
				const actions = document.createElement('div');
				actions.className = 'readiness-actions';
				check.actions.forEach((action, index) => {
					const button = document.createElement('button');
					button.type = 'button';
					// 先頭を主にする。並べるほど、どれを押せばよいか分からなくなる
					button.className = index === 0 ? 'readiness-action' : 'readiness-action secondary';
					button.textContent = action.label;
					button.addEventListener('click', () => vscode.postMessage({ type: 'run', command: action.command }));
					actions.appendChild(button);
				});
				row.appendChild(actions);
			}
			box.appendChild(row);
		}

		parent.appendChild(box);
		return true;
	}

	function clearWelcome() {
		const welcome = document.getElementById('welcome');
		if (welcome) {
			welcome.remove();
		}
	}

	function showWelcome() {
		if (log.childElementCount > 0) {
			return;
		}
		const box = document.createElement('div');
		box.id = 'welcome';
		box.className = 'welcome';

		// 足りないものがあるなら、頼みかたの案内より先に出す。
		// 送れない状態で「Enter で送ります」だけ読ませても、迷わせるだけ
		if (renderReadiness(box)) {
			log.appendChild(box);
			return;
		}

		const title = document.createElement('h2');
		title.textContent = `${ASSISTANT} に頼む`;
		box.appendChild(title);
		const lead = document.createElement('p');
		lead.textContent = '下の欄に書いて Enter で送ります（Shift+Enter で改行）。画像は貼り付けかドロップで添えられます。';
		box.appendChild(lead);
		const list = document.createElement('div');
		list.className = 'welcome-suggestions';
		for (const text of SUGGESTIONS) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'suggestion';
			button.textContent = text;
			button.addEventListener('click', () => {
				input.value = text;
				autoGrow();
				input.focus();
			});
			list.appendChild(button);
		}
		box.appendChild(list);
		log.appendChild(box);
	}

	// ───────────────────────── イベントを描く ─────────────────────────

	function summarizeToolInput(value) {
		if (!value || typeof value !== 'object') {
			return '';
		}
		const candidate = value.command ?? value.file_path ?? value.path ?? value.pattern ?? value.url;
		if (typeof candidate !== 'string') {
			return '';
		}
		const flat = candidate.replace(/\s+/g, ' ').trim();
		return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
	}

	function renderEvent(event, blocks) {
		switch (event.kind) {
			case 'session-init':
				plainTurn('system', null, `セッション開始 · ${event.model} · ${event.cwd}`);
				break;

			case 'user-text':
				makeEditable(plainTurn('user', 'あなた', event.text, 'user'));
				break;

			case 'assistant-text': {
				const { element, body } = turn('assistant', ASSISTANT, 'cloud');
				if (blocks && blocks.length > 0) {
					appendBlocks(body, blocks);
				} else {
					const paragraph = document.createElement('p');
					paragraph.textContent = event.text;
					body.appendChild(paragraph);
				}
				appendTurnActions(element, event.text);
				break;
			}

			case 'assistant-thinking': {
				const row = collapsible('考えていること', event.text, 'check');
				row.box.parentElement.classList.add('thinking');
				break;
			}

			case 'tool-use': {
				const summary = summarizeToolInput(event.input);
				const row = collapsible(summary ? `${event.toolName} · ${summary}` : event.toolName, '');
				toolRows.set(event.toolUseId, row);
				break;
			}

			case 'tool-result': {
				const row = toolRows.get(event.toolUseId);
				const preview = event.preview.length > 4000 ? `${event.preview.slice(0, 4000)}…` : event.preview;
				if (row) {
					row.stateIcon.replaceWith(icon(event.isError ? 'error' : 'check', 'state-icon'));
					row.body.textContent = preview;
					row.note.textContent = event.isError ? '失敗' : '';
					if (event.isError) {
						row.box.classList.add('failed', 'open');
					}
				} else {
					plainTurn(event.isError ? 'error' : 'system', null, preview);
				}
				break;
			}

			case 'turn-result': {
				const cost = typeof event.totalCostUsd === 'number' ? ` · $${event.totalCostUsd.toFixed(4)}` : '';
				statusMeta.textContent = `${event.numTurns} ターン · ${(event.durationMs / 1000).toFixed(1)}s${cost}`;
				break;
			}

			case 'status':
				statusText.textContent = STATUS_LABEL[event.status] ?? event.status;
				setRunning(event.status === 'running' || event.status === 'starting');
				break;

			case 'session-error':
				plainTurn('error', 'エラー', event.message, 'error');
				break;

			/*
			 * Nimbus が足した但し書き（T-367）。**会話の流れの中に置く** —
			 * 通知（トースト）は消えるので、「巻き戻した」のような後から効いてくる事実は
			 * ここに残さないと、面を開き直した人に伝わらない
			 */
			case 'notice':
				plainTurn('system', null, event.text);
				break;
		}
	}

	/** 置かれた仮定を、本文とは別に目立たせて並べる（違っていたら早く気づけるように） */
	function renderAssumptions(assumptions) {
		const was = atBottom();
		const box = document.createElement('div');
		box.className = 'turn assumption';
		const label = document.createElement('div');
		label.className = 'assumption-label';
		label.textContent = '置いた仮定';
		box.appendChild(label);
		const list = document.createElement('ul');
		list.className = 'assumption-list';
		for (const text of assumptions) {
			const item = document.createElement('li');
			item.textContent = text;
			list.appendChild(item);
		}
		box.appendChild(list);
		log.appendChild(box);
		stickToBottom(was);
	}

	// ───────────────────────── 添付（T-040） ─────────────────────────

	const pending = [];

	function renderPending() {
		attachmentsBar.textContent = '';
		attachmentsBar.hidden = pending.length === 0;
		pending.forEach((item, index) => {
			const chip = document.createElement('button');
			chip.className = 'attachment';
			chip.type = 'button';
			// 押したら外せる。貼り間違いを送るしかないのは困る。
			// **名前も添える**（T-357）— 札は幅で切るので、切れた先はここでしか読めない
			chip.title = `${item.name}（押すと外す）`;
			const name = document.createElement('span');
			name.textContent = item.name;
			chip.appendChild(name);
			chip.appendChild(icon('close'));
			chip.addEventListener('click', () => {
				pending.splice(index, 1);
				renderPending();
			});
			attachmentsBar.appendChild(chip);
		});
	}

	function addFile(file) {
		if (!file || !file.type.startsWith('image/')) {
			return;
		}
		const reader = new FileReader();
		reader.addEventListener('load', () => {
			if (typeof reader.result === 'string') {
				pending.push({ name: file.name || 'clipboard', dataUrl: reader.result });
				renderPending();
			}
		});
		reader.readAsDataURL(file);
	}

	// ───────────────────────── 承認カード（T-266） ─────────────────────────

	/**
	 * いま答えを待っている承認。
	 *
	 * **読んでいる場所と決める場所を同じにする。** 別の一覧へ目を移して、
	 * どのツールの話だったか思い出して、戻ってくる — その往復が要らなくなる。
	 * 入力欄のすぐ上に置くのは、手がもう そこにあるから（人間工学 E2）。
	 */
	function renderApprovals(items, activeSessionId) {
		approvalsArea.textContent = '';
		approvalsArea.hidden = items.length === 0;
		for (const item of items) {
			const card = document.createElement('div');
			card.className = `approval risk-${item.risk}`;

			const title = document.createElement('div');
			title.className = 'approval-title';
			title.textContent = `${item.toolName} を実行してよいか待っています`;
			card.appendChild(title);

			// 並列で走らせていると、どのセッションの話かが分からないと決められない
			if (activeSessionId && item.sessionId && item.sessionId !== activeSessionId) {
				const who = document.createElement('div');
				who.className = 'approval-who';
				who.textContent = `別のセッション（${item.sessionId.slice(0, 8)}）`;
				card.appendChild(who);
			}

			const summary = document.createElement('div');
			summary.className = 'approval-summary';
			summary.textContent = item.summary;
			card.appendChild(summary);

			const actions = document.createElement('div');
			actions.className = 'approval-actions';
			// ラベルは短くしてあるぶん、**押した結果の違い**はここで説明する（T-312）。
			// 「許可」と「常に許可」の差を知らずに押すと、覚えの無い自動許可が残る
			const DECISION_HINTS = {
				'allow': '今回のこの実行だけを許可します',
				'allow-session': 'このセッションのあいだは、同じ確認を出さずに許可します',
				'always-allow': 'ルールとして設定に保存し、以後は確認しません',
				'deny': '実行させません。セッションは止まらず、拒否されたことが伝わります'
			};
			const add = (label, decision, secondary) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.textContent = label;
				button.title = DECISION_HINTS[decision] ?? '';
				if (secondary) {
					button.className = 'secondary';
				}
				button.addEventListener('click', () => {
					vscode.postMessage({ type: 'approve', id: item.id, decision });
					// 押した手応えはその場で返す。拡張側の更新を待つと、押せたのか分からない
					card.remove();
					approvalsArea.hidden = approvalsArea.childElementCount === 0;
				});
				actions.appendChild(button);
			};
			add('許可', 'allow');
			add('このセッションは許可', 'allow-session', true);
			if (item.rule) {
				add('常に許可', 'always-allow', true);
			}
			add('拒否', 'deny', true);
			card.appendChild(actions);
			approvalsArea.appendChild(card);
		}
	}

	// ───────────────────────── スラッシュコマンド ─────────────────────────

	let slashMenu = null;
	let slashIndex = 0;
	let slashMatches = [];

	function closeSlash() {
		if (slashMenu) {
			slashMenu.remove();
			slashMenu = null;
		}
		slashMatches = [];
		slashIndex = 0;
	}

	function applySlash(item) {
		input.value = item.text;
		closeSlash();
		autoGrow();
		input.focus();
	}

	function updateSlash() {
		const value = input.value;
		// 先頭が `/` のときだけ。文中の URL などで出てこないように
		if (!value.startsWith('/') || commands.length === 0) {
			closeSlash();
			return;
		}
		const query = value.slice(1).toLowerCase();
		slashMatches = commands.filter((item) => item.name.toLowerCase().includes(query));
		if (slashMatches.length === 0) {
			closeSlash();
			return;
		}
		if (!slashMenu) {
			slashMenu = document.createElement('div');
			slashMenu.className = 'slash-menu';
			composer.appendChild(slashMenu);
		}
		slashIndex = Math.min(slashIndex, slashMatches.length - 1);
		slashMenu.textContent = '';
		slashMatches.forEach((item, index) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = `slash-item${index === slashIndex ? ' active' : ''}`;
			const name = document.createElement('span');
			name.className = 'slash-name';
			name.textContent = `/${item.name}`;
			button.appendChild(name);
			if (item.detail) {
				const detail = document.createElement('span');
				detail.className = 'slash-detail';
				detail.textContent = item.detail;
				button.appendChild(detail);
			}
			button.addEventListener('click', () => applySlash(item));
			slashMenu.appendChild(button);
		});
	}

	// ───────────────────────── 入力欄 ─────────────────────────

	function autoGrow() {
		input.style.height = 'auto';
		input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
	}

	function send() {
		const text = input.value.trim();
		// 画像だけでも送れるようにする（「これ見て」で通じる場面がある）
		if (!text && pending.length === 0) {
			return;
		}
		const images = pending.splice(0, pending.length);
		renderPending();
		if (text) {
			history.push(text);
		}
		historyIndex = history.length;
		input.value = '';
		// 送った文は打ちかけではない（残すと、次に開いたとき二重に見える）
		rememberDraftText();
		closeSlash();
		autoGrow();
		vscode.postMessage({ type: 'send', text, images });
	}

	input.addEventListener('input', () => {
		autoGrow();
		rememberDraftText();
		updateSlash();
	});

	input.addEventListener('paste', (e) => {
		const items = (e.clipboardData && e.clipboardData.files) || [];
		for (const file of items) {
			addFile(file);
		}
	});

	/*
	 * 面のどこへ落としても添付できるように、`#input` と `document.body` の**両方**で受ける。
	 * ただし入力欄に落ちたイベントは body まで上がるので、**止めないと同じハンドラが 2 度走り、
	 * 1 枚落としただけで 2 枚溜まる**（T-349・敵対的試験 adv-10）。
	 * 敵対的な使いかたではなく、画像を入力欄へドラッグするという普通の操作で毎回踏み、
	 * そのまま送れば二重に課金する。
	 */
	for (const target of [input, document.body]) {
		target.addEventListener('dragover', (e) => e.preventDefault());
		target.addEventListener('drop', (e) => {
			const files = (e.dataTransfer && e.dataTransfer.files) || [];
			if (files.length === 0) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			for (const file of files) {
				addFile(file);
			}
		});
	}

	input.addEventListener('keydown', (e) => {
		// 候補が出ているあいだは、上下と Enter を候補に使う
		if (slashMatches.length > 0) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				slashIndex = (slashIndex + (e.key === 'ArrowDown' ? 1 : -1) + slashMatches.length) % slashMatches.length;
				updateSlash();
				return;
			}
			if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				applySlash(slashMatches[slashIndex]);
				return;
			}
			if (e.key === 'Escape') {
				closeSlash();
				return;
			}
		}

		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			send();
			return;
		}

		// 送った文を ↑ で戻す。打ち直しをやめられる
		if (e.key === 'ArrowUp' && input.selectionStart === 0 && history.length > 0) {
			e.preventDefault();
			historyIndex = Math.max(0, historyIndex - 1);
			input.value = history[historyIndex];
			autoGrow();
			return;
		}
		if (e.key === 'ArrowDown' && input.selectionStart === input.value.length && historyIndex < history.length) {
			e.preventDefault();
			historyIndex = Math.min(history.length, historyIndex + 1);
			input.value = historyIndex === history.length ? '' : history[historyIndex];
			autoGrow();
		}
	});

	// 箱のどこを押しても入力に入る（VS Code のチャットと同じ）
	composer.addEventListener('click', (e) => {
		if (e.target === composer) {
			input.focus();
		}
	});

	/*
	 * 一覧を開いているときだけ出る「← 会話へ戻る」（T-345・利用者依頼 2026-08-30）。
	 * 以前は ≡（ハンバーガー）が開閉の両方を兼ねていたが、**閉じているときの ≡ は
	 * 「何が起きるか」を言わない**。列そのものが常に見えるようになった（T-341）いま、
	 * 開く役は面のタイトル（`nimbus.openHome`）に移し、ここは戻るだけを持つ。
	 */
	homeBack.appendChild(icon('back'));
	homeBack.addEventListener('click', () => setHomeOpen(false));
	sendButton.appendChild(icon('send'));
	interruptButton.appendChild(icon('stop'));
	attachButton.appendChild(icon('attach'));
	sendButton.addEventListener('click', send);
	interruptButton.addEventListener('click', () => vscode.postMessage({ type: 'interrupt' }));
	// webview からはファイルダイアログを開けないので、拡張側に開いてもらう。
	// 押しても何も起きないボタンは、見えているだけと同じ（T-244）
	attachButton.addEventListener('click', () => vscode.postMessage({ type: 'attach' }));

	// ───────────────────────── 拡張との往復 ─────────────────────────

	// ───────────────────────── タブ（束）と Home（T-314） ─────────────────────────

	/** 前面（active）のセッションが入っている束。無ければ既定タブ */
	function activeGroupId() {
		for (const group of homeGroups) {
			if (group.sessions.some((tab) => tab.active)) {
				return group.id;
			}
		}
		return 'default';
	}

	/** セッション 1 行の共通部品（丸・記号・番号・名前）。タブ列と同じ材料で描く */
	function sessionRowParts(tab) {
		const parts = document.createDocumentFragment();
		const dot = icon('dot', 'session-tab-dot', 8);
		dot.style.color = `var(--vscode-${tab.color})`;
		parts.appendChild(dot);
		if (tab.symbol) {
			const mark = document.createElement('span');
			mark.className = 'session-tab-mark';
			mark.textContent = tab.symbol;
			mark.style.color = `var(--vscode-${tab.color})`;
			parts.appendChild(mark);
		}
		const number = document.createElement('span');
		number.className = 'session-tab-number';
		number.textContent = String(tab.number ?? '');
		parts.appendChild(number);
		return parts;
	}

	function setHomeOpen(next) {
		homeOpen = next;
		homePanel.hidden = !next;
		// Home と会話は入れ替わりで出す（両方見えると、どちらに打つのか分からない）
		log.hidden = next;
		// 会話を見ているときは出さない。押しても何も起きないボタンを置かない
		homeBack.hidden = !next;
		if (next) {
			renderHome();
		}
		vscode.postMessage({ type: 'homeOpened', open: next });
	}

	/**
	 * 帯は「前回のセッションの案内」（T-318）専用にする（T-338）。
	 *
	 * 以前はここが狭い面の切り替え口（≡ ＋ 前面の名前）で、**タブ列は CSS で隠していた**。
	 * いつも見えていたタブが消え、1 日に何十回の切り替えが想起頼みの ≡ の奥に落ちて、
	 * 「タブを切り替えられない」と報告された。切り替えはタブ列（全幅で出す）に返し、
	 * ≡ は列の先頭に住む。ここに残るのは、前面がまだ無いのに前回のぶんが在るときの言葉だけ
	 */
	function renderHomeBar() {
		const tabs = homeGroups.flatMap((group) => group.sessions);
		const active = tabs.find((tab) => tab.active);
		const dormant = tabs.filter((tab) => tab.resumable);
		homeBar.hidden = Boolean(active) || dormant.length === 0;
		if (homeBar.hidden) {
			return;
		}
		homeBarSession.textContent = '';
		// 前面がまだ無い（開き直した直後・T-318）。前回のぶんが在ることを言葉で出す
		const name = document.createElement('span');
		name.className = 'home-session-name';
		name.textContent = `前回のセッションが ${dormant.length} 本 — ここから続きへ`;
		homeBarSession.appendChild(name);
	}

	/** 広い面の上段（タブ列）と、下段の絞り込み */
	function renderGroupTabs() {
		const shown = viewGroupId ?? activeGroupId();
		groupTabs.hidden = homeGroups.length < 2;
		groupTabs.textContent = '';
		if (!groupTabs.hidden) {
			for (const group of homeGroups) {
				const chip = document.createElement('div');
				chip.setAttribute('role', 'tab');
				chip.tabIndex = 0;
				chip.className = `group-tab${group.id === shown ? ' active' : ''}`;
				chip.title = group.isDefault
					? 'どのタブにも入れていないセッションはここに入ります'
					: `${group.name}\nダブルクリックで名前を変更`;
				chip.setAttribute('aria-selected', group.id === shown ? 'true' : 'false');
				const name = document.createElement('span');
				name.textContent = `${group.name} (${group.sessions.length})`;
				chip.appendChild(name);
				if (!group.isDefault) {
					const close = document.createElement('span');
					close.className = 'group-close';
					close.setAttribute('role', 'button');
					close.title = 'タブを閉じる（中のセッションは「作業」へ戻ります）';
					close.appendChild(icon('close', undefined, 10));
					close.addEventListener('click', (e) => {
						e.stopPropagation();
						vscode.postMessage({ type: 'group', op: 'remove', groupId: group.id });
					});
					chip.appendChild(close);
					chip.addEventListener('dblclick', () =>
						vscode.postMessage({ type: 'group', op: 'rename', groupId: group.id })
					);
				}
				chip.addEventListener('click', () => {
					viewGroupId = group.id;
					renderGroupTabs();
				});
				chip.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						viewGroupId = group.id;
						renderGroupTabs();
					}
				});
				groupTabs.appendChild(chip);
			}
			const add = document.createElement('div');
			add.setAttribute('role', 'button');
			add.tabIndex = 0;
			add.className = 'group-tab';
			add.title = '新しいタブを作る';
			add.textContent = '＋';
			add.addEventListener('click', () => vscode.postMessage({ type: 'group', op: 'create' }));
			groupTabs.appendChild(add);
		}
		// 下段は、選んでいるタブのセッションだけに絞る
		const group = homeGroups.find((entry) => entry.id === shown);
		renderSessionTabs(group ? group.sessions : homeGroups.flatMap((entry) => entry.sessions));
	}

	/** Home（束一覧）。狭い面で ≡ から開く */
	function renderHome() {
		homePanel.textContent = '';
		for (const group of homeGroups) {
			const box = document.createElement('div');
			box.className = 'home-group';

			const header = document.createElement('div');
			header.className = 'home-group-header';
			const title = document.createElement('span');
			title.textContent = `${group.name} (${group.sessions.length})`;
			header.appendChild(title);
			if (!group.isDefault) {
				header.appendChild(
					iconButton('edit', 'タブの名前を変える', () =>
						vscode.postMessage({ type: 'group', op: 'rename', groupId: group.id })
					)
				);
				header.appendChild(
					iconButton('close', 'タブを閉じる（中のセッションは「作業」へ戻ります）', () =>
						vscode.postMessage({ type: 'group', op: 'remove', groupId: group.id })
					)
				);
			}
			box.appendChild(header);

			if (group.sessions.length === 0) {
				// 空でも出す — 作った直後に見えないと「作れたのか」が分からない（T-244）
				const empty = document.createElement('div');
				empty.className = 'home-empty';
				empty.textContent = 'セッションはまだありません';
				box.appendChild(empty);
			}
			for (const tab of group.sessions) {
				// <button> にしない — 中に「移す」ボタンが住むので、入れ子のボタンは
				// ブラウザに外へ追い出される（T-311 のタブと同じ理由）
				const row = document.createElement('div');
				row.setAttribute('role', 'button');
				row.tabIndex = 0;
				row.className = `home-session${tab.active ? ' active' : ''}`;
				row.title = `${tab.number}. ${tab.full ?? tab.title} — ${tab.label}`;
				row.appendChild(sessionRowParts(tab));
				const name = document.createElement('span');
				name.className = 'home-session-name';
				name.textContent = tab.title;
				row.appendChild(name);
				const state = document.createElement('span');
				state.className = 'home-session-state';
				state.textContent = tab.label;
				state.style.color = `var(--vscode-${tab.color})`;
				row.appendChild(state);
				if (!tab.sessionId.startsWith('draft-')) {
					const move = iconButton('move', '別のタブへ移す', (e) => {
						e.stopPropagation();
						vscode.postMessage({ type: 'group', op: 'assign', sessionId: tab.sessionId });
					});
					row.appendChild(move);
				}
				const open = () => {
					vscode.postMessage({ type: 'switchSession', sessionId: tab.sessionId });
					setHomeOpen(false);
				};
				row.addEventListener('click', open);
				row.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						open();
					}
				});
				box.appendChild(row);
			}
			homePanel.appendChild(box);
		}
		const create = document.createElement('button');
		create.type = 'button';
		create.className = 'home-new-group';
		create.textContent = '＋ 新しいタブ';
		create.addEventListener('click', () => vscode.postMessage({ type: 'group', op: 'create' }));
		homePanel.appendChild(create);
	}

	function renderGroups() {
		renderHomeBar();
		renderGroupTabs();
		if (homeOpen) {
			renderHome();
		}
	}

	/**
	 * セッションのタブ（T-269）。ファイルタブと同じ感覚で行き来できるようにする。
	 *
	 * 状態は**色と記号の両方**で出す。色だけだと、色覚の違いとモノクロのスクリーンショットで潰れる。
	 * 並びは拡張側で始めた順に固定してあるので、ここでは並べ替えない
	 * （押そうとした瞬間に動くと押し間違える）。
	 */
	// ───────────────── セッションの列と会話の境目（T-342） ─────────────────

	/** 列に残す最小。これを下回ると一覧として読めない（名前が 2 文字に戻る） */
	const RAIL_MIN = 150;
	/** 会話に残す最小。境目をどこまで引いても、読む場所は残す */
	const CHAT_MIN = 200;

	/**
	 * 境目の太さ。畳んでいる間は `display: none` で 0 になるので、最後に測れた値を覚えておく
	 * （0 を閾値に混ぜると、畳む幅と戻す幅が 4px ずれて、境目のあたりで出たり入ったりする・T-354）
	 */
	let lastSashWidth = 4;
	function railSashWidth() {
		if (!railSash.hidden && railSash.offsetWidth > 0) {
			lastSashWidth = railSash.offsetWidth;
		}
		return lastSashWidth;
	}

	/** 列と会話を左右に分けている器の幅。畳まれている面では 0（＝測れない） */
	function railTotalWidth() {
		const columns = railSash.parentElement;
		return columns ? columns.clientWidth : 0;
	}

	/** いま許される列の幅の範囲。面の広さで変わるので、その都度測る */
	function railBounds() {
		return {
			min: RAIL_MIN,
			max: Math.max(RAIL_MIN, railTotalWidth() - CHAT_MIN - railSashWidth())
		};
	}

	/**
	 * 列の幅を当てる。`undefined` は「決めていない」＝ CSS の `clamp()` に返す。
	 * **必ず範囲へ収める** — 覚えた幅のまま面が狭くなると、会話が消える
	 */
	function applyRailWidth(width) {
		const { min, max } = railBounds();
		// CSS の `clamp()` は面の狭さを知らない（下限 200px で止まる）ので、
		// 「会話に 200px を残した残り」を上限として被せる。これで**列のほうが先に譲る**（T-354）
		sessionTabs.style.maxWidth = `${Math.round(max)}px`;
		if (typeof width !== 'number' || !Number.isFinite(width)) {
			sessionTabs.style.width = '';
			return;
		}
		sessionTabs.style.width = `${Math.round(Math.min(max, Math.max(min, width)))}px`;
	}

	/** 列を出したいか（本数の都合）。出せるか（面の広さ）は `layoutRail()` が決める */
	let railWanted = false;

	/**
	 * 面が狭くて畳んでいるか（T-354）。**本数の都合（`railWanted`）とは別に持つ。**
	 * `sessionTabs.hidden` から理由を逆算すると、「1 本しか無いから畳んだ」と
	 * 「狭いから畳んだ」を見分けられず、片方の条件が変わったときに戻せなくなる。
	 */
	let railCollapsedByWidth = false;

	/**
	 * 畳む幅と戻す幅をずらす（T-354・Codex の指摘 2026-08-31）。
	 * 同じ閾値で出し入れすると、**外側のサッシを境目のあたりで引いたときに 1px ごとに
	 * 列が出たり消えたりする**。16px の遊びを入れて、行き来を 1 回で終わらせる。
	 */
	const RAIL_RESTORE_MARGIN = 16;

	/**
	 * 面の広さに合わせて列を譲らせる（T-354）。順番は **縮める → 畳む**。
	 *
	 * サイドバーの最小幅は 170px しかないので、列 150 ＋ 会話 200 ＋ 境目は物理的に入らない。
	 * 入らない幅で列を立てたままにすると、会話が 0px まで潰れて**読む場所も送る場所も消える**
	 * （実測: サイドバー 185px で 列 200px・会話 0px・送信ボタンの中心が面の外）。
	 * 畳んでも一覧へは面のタイトル（`nimbus.openHome`）から戻れる ＝ 入口は奪わない。
	 * 畳んだことは覚えた幅に混ぜない（`rememberRailWidth` を呼ばない）— 広い面へ戻したときに
	 * 0 幅が復元されると詰む。
	 *
	 * 守りは敵対ケース `nimbus/tests/gui/cases/adv-14-narrow-sidebar.mjs`
	 * （寸法は画面でしか壊れないので、モジュールテストでは掴めない）。
	 */
	function layoutRail() {
		const total = railTotalWidth();
		// 面が畳まれている間は測れない（`clientWidth` が 0）。0 を「狭い」と読むと、
		// 面を戻したときに列が畳まれたまま残る
		const measurable = total > 0;
		if (measurable) {
			// 閾値は魔法数を置かず、**列の下限 ＋ 会話の下限 ＋ 境目**から出す。
			// 戻す側だけ遊びを足す（同じ値で出し入れすると境目で点滅する）
			const collapseAt = RAIL_MIN + CHAT_MIN + railSashWidth();
			if (!railCollapsedByWidth && total < collapseAt) {
				railCollapsedByWidth = true;
			} else if (railCollapsedByWidth && total >= collapseAt + RAIL_RESTORE_MARGIN) {
				railCollapsedByWidth = false;
			}
		}
		// 測れないとき（面が畳まれている）は前の判断を保つ — 0px を「狭い」と読んで畳むと、
		// 面を戻したときに列が畳まれたまま残る
		const show = railWanted && !railCollapsedByWidth;
		sessionTabs.hidden = !show;
		// 境目は列があるときだけ。畳んでいるときに掴めると、掴んだ先に何も無い（T-342）
		railSash.hidden = !show;
		if (!show) {
			// 畳むときは決めた幅を外す — インラインの幅は `[hidden]` の `width: auto` に勝ってしまう
			sessionTabs.style.width = '';
			sessionTabs.style.maxWidth = '';
			return;
		}
		if (measurable) {
			applyRailWidth(savedRailWidth());
		}
	}

	/**
	 * 覚えるのは**面ごと**（`vscode.setState`）。サイドバーと全画面では適切な幅が違うので、
	 * 拡張側の 1 つの設定に寄せると、どちらかが必ず外れる
	 */
	function rememberRailWidth(width) {
		/*
		 * **畳んでいる間の幅は覚えない**（T-354・Codex の指摘 2026-08-31）。
		 * 掴んでいる最中に外側の面が狭まって自動で畳むと、`pointerup` が 0px を保存してしまい、
		 * 広い面へ戻したときに 0 幅が復元されて詰む。覚えるのは**利用者が決めた幅**だけ。
		 */
		if (typeof width === 'number' && (railCollapsedByWidth || sessionTabs.hidden)) {
			return;
		}
		const state = vscode.getState() ?? {};
		if (typeof width === 'number') {
			vscode.setState({ ...state, railWidth: width });
		} else {
			delete state.railWidth;
			vscode.setState(state);
		}
	}

	function savedRailWidth() {
		const width = vscode.getState()?.railWidth;
		return typeof width === 'number' ? width : undefined;
	}

	/**
	 * **打ちかけの本文を覚える**（T-376）。
	 *
	 * 下書きの「タブ」は台帳側で残るようになった（T-368）が、**入力欄に打った文字**は
	 * どこにも保存されていなかった。長い指示を書いている途中でアプリを閉じると、
	 * それだけで消える — 利用者から見れば「開いていたものが消えた」と同じ痛みで、
	 * しかも打ち直すしかない。
	 *
	 * 置き場は `vscode.setState()`（面ごと・レール幅と同じ器）。**送ったら消す**ので、
	 * 残るのは「まだ送っていない文」だけ。
	 */
	function rememberDraftText() {
		const state = vscode.getState() ?? {};
		const text = input.value;
		if (text) {
			vscode.setState({ ...state, draftText: text });
		} else if (state.draftText !== undefined) {
			delete state.draftText;
			vscode.setState(state);
		}
	}

	/** 覚えていた打ちかけを戻す。**既に何か入っていれば触らない**（上書きしない） */
	function restoreDraftText() {
		if (input.value) {
			return;
		}
		const text = vscode.getState()?.draftText;
		if (typeof text === 'string' && text) {
			input.value = text;
			autoGrow();
		}
	}

	let sashFrom = null;

	railSash.addEventListener('pointerdown', (event) => {
		if (event.button !== 0) {
			return;
		}
		sashFrom = { x: event.clientX, width: sessionTabs.getBoundingClientRect().width };
		// 掴んだあとは面の外へ出ても追いかける（境目から外れた瞬間に止まると掴み直しになる）
		railSash.setPointerCapture(event.pointerId);
		railSash.classList.add('dragging');
		document.body.classList.add('rail-dragging');
		// 引いている最中に文字が選ばれないように
		event.preventDefault();
	});

	railSash.addEventListener('pointermove', (event) => {
		if (!sashFrom) {
			return;
		}
		applyRailWidth(sashFrom.width + (event.clientX - sashFrom.x));
	});

	function endSashDrag(event) {
		if (!sashFrom) {
			return;
		}
		sashFrom = null;
		railSash.classList.remove('dragging');
		document.body.classList.remove('rail-dragging');
		if (event && railSash.hasPointerCapture?.(event.pointerId)) {
			railSash.releasePointerCapture(event.pointerId);
		}
		rememberRailWidth(sessionTabs.getBoundingClientRect().width);
	}
	railSash.addEventListener('pointerup', endSashDrag);
	railSash.addEventListener('pointercancel', endSashDrag);

	// エディタのタブと同じで、ダブルクリックは「既定へ戻す」
	railSash.addEventListener('dblclick', () => {
		applyRailWidth(undefined);
		rememberRailWidth(undefined);
	});

	// マウスを使わない人にも動かせる場所を残す（掴み代はマウス専用の入口になりやすい）
	railSash.addEventListener('keydown', (event) => {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
			return;
		}
		event.preventDefault();
		const step = event.shiftKey ? 48 : 16;
		applyRailWidth(sessionTabs.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? -step : step));
		rememberRailWidth(sessionTabs.getBoundingClientRect().width);
	});

	// 面が狭くなったら、覚えた幅のまま押し込まず、その場で入る幅へ収め直す。
	// 縮めても入らない幅では列ごと畳む（T-354）
	window.addEventListener('resize', () => {
		layoutRail();
	});

	// 窓の resize だけでは取りこぼす（面を出し入れしても窓の大きさは変わらない）。
	// **器そのもの**を見て、幅が変わるたびに収め直す（T-354）。
	// 見ているのは親（`.cockpit-columns`）なので、ここで列の幅を変えても呼び戻されない
	if (typeof ResizeObserver === 'function' && railSash.parentElement) {
		new ResizeObserver(() => layoutRail()).observe(railSash.parentElement);
	}

	function renderSessionTabs(tabs) {
		sessionTabs.textContent = '';
		// 「← 会話へ戻る」は列の先頭に住む（T-338 の場所を T-345 が引き継ぐ）。
		// textContent = '' で外れるので、毎回置き直す。同じ要素を移しているだけなので
		// click のリスナーはそのまま生きている
		sessionTabs.appendChild(homeBack);
		// 1 本しか無いときは出さない。切り替える先が無い列は場所を取るだけ
		railWanted = Boolean(tabs) && (tabs.length >= 2 || tabs.some((tab) => tab.resumable));
		// 出す・畳む・幅を収めるの判断は 1 か所（`layoutRail`）に寄せる。
		// 面の広さでも畳むようになったので、本数だけで決められない（T-354）
		layoutRail();
		if (!railWanted) {
			return;
		}
		// 狭くて畳んでいるときも 1 枚ずつは作っておく。面が広がった瞬間に描き直さずに戻せる
		// （畳んでいる間は `.session-tabs[hidden] > :not(.home-back)` が CSS で消している）
		for (const tab of tabs) {
			// <button> ではなく <div role="tab">（T-311 / T-313）。
			// **ボタンの中にボタンや入力欄は置けない**（HTML の決まりで、入れ子の操作は
			// ブラウザが外へ追い出す）。ピンと名前の書き換えを中に住まわせるための構造
			const button = document.createElement('div');
			button.setAttribute('role', 'tab');
			button.tabIndex = 0;
			const draft = tab.sessionId.startsWith('draft-');
			button.className = `session-tab${tab.active ? ' active' : ''}${tab.pinned ? ' pinned' : ''}`;
			// 指を置けば全文が読める（幅が無くても失われない・T-301）。
			// 名前の変えかたはここでしか案内できない（T-313・鉛筆を常設すると幅が無い）
			button.title = `${tab.number}. ${tab.full ?? tab.title} — ${tab.label}${draft ? '' : '\nダブルクリックで名前を変更'}`;
			button.setAttribute('aria-selected', tab.active ? 'true' : 'false');

			// 色つきの丸（T-298 / T-302）。記号だけだと小さくて読み取れないという声が出た。
			// 色はテーマトークンから引く（絵文字だとテーマに従わない）
			const dot = icon('dot', 'session-tab-dot', 8);
			dot.style.color = `var(--vscode-${tab.color})`;
			button.appendChild(dot);

			// 記号の無い状態（あなたの番）はスパンごと置かない — 空でも gap の幅を取る
			if (tab.symbol) {
				const mark = document.createElement('span');
				mark.className = 'session-tab-mark';
				mark.textContent = tab.symbol;
				mark.style.color = `var(--vscode-${tab.color})`;
				button.appendChild(mark);
			}

			// **番号は幅が無くても残す**（T-301）。3 本並ぶと名前に使えるのは 30px ほどで、
			// 先頭から削るとどのタブも同じ書き出しになって見分けがつかない
			const number = document.createElement('span');
			number.className = 'session-tab-number';
			number.textContent = String(tab.number ?? '');
			button.appendChild(number);

			const name = document.createElement('span');
			name.className = 'session-tab-name';
			name.textContent = tab.title;
			button.appendChild(name);

			// **前面のタブには言葉も出す**（T-298）。記号の意味を覚えていなくても読める
			if (tab.active) {
				const word = document.createElement('span');
				word.className = 'session-tab-state';
				word.textContent = tab.label;
				word.style.color = `var(--vscode-${tab.color})`;
				button.appendChild(word);
			}

			// ピン（T-311）。指を置いたときと、留まっているあいだだけ見せる（常設すると幅が無い）
			if (!draft) {
				const pin = document.createElement('span');
				pin.className = 'session-tab-pin';
				pin.setAttribute('role', 'button');
				pin.tabIndex = 0;
				pin.title = tab.pinned ? 'ピン留めを外す' : 'ピン留めする（タブの先頭に残ります）';
				pin.setAttribute('aria-label', pin.title);
				pin.appendChild(icon('pin', 'pin-glyph', 12));
				const toggle = (e) => {
					e.stopPropagation();
					vscode.postMessage({ type: 'togglePin', sessionId: tab.sessionId });
				};
				pin.addEventListener('click', toggle);
				pin.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						toggle(e);
					}
				});
				button.appendChild(pin);
			}

			// ×（T-316）。エディタのタブと同じ作法 — 指を置いたときとアクティブなときに出す
			const close = document.createElement('span');
			close.className = 'session-tab-close';
			close.setAttribute('role', 'button');
			close.tabIndex = 0;
			close.title = draft
				? 'この下書きを閉じる'
				: 'セッションを閉じる（走っていれば止まります。worktree とファイルは残ります）';
			close.setAttribute('aria-label', close.title);
			close.appendChild(icon('close', 'close-glyph', 12));
			const requestClose = (e) => {
				e.stopPropagation();
				vscode.postMessage({ type: 'closeSession', sessionId: tab.sessionId });
			};
			close.addEventListener('click', requestClose);
			close.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					requestClose(e);
				}
			});
			button.appendChild(close);

			const activate = () => {
				if (!tab.active) {
					vscode.postMessage({ type: 'switchSession', sessionId: tab.sessionId });
				}
			};
			button.addEventListener('click', activate);
			// div にしたぶん、キーボードの道は自分で敷く（Enter / Space で切り替え）
			button.addEventListener('keydown', (e) => {
				if ((e.key === 'Enter' || e.key === ' ') && e.target === button) {
					e.preventDefault();
					activate();
				}
			});

			// ダブルクリックで名前を変える（T-313）。名前の場所がそのまま入力欄になる
			if (!draft) {
				button.addEventListener('dblclick', (e) => {
					e.stopPropagation();
					if (button.querySelector('.session-tab-rename')) {
						return;
					}
					const field = document.createElement('input');
					field.type = 'text';
					field.className = 'session-tab-rename';
					field.value = tab.title;
					field.title = '空にして Enter で、自動の見出しへ戻ります';
					field.maxLength = 60;
					let finished = false;
					const finish = (commit) => {
						if (finished) {
							return;
						}
						finished = true;
						if (commit) {
							vscode.postMessage({ type: 'renameSession', sessionId: tab.sessionId, name: field.value });
						}
						field.replaceWith(name);
					};
					field.addEventListener('keydown', (event) => {
						event.stopPropagation();
						if (event.key === 'Enter') {
							finish(true);
						} else if (event.key === 'Escape') {
							finish(false);
						}
					});
					field.addEventListener('blur', () => finish(true));
					field.addEventListener('click', (event) => event.stopPropagation());
					name.replaceWith(field);
					field.focus();
					field.select();
				});
			}
			sessionTabs.appendChild(button);
			// **前面のタブが画面外にいると、どのセッションに居るのか分からない**（T-291）。
			// 実測でサイドバー 299px に対し列は 567px まで伸び、3 本目が右へ隠れていた。
			// 縮められるようにしたうえで、それでも溢れるときは見える位置まで送る
			if (tab.active) {
				requestAnimationFrame(() => button.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
			}
		}
		// 列の右端に「+」（T-290）。ブラウザのタブと同じ位置なので、explain されなくても分かる。
		// **ここだけに置かない** — 列は 2 本以上のときしか出ないので、
		// 面のタイトルにも同じコマンドを出してある（`view/title` / `editor/title`）
		sessionTabs.appendChild(
			iconButton('add', '新しいセッション', () => vscode.postMessage({ type: 'newSession' }), 'session-tab-add')
		);
	}

	/**
	 * 枠の残り（T-282 / T-295）。
	 *
	 * **バー・数字・絵文字の 3 つが同じことを言う。** 色だけ・絵文字だけにすると、
	 * 色覚の違いやモノクロのスクリーンショットで読めなくなる。
	 * 目盛りが取れないときは文字だけに落とす（何も出さないよりは読める）。
	 */
	function renderQuota(message) {
		quotaLine.textContent = '';
		quotaLine.title = message.tooltip ?? '';
		quotaLine.hidden = !message.text;
		if (!message.text) {
			return;
		}
		const gauges = message.gauges ?? [];
		if (gauges.length === 0) {
			quotaLine.textContent = message.text;
			return;
		}
		for (const gauge of gauges) {
			const item = document.createElement('span');
			item.className = `quota-item tone-${gauge.tone}`;

			// 残りの少なさを、テーマの色で塗った丸で（T-302）
			const mark = icon('dot', 'quota-mark', 8);
			item.appendChild(mark);

			const label = document.createElement('span');
			label.textContent = gauge.label;
			item.appendChild(label);

			const track = document.createElement('span');
			track.className = 'quota-bar';
			const fill = document.createElement('i');
			fill.style.width = `${Math.max(0, Math.min(100, gauge.left))}%`;
			track.appendChild(fill);
			item.appendChild(track);

			const value = document.createElement('span');
			value.className = 'quota-value';
			value.textContent = `${gauge.left}%`;
			item.appendChild(value);

			quotaLine.appendChild(item);
		}
	}

	pickPolicy.addEventListener('click', () => vscode.postMessage({ type: 'run', command: 'nimbus.switchPolicy' }));
	pickModel.addEventListener('click', () => vscode.postMessage({ type: 'run', command: 'nimbus.chooseModel' }));
	pickEffort.addEventListener('click', () => vscode.postMessage({ type: 'run', command: 'nimbus.chooseEffort' }));

	/**
	 * 試験からリセットを頼むための口（T-359）。**拡張側が `NIMBUS_SMOKE` のときしか応じない**ので、
	 * 製品では投げても何も起きない（コマンドを 1 つも増やさずに済む）。
	 * ランナーは `frame.evaluate(() => window.__nimbusTest.reset())` で呼び、
	 * **返ってきた報告で「効いたか」を確かめる**。
	 */
	const testResetWaiters = new Map();
	window.__nimbusTest = {
		reset(timeoutMs = 8000) {
			const token = `t${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
			return new Promise((resolve) => {
				testResetWaiters.set(token, resolve);
				setTimeout(() => {
					if (testResetWaiters.delete(token)) {
						resolve({ timedOut: true });
					}
				}, timeoutMs);
				vscode.postMessage({ type: 'requestTestReset', token });
			});
		}
	};

	window.addEventListener('message', (e) => {
		const message = e.data;
		/*
		 * **試験のためのリセット**（T-359）。GUI テストは 1 つの Electron を全ケースで共有するので、
		 * 面に残った状態が次のケースへ持ち越される。実測で「セッションが無いのに `! 許可待ち`」
		 * 「下書きが 3 行」「会話を見ているのに ← が出ている」が起き、**同じバイナリでも
		 * 走らせるたびに 8 件前後落ちていた**（A/B で確認）。
		 *
		 * `history: []` を送るだけでは足りない — あれは `#log` と控えを消すだけで、
		 * **添付・入力欄・Home・レール幅・承認カードは残る**（Codex の指摘 2026-08-31）。
		 *
		 * **必ず ACK を返す。** 返さないと拡張側が「効いたかどうか」を確かめられず、
		 * 「リセットしたつもりで効いていない」まま次のケースへ進んでしまう。
		 * ACK には**残っている数**を載せる — 自己申告と実画面の二重確認ができるように。
		 */
		if (message.type === 'restoreInput') {
			// 巻き戻しが済んでから届く（T-363）。**押した瞬間ではなく、確定してから**戻す
			input.value = message.text ?? '';
			autoGrow();
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
			return;
		}
		if (message.type === 'testResetDone') {
			const resolve = testResetWaiters.get(message.token);
			if (resolve) {
				testResetWaiters.delete(message.token);
				resolve(message.report);
			}
			return;
		}
		if (message.type === 'testReset') {
			try {
				pending.length = 0;
				renderPending();
				input.value = '';
				autoGrow();
				closeSlash();
				setHomeOpen(false);
				log.textContent = '';
				// **空にするだけでは足りない。** 会話が空のときは案内（`.suggestion`）が出ているのが
				// 素の状態で、消しっぱなしだと次のケースが「空のときの候補が出ていない」で落ちる
				// （実測 — ケース 45 がこれで落ちた）。リセットは**素の状態に戻す**ことであって、
				// 全部消すことではない
				showWelcome();
				approvals.textContent = '';
				approvals.hidden = true;
				sessionTabs.textContent = '';
				sessionTabs.appendChild(homeBack);
				railWanted = false;
				railCollapsedByWidth = false;
				sessionTabs.style.width = '';
				sessionTabs.style.maxWidth = '';
				layoutRail();
				// 覚えた幅と打ちかけも捨てる（面ごとに永続するので、消さないと次のケースへ効く）
				const state = vscode.getState() ?? {};
				delete state.railWidth;
				delete state.draftText;
				vscode.setState(state);
			} catch (error) {
				vscode.postMessage({ type: 'testResetAck', token: message.token, error: String(error) });
				return;
			}
			vscode.postMessage({
				type: 'testResetAck',
				token: message.token,
				left: {
					attachments: document.querySelectorAll('.attachment').length,
					approvals: document.querySelectorAll('#approvals > *').length,
					sessionTabs: document.querySelectorAll('.session-tab').length,
					turns: document.querySelectorAll('.turn').length,
					input: input.value.length,
					homeOpen: !homePanel.hidden
				}
			});
			return;
		}
		if (message.type === 'sessionState') {
			// 状態は**記号・丸・言葉・色の 4 つ**で同じことを言う（T-298）。
			// 記号だけ・色だけだと、小さくて読み取れないという声が出た
			sessionState.textContent = '';
			sessionState.hidden = !message.state;
			if (message.state) {
				// **テーマの色で塗った丸**（T-302）。絵文字はテーマに従わず、
				// 他がすべて SVG なのでそこだけ質感が変わる
				const mark = icon('dot', 'state-mark', 8);
				mark.style.color = `var(--vscode-${message.state.color})`;
				sessionState.appendChild(mark);

				const word = document.createElement('span');
				word.textContent = [message.state.symbol, message.state.label].filter(Boolean).join(' ');
				word.style.color = `var(--vscode-${message.state.color})`;
				sessionState.appendChild(word);

				sessionState.title = `このセッションはいま「${message.state.label}」です`;
			}
			return;
		}
		if (message.type === 'runSettings') {
			// 権限モード（T-327・人間工学 E3）。**セッションが無くても出す** —
			// 取り返しのつかない操作の入口（送信）にこそ、いまどの権限かが見えていてほしい
			if (message.policy) {
				pickPolicy.textContent = `権限 ${message.policy.label}`;
				pickPolicy.title = message.policy.detail;
				pickPolicy.hidden = false;
			}
			// 走らせかた（T-291）。セッションが無ければボタンごと消す（押せない口を置かない）
			pickModel.textContent = message.model ?? '';
			pickModel.title = 'このセッションのモデルを変える（次の応答から効きます）';
			pickModel.hidden = !message.model;
			pickEffort.textContent = message.effort ? `思考 ${message.effort}` : '';
			pickEffort.title = 'このセッションの思考量を変える（このセッションの残りに効きます）';
			// エフォートを持たないモデルでは出さない
			pickEffort.hidden = !message.model || !message.canPickEffort;
			return;
		}
		if (message.type === 'quota') {
			// 枠が無い環境・取れなかったときは行ごと消す（空欄を置かない・T-282）
			renderQuota(message);
			return;
		}
		if (message.type === 'sessions') {
			// 束（T-314）が届いていれば 2 段（タブ列＋絞り込み）で描き直す。
			// まだなら従来どおり全部を 1 列に
			if (homeGroups.length > 0) {
				renderGroups();
			} else {
				renderSessionTabs(message.tabs ?? []);
			}
			return;
		}
		if (message.type === 'home') {
			homeGroups = message.groups ?? [];
			// 消えたタブを眺め続けない（選んでいたタブが消えたら前面の束へ戻す）
			if (viewGroupId && !homeGroups.some((group) => group.id === viewGroupId)) {
				viewGroupId = null;
			}
			if (typeof message.open === 'boolean' && message.open !== homeOpen) {
				setHomeOpen(message.open);
			}
			renderGroups();
			return;
		}
		if (message.type === 'history') {
			log.textContent = '';
			toolRows.clear();
			hideWorking();
			for (const event of message.events) {
				renderEvent(event);
			}
			if (!message.session) {
				statusText.textContent = 'セッション未開始';
				setRunning(false);
			}
			showWelcome();
			log.scrollTop = log.scrollHeight;
		} else if (message.type === 'commands') {
			commands = message.items ?? [];
		} else if (message.type === 'readiness') {
			readiness = message.checks ?? [];
			// 開いたまま直したときに、その場で消えるように描き直す
			const welcome = document.getElementById('welcome');
			if (welcome) {
				welcome.remove();
				showWelcome();
			}
		} else if (message.type === 'attachments') {
			for (const item of message.items ?? []) {
				pending.push(item);
			}
			renderPending();
		} else if (message.type === 'approvals') {
			renderApprovals(message.pending ?? [], message.activeSessionId);
		} else if (message.type === 'event') {
			renderEvent(message.event, message.blocks);
			if (message.assumptions && message.assumptions.length > 0) {
				renderAssumptions(message.assumptions);
			}
		}
	});

	setRunning(false);
	showWelcome();
	// 打ちかけていた文を戻す（T-376）。`autoGrow()` より前に入れて、高さも合わせる
	restoreDraftText();
	autoGrow();
	vscode.postMessage({ type: 'ready' });
}());
