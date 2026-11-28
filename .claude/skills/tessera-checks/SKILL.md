---
name: tessera-checks
description: Tessera（このリポジトリ）で変更を確かめてから PR にし、マージして公開を確かめるまでの手順。solver/（Rust）や web/（Next.js）を変えたとき、コミット・push・PR・マージの前、「テストを流して」「CI が赤い」「WASM を作り直す」「固定ファイル（fixture）が合わない」「e2e」「Pages のデプロイ」と言われたときは、必ずこのスキルを使う。どの変更にどの確認が要るか、worktree での落とし穴、期待値を変えるときの決まりが書いてある。
---

# Tessera の変更を確かめて出す

CLAUDE.md の「コマンド」「作業のルール」の実務版。確かめた結果（件数・時間）は、PR の本文の「確かめたこと」にそのまま書く。終わったと言う前に、出力を自分の目で見る（`superpowers:verification-before-completion` があれば使う）。

## 何を変えたら、何を流すか

| 変えたもの | 流すもの（目安の時間、4 コアのコンテナ） |
|---|---|
| `web/` 全般（毎回） | `cd web && npm run typecheck && npm run lint && npm test`（1 分。lint は警告 0、`any` 0） |
| 解データ・データの読み方 | `npm run validate:data` |
| 画面の動き | `npm run e2e`（ビルド込み 7〜8 分。基準は 305 通過・7 スキップ） |
| ルーティング・`sw.js` | `npm run e2e:subpath` |
| `solver/`（毎回） | `cargo clippy --release --all-targets -- -D warnings` と `cargo test --release`（4〜5 分） |
| 端末で動くソルバー（`ffi.rs`・`postflop.rs`・`river.rs` など） | 上に加えて `cd web && npm run wasm` で `web/public/wasm/tessera_solver.wasm` を作り直してコミットし、`npm test` |
| 端末のリバーの計算そのもの | 固定ファイルを作り直す: `cd solver && TESSERA_WRITE_FIXTURES=1 cargo test --release v3_e2e_fixture`。WebAssembly の解とバイト一致するかは `postflop.river.test.ts` が見る |
| 端末の速さ | `node web/scripts/bench-river-wasm.mjs --ranges <SRP のレンジ> --iters 1000 --update alt-dcfr`（レンジは `measure_exploit --bench-river ... --ranges-out` で作る） |

長いもの（`cargo test`、`npm run e2e`）は `run_in_background` で流し、待つ間に文書を書く。同時に流すと CPU を取り合って e2e の時間の検査（「CPU 4 倍遅くして 5 秒」）が揺れるので、e2e は単独で流す。

## worktree での落とし穴

- `web/node_modules` は**本物を入れる**（`npm ci --no-audit --no-fund`、20 秒）。親のチェックアウトへのシンボリックリンクだと、`next build`（Turbopack）が「workspace root の外」と言って失敗する。vitest だけならリンクでも動く。
- ポストフロップの解データ（`web/public/postflop/*/*.bin.gz`）は git に無い。`node web/scripts/fetch-data.mjs` で Release から取る（`npm test`・`build` の前に自動で走る）。
- `web/node_modules` は `.git/info/exclude` で無視している。コミットに入れない（`git status` を見てから `git add`）。

## 変えてはいけないもの・決まり

- 既存のテストを弱めない・消さない。期待値を変えるときは、理由をコミット本文に書く（例: 「端末の解き方を変えたため、restartAt 500 → 0」）。
- ソルバーの計算を速くする変更は、古いやり方と regret・strategy sum がビット一致するテストを足す（`assert_river_walk_matches` などの形）。
- `web/public/solutions`・`postflop`・`wasm`・`data` は生成物。手で編集しない。
- 画面の文言は `ja.ts`・`en.ts` の両方に。文言を変えるのは持ち主の確認の後。
- 押せる要素は 44px 以上、色や大きさは `globals.css` のトークン。

## PR からマージ、公開まで

1. ブランチは `claude/...`。コミットの末尾に、会話の指示にある Co-Authored-By と Claude-Session の 2 行。
2. `git push -u origin <branch>` → 下書きの PR（PR テンプレートは無い）→ `subscribe_pr_activity`。
3. CI（`.github/workflows/ci.yml`）は `*.md` だけの変更では走らない（paths-ignore）。走らないときは、そのままマージしてよい。
4. CI が緑なら、下書きを解除して squash でマージ。`merge_pull_request` の `expectedHeadSha` は 40 桁（短い SHA は通らない）。
5. main への push で Pages（`.github/workflows/pages.yml`、build → deploy の 2 ジョブ）が走る。数分後に `actions_list`（`pages.yml`）で `success` を確かめる。失敗したらログを読む（`get_job_logs`）。
