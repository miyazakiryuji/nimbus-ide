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

	function send() {
		const text = input.value.trim();
		if (!text) {
			return;
		}
		input.value = '';
		vscode.postMessage({ type: 'send', text });
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
		} else if (message.type === 'event') {
			renderEvent(message.event);
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
