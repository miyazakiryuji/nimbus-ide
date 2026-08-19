#!/usr/bin/env bash
#
# 固め直しを直列化する（tasks.md T-276）。
#
# `CLAUDE.md` は「修正したら毎回固める」を求めているのに、出力先（`.build/extensions` /
# `out-vscode` / `../Nimbus-darwin-arm64`）は 1 つしかない。複数のセッションが同時に走ると、
# **相手が消した途中のファイルを踏んで落ちる**（実測: `ENOENT: .build/extensions/pug`）。
# 規約が事故を生む形になっていたので、ここで順番待ちにする。
#
#   bash nimbus/scripts/package-app.sh                    # 順番を待ってから固める
#   bash nimbus/scripts/package-app.sh --copy /tmp/my-app # 固めたあと、自分用の写しを作る
#
# 写しを作っておくと、GUI テスト（`NIMBUS_APP=<写し>`）が、
# 後から始まった別セッションのビルドに壊されない。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCK="${TMPDIR:-/tmp}/nimbus-build.lock"
WAIT_SECONDS="${NIMBUS_BUILD_WAIT:-2400}"
COPY_TO=""
if [ "${1:-}" = "--copy" ]; then
	COPY_TO="${2:?--copy には写しの置き場所が要ります}"
fi

# ロックの外で走っている gulp も待つ（素の `npm run gulp` を叩く人がいるため）
wait_for_stray_gulp() {
	local waited=0
	while pgrep -f "gulp vscode-darwin" | grep -qv "^$$\$"; do
		if [ "$waited" -ge "$WAIT_SECONDS" ]; then
			echo "他のビルドが終わりません（$WAIT_SECONDS 秒）。中止します。" >&2
			exit 1
		fi
		[ $((waited % 30)) -eq 0 ] && echo "  ロックの外で gulp が走っています。待っています… ${waited}s"
		sleep 5
		waited=$((waited + 5))
	done
}

acquire() {
	local waited=0
	# bash 3.2（macOS 既定）では、ループの中の `local` と `set -u` の相性が悪い。先に置く
	local owner=""
	# mkdir は不可分。ロックファイルを「作れたら勝ち」にする
	while ! mkdir "$LOCK" 2>/dev/null; do
		owner="$(cat "$LOCK/pid" 2>/dev/null || true)"
		if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
			echo "  前のビルド（pid ${owner}）はもういないので、ロックを引き取ります"
			rm -rf "$LOCK"
			continue
		fi
		if [ "$waited" -ge "$WAIT_SECONDS" ]; then
			echo "他のセッションのビルドが終わりません（$WAIT_SECONDS 秒）。中止します。" >&2
			exit 1
		fi
		[ $((waited % 30)) -eq 0 ] && echo "  他のセッションがビルド中（pid ${owner:-?}）。待っています… ${waited}s"
		sleep 5
		waited=$((waited + 5))
	done
	echo $$ > "$LOCK/pid"
	trap 'rm -rf "$LOCK"' EXIT
}

cd "$ROOT"
acquire
wait_for_stray_gulp

echo "== 固めます（pid $$）=="
if [ "${NIMBUS_BUILD_DRY:-}" = "1" ]; then
	# 順番待ちの仕掛けだけを確かめるための空回し（ビルドは 2 分かかるので、検査では回さない）
	echo "  （NIMBUS_BUILD_DRY=1 なので、ビルドは回しません）"
	exit 0
fi
PATH="$ROOT/../.toolchain/node-v24.18.0-darwin-arm64/bin:$PATH" env -u NODE_OPTIONS \
	npm run gulp vscode-darwin-arm64

APP="$ROOT/../Nimbus-darwin-arm64/Nimbus.app"
if [ ! -d "$APP" ]; then
	echo "固めたはずのアプリがありません: $APP" >&2
	exit 1
fi

if [ -n "$COPY_TO" ]; then
	echo "== 写しを作ります: $COPY_TO =="
	rm -rf "$COPY_TO"
	mkdir -p "$COPY_TO"
	cp -R "$APP" "$COPY_TO/Nimbus.app"
	echo "  GUI テストは NIMBUS_APP=$COPY_TO/Nimbus.app で走らせてください"
fi

echo "== できました =="
