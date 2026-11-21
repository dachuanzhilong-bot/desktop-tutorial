#!/usr/bin/env bash
# 量産の結果（solver/out/postflop-v3）を、確認用の表（g1-summary.tsv）と一緒に 1 つの tar.gz にまとめ、GitHub の Release に
# 上げる（REFACTOR_PLAN 4-5。解データは git に入れない）。そのあと、クラウド側が data-pack ワークフローで梱包して本番用の
# Release を作り、web/data.lock.json と index.json を差し替える PR を出す。
#
#   bash solver/scripts/pc-publish.sh
#
# 環境変数（どれも省略できる）:
#   TAG      Release の名前（既定: pc-postflop-<日時>）
#   FORCE=1  フロップが 63 個そろっていなくても進む
#   NO_PUSH=1  tar.gz を作るまで行い、上げない
#   SRC      結果のディレクトリ（既定: solver/out/postflop-v3）
#
# 上げるのに GitHub のログインが要る。初回は、先に次を実行しておく（ブラウザで認証する）:
#   sudo apt install -y gh   （sudo が使えなければ PowerShell で: wsl -d Ubuntu -u root apt install -y gh）
#   gh auth login            （GitHub.com → HTTPS → Login with a web browser）
#   gh auth setup-git
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
src=${SRC:-solver/out/postflop-v3}
tag=${TAG:-pc-postflop-$(date -u +%Y%m%d-%H%M)}

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

# 生の .bin と小さなファイル（統計・G1・index・表）だけを 1 つの tar.gz に（途中保存は含めない）
out="$root/solver/out/pc-postflop.tar.gz"
mkdir -p "$(dirname "$out")"
(cd "$src" && find . \( -name '*.bin' -o -name '*.json' -o -name '*.tsv' \) -print | sort | tar -czf "$out" -T -)
du -sh "$out"
if [ -n "${NO_PUSH:-}" ]; then
  echo "NO_PUSH=1 のため、上げません。$out を作りました。"
  exit 0
fi
command -v gh > /dev/null || { echo "gh がありません（このファイルの先頭の手順で入れてください）。"; exit 1; }
if gh release create "$tag" "$out" --prerelease --title "$tag" --notes "PC の量産結果（生の .bin、$n フロップ、G1 の表つき）。data-pack ワークフローで梱包する（REFACTOR_PLAN 4-5）。"; then
  echo "送りました: Release $tag。そう伝えてください。"
else
  echo "上げられませんでした。GitHub のログインが要ります（このファイルの先頭の gh auth login）。済んだら、同じコマンドをもう一度。"
  exit 1
fi
