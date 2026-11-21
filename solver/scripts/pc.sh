#!/usr/bin/env bash
# PC で回す仕事を、毎回この 1 行で回す（REFACTOR_PLAN フェーズ 4。Linux / macOS / Windows は WSL2 の中で）。
#
#   bash solver/scripts/pc.sh
#
# やること:
#   1. GitHub の main を取り込む（この PC の main を origin/main に合わせる）
#   2. ビルドし、出荷済みのプリフロップ解（100bb）を展開する（済んでいれば飛ばす）
#   3. solver/scripts/pc-queue.txt の仕事を上から順に流す。済んだ仕事は飛ばす（止めても、同じ 1 行で続きから）
#   4. 結果（ログと小さな JSON。数 KB〜数百 KB）を pc-results/ に集め、ブランチ pc/results に送る
#
# 環境変数（どれも省略できる）: SOLVE_THREADS（既定: nproc）、OUT_DIR（既定: solver/out）、NO_PUSH=1（送らない）
# 送るのに GitHub のログインが要る（pc-publish.sh の先頭の gh auth login。済んでいれば要らない）。
# 長く回すときは: nohup bash solver/scripts/pc.sh > pc.log 2>&1 &   （電源に繋ぎ、スリープしない設定に）
set -u
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root" || exit 1

command -v cargo >/dev/null || { echo "Rust が見つかりません: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; exit 1; }

echo "== main を取り込む"
git fetch -q origin main || { echo "GitHub に繋がりません。ネットワークを確かめて、同じコマンドをもう一度。"; exit 1; }
git checkout -q -B main origin/main || { echo "main に切り替えられません（変更中のファイルがあるかも: git status）。"; exit 1; }
echo "commit $(git rev-parse --short HEAD)"

cd solver || exit 1
threads=${SOLVE_THREADS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}
out_dir=${OUT_DIR:-out}
export THREADS=$threads OUT=$out_dir PRE=$out_dir/pre/cash6max-100bb
mkdir -p "$PRE" "$out_dir/pc-done" "$out_dir/pc-logs"

echo "== ビルド"
cargo build --release --bin gen_postflop --bin measure_exploit || exit 1
if [ -z "$(ls -A "$PRE" 2>/dev/null)" ]; then
  for f in ../web/public/solutions/cash6max-100bb/*.gz; do gzip -dc "$f" > "$PRE/$(basename "$f" .gz)"; done
fi

mem_gb=""
[ -r /proc/meminfo ] && mem_gb=$(awk '/MemAvailable/ { printf "%d", $2 / 1048576 }' /proc/meminfo)
echo "空きメモリ ${mem_gb:-?} GB、スレッド $threads"

echo "== 仕事（scripts/pc-queue.txt）"
failed=0
while IFS=$'\t' read -r name cmd; do
  case "$name" in '' | '#'*) continue ;; esac
  if [ -f "$out_dir/pc-done/$name" ]; then
    echo "-- $name: 済み（飛ばす）"
    continue
  fi
  echo "-- $name: 開始 $(date '+%F %T')"
  log="$out_dir/pc-logs/$name.log"
  # shellcheck disable=SC2086 # the queue's command is a list of words with $THREADS, $OUT, $PRE
  bash -c "$cmd" >> "$log" 2>&1 < /dev/null
  rc=$?
  # gen_postflop: 3 = 目標に届かなかった（結果は書いてある）。0 と 3 を「済み」とする
  if [ "$rc" -eq 0 ] || [ "$rc" -eq 3 ]; then
    echo "$rc" > "$out_dir/pc-done/$name"
    echo "-- $name: 済み（終了コード $rc） $(date '+%F %T')"
  else
    echo "-- $name: 失敗（終了コード $rc）。$log の最後を見てください。ほかの仕事は続けます。"
    failed=1
  fi
done < scripts/pc-queue.txt

echo "== 結果を集める"
cd "$root" || exit 1
dest=pc-results
rm -rf "$dest"
mkdir -p "$dest"
{
  echo "date: $(date -u +%FT%TZ)  commit: $(git rev-parse --short HEAD)"
  echo "CPU: $(lscpu 2>/dev/null | sed -n 's/^Model name: *//p')  nproc: $(nproc 2>/dev/null)  threads: $threads"
  echo "RAM: $(grep MemTotal /proc/meminfo 2>/dev/null)"
} > "$dest/machine.txt"
cp solver/"$out_dir"/pc-logs/*.log "$dest/" 2>/dev/null
for d in solver/"$out_dir"/q/*/; do
  [ -d "$d" ] || continue
  n=$(basename "$d")
  mkdir -p "$dest/$n"
  (cd "$d" && find . \( -name '*.g1.json' -o -name '*.stats.json' -o -name '*.jsonl' -o -name 'index.json' \) -size -2M -exec cp --parents {} "$root/$dest/$n/" \;) 2>/dev/null
done
du -sh "$dest"
if [ -n "${NO_PUSH:-}" ]; then
  echo "NO_PUSH=1 のため送りません。結果は $dest/ にあります。"
  exit "$failed"
fi
git config user.name > /dev/null || git config user.name "pc-run"
git config user.email > /dev/null || git config user.email "pc-run@localhost"
git checkout -q -B pc/results
git add -f "$dest"
git commit -q -m "PC の結果 $(date -u +%FT%TZ)" || echo "（前回と同じ結果）"
if git push -q -f -u origin pc/results; then
  echo "送りました: ブランチ pc/results。そう伝えてください。"
else
  echo "送れませんでした。GitHub のログイン（gh auth login）が要ります。済んだら同じコマンドをもう一度。"
  failed=1
fi
git checkout -q main
exit "$failed"
