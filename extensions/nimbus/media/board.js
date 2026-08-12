// @ts-check
/** 並列タスクの板。描画だけを担当し、状態は拡張ホスト側が持つ。 */
(function () {
	const vscode = acquireVsCodeApi();
	const board = /** @type {HTMLElement} */ (document.getElementById('board'));
	const summary = /** @type {HTMLElement} */ (document.getElementById('summary'));

	document.getElementById('newTask')?.addEventListener('click', () => {
		vscode.postMessage({ type: 'newTask' });
	});

	function button(label, kind, taskId, secondary) {
		const el = document.createElement('button');
		el.textContent = label;
		if (secondary) {
			el.className = 'secondary';
		}
		el.addEventListener('click', () => vscode.postMessage({ type: kind, taskId }));
		return el;
	}

	function card(task) {
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
				board.appendChild(card(task));
			}
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
