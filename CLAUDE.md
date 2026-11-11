# Tessera — ポーカー GTO 学習アプリ

テキサスホールデムの GTO を「調べる（Study）・練習する（Practice）・自分のハンドを直す（Analyze）」ためのアプリ。
サーバーなしの静的 PWA。解データは自作ソルバーで事前計算した静的ファイル。

## 最初に読むもの

1. [REFACTOR_PLAN.md](REFACTOR_PLAN.md) — いま進めている作業と順番。**ここに無い作業は始めない。**
2. [ARCHITECTURE.md](ARCHITECTURE.md) — 全体のつながりと既知の弱点。
3. `docs/` — 機能ごとの仕様（`docs/README.md` が目次）。データ形式は `docs/03`、モデルの限界は `docs/07`・`docs/08`。
4. `web/AGENTS.md` — この Next.js は学習データと API が違う。書く前に `web/node_modules/next/dist/docs/` を確認する。

## 構成

| 場所 | 中身 |
|------|------|
| `solver/` | Rust。外部 crate なし（方針。`docs/04`）。CFR+ ソルバー、事前計算ツール（`src/bin/gen_*`）、WASM 用の C ABI（`src/ffi.rs`） |
| `web/src/lib/` | React に依存しないロジック。**`components/` や `app/` を import しない** |
| `web/src/components/`, `web/src/app/` | 画面。1 ルート = `app/<name>/page.tsx` |
| `web/public/solutions`, `postflop`, `wasm`, `data` | 生成物。手で編集しない（`npm run solutions:pack` / `npm run wasm` で作る） |
| `supabase/schema.sql` | 同期用テーブルの正本。冪等に書く |

## コマンド

```bash
cd web
npm run typecheck && npm run lint && npm test   # 毎回
npm run validate:data                            # 解データを触ったら
npm run e2e                                      # 画面の動きを変えたら（ビルド込みで数分）
npm run e2e:subpath                              # ルーティングや sw.js を触ったら

cd solver
cargo clippy --release --all-targets -- -D warnings
cargo test --release                             # 約 2〜3 分
```

## 作業のルール

- **1 回の依頼で REFACTOR_PLAN の 1 ステップだけ。** 完了条件を満たしたらコミットして止まる。
- 計画と違うやり方が必要だと思ったら、実装せずに理由を書いて止まる。
- 既存のテストを弱めない・消さない。期待値を変えるときは理由をコミット本文に書く。
- lint は警告 0、`any` 0、`eslint-disable` を増やさない（増やすなら理由を同じ行に書く。既存の書き方に合わせる）。
- 利用者のデータ（IndexedDB・localStorage・Supabase）の形式を変えるときは、古い形式を読むテストを足す。項目は足すだけにし、既存のキーや意味を変えない。
- 解データを再生成するのは、REFACTOR_PLAN のステップ 1-4 が終わってから。それまで `web/public/solutions`・`postflop` の中身を変えない。
- 画面の文言は `web/src/lib/i18n/ja.ts` と `en.ts` の両方に足す（`i18n.test.ts` がキーの一致と表記を検査する）。
- 押せる要素は 44px 以上（`min-h-tap`）。色や大きさは `globals.css` のトークンを使い、数値を直書きしない（`docs/12`）。
- 他社のツール名・UI・解データを使わない。近似であることは画面と文書に明記する（`docs/README.md` の大原則）。
- 目標は「測れる数字で最高品質」。解の精度に関わる変更は、`docs/QUALITY.md`（REFACTOR_PLAN ステップ 3-0 で作る）の数字で前後を比べる。
- 自分用 + 知り合いに配る程度のアプリ。クラウド同期の作り込みは後回し（REFACTOR_PLAN「後回しにしたもの」）。
- push は作業ブランチだけ。`main` へのマージ、公開、リポジトリ設定の変更は持ち主が行う。

## モデルの使い分け

- 実装: Sonnet。REFACTOR_PLAN のステップを 1 つずつ。
- 設計の見直し: 上位モデル。使うのは、フェーズの区切りのレビュー、計画に無い設計判断、同じ所で 2 回詰まったとき。

## 用語

| 語 | 意味 |
|----|------|
| ハンドクラス | 169 通り（`AKs` など）。番号は `row*13+col`、A=0 |
| コンボ | 1326 通りの具体的な 2 枚。ポストフロップはこちら |
| ノード | 解の木の 1 つの判断局面。番号は生成のたびに変わりうる（REFACTOR_PLAN フェーズ 1 で局面キーに移行中） |
| EV 損失 | 最善のアクションとの EV 差（bb）。採点の基準（`lib/practice/grading.ts`） |
| EQR | エクイティ実現率。プリフロップ解ではモデルの仮定値 |
