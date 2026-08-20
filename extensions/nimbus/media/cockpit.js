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
	const quotaLine = /** @type {HTMLElement} */ (document.getElementById('quota'));
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
		send: 'M1.7 14.3 14.5 8 1.7 1.7 1.6 6.6 10 8l-8.4 1.4z',
		stop: 'M4 4h8v8H4z',
		attach: 'M9.5 2a3.5 3.5 0 0 1 3.5 3.5v5a2.5 2.5 0 0 1-5 0V6h1.2v4.5a1.3 1.3 0 0 0 2.6 0v-5A2.3 2.3 0 0 0 9.5 3.2 2.3 2.3 0 0 0 7.2 5.5v5.8a3.5 3.5 0 0 0 7 0V6h1.2v5.3a4.7 4.7 0 0 1-9.4 0V5.5A3.5 3.5 0 0 1 9.5 2z',
		copy: 'M4 2h7v2h1V1H3v10h3v-1H4z M6 5h7v10H6z M7 6v8h5V6z',
		insert: 'M8 1v9.2l3.1-3.1.9.9L7.5 12.6 3 8l.9-.9L7 10.2V1zM2 14h12v1H2z',
		newFile: 'M9 1H3v14h10V5zm3 4h-3V2zM7 7h1v2h2v1H8v2H7v-2H5V9h2z',
		terminal: 'M2 3h12v10H2zm1 1v8h10V4zM4.5 6l2 2-2 2 .7.7L7.9 8 5.2 5.3zM8.5 10h3v1h-3z',
		add: 'M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z',
		chevron: 'M6 4l4 4-4 4z',
		check: 'M6.3 12.7 2 8.4l1-1 3.3 3.3L13 4l1 1z',
		error: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.8 11H7.2v-1.6h1.6zm0-2.8H7.2V4h1.6z',
		spinner: 'M8 1.5A6.5 6.5 0 1 0 14.5 8H13A5 5 0 1 1 8 3z',
		close: 'M4.3 3.3 8 7l3.7-3.7.7.7L8.7 7.7l3.7 3.7-.7.7L8 8.4l-3.7 3.7-.7-.7 3.7-3.7-3.7-3.7z',
		user: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1.2c-2.7 0-5 1.4-5 3.1V14h10v-1.7c0-1.7-2.3-3.1-5-3.1z',
		cloud: 'M12.2 13H4.6A3.6 3.6 0 0 1 4.2 6a4.4 4.4 0 0 1 8.3.9 3.1 3.1 0 0 1-.3 6.1z'
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

	function stickToBottom(was) {
		if (was) {
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
		summary.addEventListener('click', () => box.classList.toggle('open'));
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
				plainTurn('user', 'あなた', event.text, 'user');
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
			// 押したら外せる。貼り間違いを送るしかないのは困る
			chip.title = '外す';
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
			const add = (label, decision, secondary) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.textContent = label;
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
		closeSlash();
		autoGrow();
		vscode.postMessage({ type: 'send', text, images });
	}

	input.addEventListener('input', () => {
		autoGrow();
		updateSlash();
	});

	input.addEventListener('paste', (e) => {
		const items = (e.clipboardData && e.clipboardData.files) || [];
		for (const file of items) {
			addFile(file);
		}
	});

	for (const target of [input, document.body]) {
		target.addEventListener('dragover', (e) => e.preventDefault());
		target.addEventListener('drop', (e) => {
			const files = (e.dataTransfer && e.dataTransfer.files) || [];
			if (files.length === 0) {
				return;
			}
			e.preventDefault();
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

	sendButton.appendChild(icon('send'));
	interruptButton.appendChild(icon('stop'));
	attachButton.appendChild(icon('attach'));
	sendButton.addEventListener('click', send);
	interruptButton.addEventListener('click', () => vscode.postMessage({ type: 'interrupt' }));
	// webview からはファイルダイアログを開けないので、拡張側に開いてもらう。
	// 押しても何も起きないボタンは、見えているだけと同じ（T-244）
	attachButton.addEventListener('click', () => vscode.postMessage({ type: 'attach' }));

	// ───────────────────────── 拡張との往復 ─────────────────────────

	/**
	 * セッションのタブ（T-269）。ファイルタブと同じ感覚で行き来できるようにする。
	 *
	 * 状態は**色と記号の両方**で出す。色だけだと、色覚の違いとモノクロのスクリーンショットで潰れる。
	 * 並びは拡張側で始めた順に固定してあるので、ここでは並べ替えない
	 * （押そうとした瞬間に動くと押し間違える）。
	 */
	function renderSessionTabs(tabs) {
		sessionTabs.textContent = '';
		// 1 本しか無いときは出さない。切り替える先が無い列は場所を取るだけ
		sessionTabs.hidden = !tabs || tabs.length < 2;
		if (sessionTabs.hidden) {
			return;
		}
		for (const tab of tabs) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = `session-tab${tab.active ? ' active' : ''}`;
			button.title = `${tab.title} — ${tab.label}`;
			button.setAttribute('aria-current', tab.active ? 'true' : 'false');

			// 色つきの丸（T-298）。記号だけだと小さくて読み取れないという声が出た
			const dot = document.createElement('span');
			dot.className = 'session-tab-dot';
			dot.textContent = tab.mark ?? '';
			button.appendChild(dot);

			const mark = document.createElement('span');
			mark.className = 'session-tab-mark';
			mark.textContent = tab.symbol;
			mark.style.color = `var(--vscode-${tab.color})`;
			button.appendChild(mark);

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

			button.addEventListener('click', () => {
				if (!tab.active) {
					vscode.postMessage({ type: 'switchSession', sessionId: tab.sessionId });
				}
			});
			sessionTabs.appendChild(button);
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

			const mark = document.createElement('span');
			mark.className = 'quota-mark';
			// 絵文字は行の高さを跳ねさせるので、字面の箱を固定する（CSS 側）
			mark.textContent = gauge.mark;
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

	pickModel.addEventListener('click', () => vscode.postMessage({ type: 'run', command: 'nimbus.chooseModel' }));
	pickEffort.addEventListener('click', () => vscode.postMessage({ type: 'run', command: 'nimbus.chooseEffort' }));

	window.addEventListener('message', (e) => {
		const message = e.data;
		if (message.type === 'sessionState') {
			// 状態は**記号・丸・言葉・色の 4 つ**で同じことを言う（T-298）。
			// 記号だけ・色だけだと、小さくて読み取れないという声が出た
			sessionState.textContent = '';
			sessionState.hidden = !message.state;
			if (message.state) {
				const mark = document.createElement('span');
				mark.className = 'state-mark';
				mark.textContent = message.state.mark;
				sessionState.appendChild(mark);

				const word = document.createElement('span');
				word.textContent = `${message.state.symbol} ${message.state.label}`;
				word.style.color = `var(--vscode-${message.state.color})`;
				sessionState.appendChild(word);

				sessionState.title = `このセッションはいま「${message.state.label}」です`;
			}
			return;
		}
		if (message.type === 'runSettings') {
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
			renderSessionTabs(message.tabs ?? []);
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
	autoGrow();
	vscode.postMessage({ type: 'ready' });
}());
