// @ts-check
/** 並列タスクの板。描画だけを担当し、状態は拡張ホスト側が持つ。 */
(function () {
	const vscode = acquireVsCodeApi();
	const board = /** @type {HTMLElement} */ (document.getElementById('board'));
	const summary = /** @type {HTMLElement} */ (document.getElementById('summary'));

	document.getElementById('newTask')?.addEventListener('click', () => {
		vscode.postMessage({ type: 'newTask' });
	});

	// 止まっているタスクの点検（T-262）。並列で走らせると、止まったことに誰も気づかない
	document.getElementById('check')?.addEventListener('click', () => {
		vscode.postMessage({ type: 'check' });
	});

	// ラベルの言い換えではなく**押した結果**を書く（T-312）。
	// とくに「完了」が worktree を片付けることは、押す前に知りたい
	const HINTS = {
		start: 'このタスクのセッションを開始します',
		open: 'このタスクの作業フォルダ（worktree）を新しいウィンドウで開きます',
		complete: 'セッションを止めて worktree を片付けます。未コミットの成果は WIP コミットで残ります',
		forget: '一覧から取り除きます。ファイルには触りません'
	};

	function button(label, kind, taskId, secondary) {
		const el = document.createElement('button');
		el.textContent = label;
		el.title = HINTS[kind] ?? '';
		if (secondary) {
			el.className = 'secondary';
		}
		el.addEventListener('click', () => vscode.postMessage({ type: kind, taskId }));
		return el;
	}

	function card(task, progress) {
		const el = document.createElement('div');
		el.className = `card ${task.state}`;

		const title = document.createElement('div');
		title.className = 'title';
		title.textContent = task.title;
		el.appendChild(title);

		const branch = document.createElement('div');
		branch.className = 'branch';
		branch.textContent = task.branch;
		el.appendChild(branch);

		// 直近の進捗（T-261）。止まっているのか進んでいるのかは、これが無いと分からない
		if (progress) {
			const line = document.createElement('div');
			line.className = 'progress';
			line.textContent = progress;
			line.title = progress;
			el.appendChild(line);
		}

		const actions = document.createElement('div');
		actions.className = 'actions';
		if (task.state === 'pending') {
			actions.appendChild(button('開始', 'start', task.taskId));
		}
		if (task.state !== 'done') {
			actions.appendChild(button('worktree を開く', 'open', task.taskId, true));
			actions.appendChild(button('完了', 'complete', task.taskId, true));
		} else {
			actions.appendChild(button('一覧から消す', 'forget', task.taskId, true));
		}
		el.appendChild(actions);
		return el;
	}

	window.addEventListener('message', (e) => {
		const message = e.data;
		if (message.type !== 'tasks') {
			return;
		}
		board.textContent = '';
		const active = message.tasks.filter((t) => t.state !== 'done').length;
		summary.textContent = message.tasks.length === 0 ? '' : `進行中 ${active} / 全 ${message.tasks.length}`;

		if (message.tasks.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'empty';
			empty.textContent = 'タスクはまだありません。「新しいタスク」から、worktree を切って並列に走らせられます。';
			board.appendChild(empty);
			return;
		}

		for (const column of message.columns) {
			const tasks = message.tasks.filter((t) => t.state === column.state);
			if (tasks.length === 0) {
				continue;
			}
			const heading = document.createElement('div');
			heading.className = 'column-title';
			heading.textContent = `${column.label}（${tasks.length}）`;
			board.appendChild(heading);
			for (const task of tasks) {
				board.appendChild(card(task, (message.progress ?? {})[task.taskId]));
			}
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
