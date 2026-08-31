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

	/**
	 * 列に無い状態の札を、寄せ先の列の状態へ書き換えた写しにする（T-351）。
	 *
	 * 拡張ホスト側（`taskStore.load`）でも寄せているが、**描く側でも取りこぼさない**。
	 * ここを通したあとは「札の集合＝列の合計」なので、要約と見えている枚数が食い違わない。
	 * 寄せ先は「まだ手を付けていない」列（無ければ先頭の列）。
	 */
	function placeable(tasks, columns) {
		const known = columns.map((column) => column.state);
		if (known.length === 0) {
			return [];
		}
		const fallback = known.includes('pending') ? 'pending' : known[0];
		// 印は**必ず文字にして**残す。`state` が丸ごと欠けた札を `recoveredFrom: undefined` で
		// 印すると、「印が無い」と見分けが付かず、寄せたことを誰にも知らせないまま置かれる
		return tasks.map((task) =>
			known.includes(task.state) ? task : { ...task, state: fallback, recoveredFrom: String(task.state) }
		);
	}

	function card(task, progress) {
		const el = document.createElement('div');
		el.className = `card ${task.state}`;
		// 寄せたことは、画面を汚さずに触れる場所（ツールチップ）だけで知らせる
		if (task.recoveredFrom !== undefined) {
			el.title = `記録の状態（${String(task.recoveredFrom)}）が読めなかったので、この列に置いています`;
		}

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
		// 数えるのは**描く札**（T-351）。手元の配列をそのまま数えると、列に入れられなかった
		// 札の分だけ数字が水増しされ、「全 3 なのにカードは 1 枚」になる
		const columns = message.columns ?? [];
		const tasks = placeable(message.tasks ?? [], columns);
		const active = tasks.filter((t) => t.state !== 'done').length;
		summary.textContent = tasks.length === 0 ? '' : `進行中 ${active} / 全 ${tasks.length}`;

		if (tasks.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'empty';
			empty.textContent = 'タスクはまだありません。「新しいタスク」から、worktree を切って並列に走らせられます。';
			board.appendChild(empty);
			return;
		}

		for (const column of columns) {
			const inColumn = tasks.filter((t) => t.state === column.state);
			if (inColumn.length === 0) {
				continue;
			}
			const heading = document.createElement('div');
			heading.className = 'column-title';
			heading.textContent = `${column.label}（${inColumn.length}）`;
			board.appendChild(heading);
			for (const task of inColumn) {
				board.appendChild(card(task, (message.progress ?? {})[task.taskId]));
			}
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
