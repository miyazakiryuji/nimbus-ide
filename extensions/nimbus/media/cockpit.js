// @ts-check
/**
 * コックピットの表示層。状態は拡張ホスト側が持つので、ここは受け取ったイベントを描くだけ。
 * innerHTML は使わない（Claude の出力やツール結果をそのまま HTML として解釈させない）。
 */
(function () {
	const vscode = acquireVsCodeApi();

	const log = /** @type {HTMLElement} */ (document.getElementById('log'));
	const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
	const sendButton = /** @type {HTMLButtonElement} */ (document.getElementById('send'));
	const interruptButton = /** @type {HTMLButtonElement} */ (document.getElementById('interrupt'));
	const statusText = /** @type {HTMLElement} */ (document.getElementById('statusText'));
	const statusMeta = /** @type {HTMLElement} */ (document.getElementById('statusMeta'));

	/** ツール実行中の表示を後から結果で上書きするため、tool_use_id → 要素を覚えておく */
	const toolEntries = new Map();
	/** コックピットは Claude、ヘルプはゆあ。表示名だけを差し替える */
	const ASSISTANT = document.body.dataset.assistant || 'Claude';
	let running = false;

	const STATUS_LABEL = {
		'starting': '起動中',
		'running': '実行中',
		'awaiting-input': '入力待ち',
		'interrupted': '中断',
		'completed': '完了',
		'error': 'エラー'
	};

	function atBottom() {
		return log.scrollHeight - log.scrollTop - log.clientHeight < 40;
	}

	function append(kind, who, text) {
		const stick = atBottom();
		const entry = document.createElement('div');
		entry.className = `entry ${kind}`;
		if (who) {
			const label = document.createElement('div');
			label.className = 'who';
			label.textContent = who;
			entry.appendChild(label);
		}
		const body = document.createElement('div');
		body.className = 'body';
		body.textContent = text;
		entry.appendChild(body);
		log.appendChild(entry);
		if (stick) {
			log.scrollTop = log.scrollHeight;
		}
		return body;
	}

	function setRunning(next) {
		running = next;
		interruptButton.disabled = !next;
	}

	function summarizeToolInput(input) {
		if (!input || typeof input !== 'object') {
			return '';
		}
		const candidate = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url;
		if (typeof candidate !== 'string') {
			return '';
		}
		const oneLine = candidate.replace(/\s+/g, ' ').trim();
		return oneLine.length > 300 ? `${oneLine.slice(0, 300)}…` : oneLine;
	}

	function renderEvent(event) {
		switch (event.kind) {
			case 'session-init':
				append('system', null, `セッション開始 · ${event.model} · ${event.cwd}`);
				break;
			case 'user-text':
				append('user', 'あなた', event.text);
				break;
			case 'assistant-text':
				append('assistant', ASSISTANT, event.text);
				break;
			case 'assistant-thinking':
				append('thinking', '思考', event.text);
				break;
			case 'tool-use': {
				const summary = summarizeToolInput(event.input);
				const body = append('tool', null, summary ? `${event.toolName} · ${summary}` : event.toolName);
				toolEntries.set(event.toolUseId, body);
				break;
			}
			case 'tool-result': {
				const body = toolEntries.get(event.toolUseId);
				const preview = event.preview.length > 400 ? `${event.preview.slice(0, 400)}…` : event.preview;
				if (body) {
					body.textContent = `${body.textContent}\n${event.isError ? '✖ ' : '✔ '}${preview}`;
					if (event.isError) {
						body.parentElement?.classList.add('error');
					}
				} else {
					append(event.isError ? 'error' : 'tool', null, preview);
				}
				break;
			}
			case 'turn-result': {
				const cost = typeof event.totalCostUsd === 'number' ? ` · 累計 $${event.totalCostUsd.toFixed(4)}` : '';
				statusMeta.textContent = `${event.numTurns} ターン · ${(event.durationMs / 1000).toFixed(1)}s${cost}`;
				break;
			}
			case 'status':
				statusText.textContent = STATUS_LABEL[event.status] ?? event.status;
				setRunning(event.status === 'running' || event.status === 'starting');
				break;
			case 'session-error':
				append('error', 'エラー', event.message);
				break;
		}
	}

	/** 置かれた仮定を、本文とは別に目立たせて並べる（違っていたら早く気づけるように） */
	function renderAssumptions(assumptions) {
		const stick = atBottom();
		const entry = document.createElement('div');
		entry.className = 'entry assumption';
		const label = document.createElement('div');
		label.className = 'who';
		label.textContent = '置いた仮定';
		entry.appendChild(label);
		const list = document.createElement('ul');
		list.className = 'assumption-list';
		for (const text of assumptions) {
			const item = document.createElement('li');
			item.textContent = text;
			list.appendChild(item);
		}
		entry.appendChild(list);
		log.appendChild(entry);
		if (stick) {
			log.scrollTop = log.scrollHeight;
		}
	}

	/**
	 * 貼り付け・ドロップで受けた画像（T-040）。
	 * 送るまで溜めておき、送信と一緒に拡張へ渡す。
	 */
	const pending = [];

	function renderPending() {
		let bar = document.getElementById('attachments');
		if (!bar) {
			bar = document.createElement('div');
			bar.id = 'attachments';
			bar.className = 'attachments';
			input.parentElement.insertBefore(bar, input);
		}
		bar.textContent = '';
		bar.hidden = pending.length === 0;
		pending.forEach((item, index) => {
			const chip = document.createElement('button');
			chip.className = 'attachment';
			chip.type = 'button';
			// 押したら外せる。貼り間違いを送るしかないのは困る
			chip.title = '外す';
			chip.textContent = `🖼 ${item.name} ✕`;
			chip.addEventListener('click', () => {
				pending.splice(index, 1);
				renderPending();
			});
			bar.appendChild(chip);
		});
	}

	/**
	 * いま答えを待っている承認（T-266）。
	 *
	 * **読んでいる場所と決める場所を同じにする。** 別の一覧へ目を移して、
	 * どのツールの話だったか思い出して、戻ってくる — その往復が要らなくなる。
	 * 入力欄のすぐ上に置くのは、手がもう そこにあるから（人間工学 E2）。
	 */
	function renderApprovals(items) {
		let area = document.getElementById('approvals');
		if (!area) {
			area = document.createElement('div');
			area.id = 'approvals';
			area.className = 'approvals';
			input.parentElement.insertBefore(area, input);
		}
		area.textContent = '';
		area.hidden = items.length === 0;
		for (const item of items) {
			const card = document.createElement('div');
			card.className = `approval risk-${item.risk}`;

			const title = document.createElement('div');
			title.className = 'approval-title';
			title.textContent = `${item.toolName} を実行してよいか待っています`;
			card.appendChild(title);

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
					area.hidden = area.childElementCount === 0;
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
			area.appendChild(card);
		}
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

	function send() {
		const text = input.value.trim();
		// 画像だけでも送れるようにする（「これ見て」で通じる場面がある）
		if (!text && pending.length === 0) {
			return;
		}
		const images = pending.splice(0, pending.length);
		renderPending();
		input.value = '';
		vscode.postMessage({ type: 'send', text, images });
	}

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

	sendButton.addEventListener('click', send);
	interruptButton.addEventListener('click', () => vscode.postMessage({ type: 'interrupt' }));
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			send();
		}
	});

	window.addEventListener('message', (e) => {
		const message = e.data;
		if (message.type === 'history') {
			log.textContent = '';
			toolEntries.clear();
			for (const event of message.events) {
				renderEvent(event);
			}
			if (!message.session) {
				statusText.textContent = 'セッション未開始';
				setRunning(false);
			}
			log.scrollTop = log.scrollHeight;
		} else if (message.type === 'approvals') {
			renderApprovals(message.pending ?? []);
		} else if (message.type === 'event') {
			renderEvent(message.event);
			if (message.assumptions && message.assumptions.length > 0) {
				renderAssumptions(message.assumptions);
			}
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
