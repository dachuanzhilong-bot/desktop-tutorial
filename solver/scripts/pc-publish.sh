#!/usr/bin/env bash
# REFACTOR_PLAN 3-3-7: 量産の結果（solver/out/postflop-v3）を gzip して、確認用の表（g1-summary.tsv）と一緒に
# GitHub のブランチへ送る。そのあと、クラウド側で差し替え（pack・validate・e2e）を行う。
#
#   bash solver/scripts/pc-publish.sh
#
# 環境変数（どれも省略できる）:
#   BRANCH   送り先のブランチ名（既定: data/3-3-7-postflop-v3）
#   FORCE=1  フロップが 63 個そろっていなくても進む
#   NO_PUSH=1  コミットまで行い、送らない
#   SRC      結果のディレクトリ（既定: solver/out/postflop-v3）
#
# 送るのに GitHub のログインが要る。初回は、先に次を実行しておく（ブラウザで認証する）:
#   sudo apt install -y gh   （sudo が使えなければ PowerShell で: wsl -d Ubuntu -u root apt install -y gh）
#   gh auth login            （GitHub.com → HTTPS → Login with a web browser）
#   gh auth setup-git
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
src=${SRC:-solver/out/postflop-v3}
dest=data-import/postflop-v3
branch=${BRANCH:-data/3-3-7-postflop-v3}

[ -f "$src/index.json" ] || { echo "$src/index.json がありません。pc-run.sh all を先に最後まで回してください。"; exit 1; }
n=$(ls "$src"/*/*.bin 2>/dev/null | wc -l)
echo "書き出し済み: $n フロップ（全部で 63）"
if [ "$n" -ne 63 ] && [ -z "${FORCE:-}" ]; then
  echo "63 個そろっていません。pc-run.sh all の続きを回してください（そろっていなくても送るなら FORCE=1）。"
  exit 1
fi

# 確認用の表: フロップごとの反復数・G1・目標を満たしたか・秒/反復
tsv="$src/g1-summary.tsv"
printf 'scenario\tflop\titerations\tg1Pct\treached\tsecsPerIteration\n' > "$tsv"
for f in $(ls "$src"/*/*.g1.json | sort -V); do
  sc=$(basename "$(dirname "$f")")
  fl=$(basename "$f" .g1.json)
  js=$(cat "$f")
  pick() { echo "$js" | sed -n "s/.*\"$1\":\\([^,}]*\\).*/\\1/p"; }
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$sc" "$fl" "$(pick iterations)" "$(pick g1Pct)" "$(pick reached)" "$(pick secsPerIteration)" >> "$tsv"
done
missed=$(grep -c "	false	" "$tsv" || true)
echo "目標（G1）に届かなかったフロップ: $missed 個"
[ "$missed" -gt 0 ] && grep "	false	" "$tsv"

# gzip して、小さなファイルと一緒に dest へ集める（.bin は raw のまま送ると大きい）
rm -rf "$dest"
mkdir -p "$dest"
for d in "$src"/*/; do
  sc=$(basename "$d")
  mkdir -p "$dest/$sc"
  for b in $(ls "$d"*.bin | sort -V); do gzip -9 -c "$b" > "$dest/$sc/$(basename "$b").gz"; done
  cp "$d"*.stats.json "$d"*.g1.json "$dest/$sc/" 2>/dev/null || true
done
cp "$src/index.json" "$tsv" "$dest/"
du -sh "$dest"

git config user.name > /dev/null || git config user.name "pc-run"
git config user.email > /dev/null || git config user.email "pc-run@localhost"
git checkout -B "$branch"
git add "$dest"
git commit -q -m "3-3-7: 全カードの量産結果（$n フロップ、G1 の表つき）" || echo "（変更なし。前回と同じ結果です）"
if [ -n "${NO_PUSH:-}" ]; then
  echo "NO_PUSH=1 のため、送りません。ブランチ $branch にコミットしました。"
  exit 0
fi
if git push -u origin "$branch"; then
  echo "送りました: ブランチ $branch。そう伝えてください。"
else
  echo "送れませんでした。GitHub のログインが要ります（このファイルの先頭の gh auth login）。済んだら、同じコマンドをもう一度。"
  exit 1
fi
