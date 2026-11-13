# ARCHITECTURE — Tessera の現状整理

設計レビュー（2026-11-12、`main` = `ded9931` 時点）で読んだコードをもとにした現状のまとめです。
機能ごとの詳しい仕様は `docs/00`〜`13`、完成度は `docs/AUDIT.md` にあります。ここは「全体がどうつながっているか」と「どこが弱いか」だけを書きます。
直す順番は [REFACTOR_PLAN.md](REFACTOR_PLAN.md) を見てください。

## 1. 全体像

```
solver/ (Rust, 依存なし)                    web/ (Next.js 16 静的書き出し, React 19, Tailwind 4)
  engine.rs    n人ベクトル形式 CFR+            src/lib/        ロジック（React に依存しない層）
  preflop.rs   6-max プリフロップ木 + EQR        solution/   プリフロップ解の読込・木の再生
  postflop.rs  HU ポストフロップ(1326コンボ)     postflop/   ポストフロップ解の読込・再生・練習
  icm.rs       ICM プッシュ/フォールド           practice/   出題・採点・間隔反復
  ffi.rs       C ABI（WASM 用）                  analyze/    ハンド履歴の解析
  bin/gen_*    事前計算ツール                    storage/    IndexedDB（Repo）と localStorage
       │                                         sync/       Supabase 同期
       │ 事前計算（ネイティブ）                 src/components/  画面部品
       ▼                                       src/app/         16 ルート（1 ルート = 1 page.tsx）
  out/*.bin ──(web/scripts/pack-solutions.mjs)──▶ web/public/solutions, postflop（gzip 静的ファイル）
       │
       └─ wasm32 ビルド ──▶ web/public/wasm/tessera_solver.wasm ──▶ src/workers/solver.worker.ts（Solve / ICM）
```

- サーバー処理は無い。全部クライアントで動き、Service Worker（`web/public/sw.js`）でオフライン対応。
- 利用者のデータは端末の IndexedDB が正。Supabase は複製（`docs/10`）。
- 規模: Rust 約 5,000 行、TypeScript 約 17,000 行（テスト別で約 4,000 行 + E2E 約 1,900 行）、解データ 16 MB。

## 2. データの流れ

### 2.1 解データ（読み取り専用）

| 種類 | 生成 | 形式 | 読込 |
|------|------|------|------|
| プリフロップ（6-max、20/40/60/100/200bb） | `gen_preflop` | `manifest.json.gz`（木）+ `chunk-N.bin.gz`（169クラス、`TSR1`） | `lib/solution/loader.ts` → `SolutionProvider`（Context） |
| ポストフロップ（3シナリオ × 21フロップ、100bb） | `gen_postflop`（プリフロップ解からレンジを切り出す） | `index.json` + `<scenario>/<n>.bin.gz`（1326コンボ、`TSP1` v2） | `lib/postflop/loader.ts`（Worker で展開） |
| Solve の結果 | ブラウザ内 WASM | `TSP1`（同じ形式） | IndexedDB `solves` |
| エクイティ表 169×169 | `export_equity` | `data/equity169.bin` | `lib/poker/equity.ts`, ICM |

局面の特定方法は **ファイル内の連番** です。プリフロップは DFS 順のノード番号、ポストフロップは `index.json` の `flops` 配列の添字とファイル内ノード番号。

### 2.2 利用者のデータ

| データ | 置き場所 | キー | 同期 |
|--------|----------|------|------|
| 回答記録 `Attempt` | IDB `attempts` | 自動採番。局面は `solution` + `pos`（局面キー）。重複判定は `ts:pos:hand` | 追記 |
| 間隔反復 `SrsItem` | IDB `srs` | `k:<solution>:<pos>:<hand>`（番号を含まない。局面キーの無い古い記録は IDB v4 への更新で消した: REFACTOR_PLAN 1-4） | 新しい方が勝つ |
| 保存レンジ・Solve 結果・取り込みハンド | IDB `ranges` / `solves` / `hands` | id | レンジのみ |
| ICM 練習ログ、保存局面、同期状態 | IDB `meta`（1 キーに配列ごと） | 固定キー | あり |
| 設定 | `localStorage["tessera.settings.v1"]` | – | 全体で新しい方 |

## 3. 層と責務（実際の依存関係）

- `lib/` は基本的に React に依存しない純粋な関数で、テストが厚い（Vitest 32 ファイル）。ここは良い状態。
- `lib/` から `components/`・`app/` への import は無い（型だけの import も）。ESLint の `no-restricted-imports`（`web/eslint.config.mjs`、`src/lib/**` が対象。テストも含む）で禁止している（REFACTOR_PLAN 2-3。それまでは `lib/postflop/link.ts` が `PostSession` の `PostConfig` 型を import していた。今は `lib/postflop/types.ts`）。
- 全体の状態は Context 4 つ（`SettingsProvider` → `SolutionProvider` → `SyncProvider` → `ShellProvider`）。状態管理ライブラリは無い。
- 画面の状態は各 `page.tsx` / セッション部品の `useState` に直接ある。`solve/page.tsx` は 28 個。練習のセッション（プリフロップの `Session.tsx`、ポストフロップの `PostSession.tsx`）は `lib/practice/useDrillSession.ts` の `useReducer`（状態機械は `lib/practice/drill.ts`）に載せた（REFACTOR_PLAN 2-2・2-3。ゲーム固有の部分はアダプター `lib/practice/preflopDrill.ts`・`lib/postflop/drillAdapter.ts`）。
- 保存は `getRepo()` を画面部品から直接呼ぶ（`app/`・`components/` の 12 ファイル）。練習の回答の記録（`Attempt` の組み立て・間隔反復の更新・保存）は `lib/practice/record.ts` の `recordAnswer` 1 か所（REFACTOR_PLAN 2-1）で、`Session.tsx`・`PostSession.tsx` は `practice/page.tsx` から渡された `repo` を使う。ICM の記録（`IcmDrill.tsx`）は別のまま。

## 4. そのまま使える部分

| 部分 | 理由 |
|------|------|
| ソルバー中核（`engine.rs` / `postflop.rs` / `icm.rs`）と検証 | Kuhn・クレアボヤント・プッシュ/フォールド・総当たり一致など、既知の均衡に対するテストがある。今回 `cargo test --release` を実行し 26 件成功 |
| 解データのバイナリ形式（`TSR1` / `TSP1`） | 小さく、遅延読込でき、`validate:data` で全件検証している |
| `lib/practice/grading.ts`・`srs.ts`・`sampler.ts` | 小さく純粋。しきい値が 1 か所 |
| `Repo` インターフェース（`lib/storage/types.ts`）と `MemoryRepo` | 保存先を差し替えられる。テストしやすい |
| `SyncBackend` インターフェースと偽サーバーのテスト | 実装の差し替えができる（ただしカーソルの設計は直す。REFACTOR_PLAN 参照） |
| i18n、デザイントークン、44px・axe・オフラインの E2E | 仕組みとして完成している |
| Analyze のパーサー（ファズ済み） | 入力の頑丈さは十分 |

## 5. 根本的な問題（重要度順）

詳細と直し方は REFACTOR_PLAN。ここは「何が問題か」と根拠のファイルだけ。

### A. 局面の識別子が「生成のたびに変わる連番」（データの根幹）

- 記録・間隔反復・保存局面・ミス帳・Analyze の結果・練習セットがすべて、DFS ノード番号とフロップの配列添字で局面を指している。
  - `lib/practice/srs.ts:60`、`components/postflop/PostSession.tsx:92,259`、`lib/study/links.ts`、`lib/storage/mistakes.ts`
- プリフロップの書き出しは到達確率で枝刈りしてから採番する（`solver/src/preflop.rs` の `export`、`gen_preflop.rs:34` の `--min-reach`）。パラメーターを 1 つ変えて再生成すると番号がずれる。
- 解ファイルに「どの生成物か」を一意に示す ID やハッシュが無い（`manifest.json` の `info` に反復回数などはあるが照合には使っておらず、`pack-solutions.mjs` も版を付けない）。
- 結果: **解を作り直すと、利用者の学習記録が黙って別の局面を指す。** 検出もできない。`docs/07`・`docs/08` が挙げる改善（EQR の調整、フロップ追加、HU/9-max）はどれも再生成を伴うので、これを先に直さないとデータの改善ができない。

### B. ポストフロップの練習記録が同期スキーマに入らない（不具合）

- ポストフロップの `Attempt.hand` はコンボ番号 0〜1325（`PostSession.tsx:261`）。
- `supabase/schema.sql:14` は `check (hand between 0 and 168)`。`attemptToRow`（`lib/sync/types.ts`）は変換しない。
- 実際の Postgres では挿入が失敗し、`syncOnce` はそこで例外になるので、後続（間隔反復・レンジ・設定）も同期されない。偽サーバーは制約を見ないのでテストは通っている。実 Supabase は未検証（`HANDOFF.md`）。

### C. 同期の取得カーソルが端末の時刻

- `pullAttempts` などは `ts >= 前回の最大 ts` で取得する（`lib/sync/supabase.ts:159,173`、`lib/sync/engine.ts`）。`ts` は回答した端末の時計。
- 端末 B がオフラインで回答し、端末 A の同期より後にアップロードすると、A のカーソルより古い `ts` の行は A に届かない。保存局面だけは全件取得でこれを避けているが（`engine.ts` のコメント）、記録・間隔反復・レンジ・ICM ログは同じ問題が残る。

### D. Service Worker のキャッシュが版と結びついていない

- キャッシュ名は手書きの `VERSION`（`sw.js:10`）。上げると解データのキャッシュも全部消える（`sw.js:52`）。開いたフロップ（1 つ 0.15〜0.3 MB）のオフライン分が、アプリを更新するたびに消える。
- 解データは stale-while-revalidate。A の ID が無いので、新しい `manifest` と古い `chunk` が混ざりうる。
- 事前キャッシュするページ一覧も手書き（`sw.js:13`）。ルートを足したら忘れずに足す必要がある。

### E. 練習セッションが 2 つの巨大部品に複製されている

- `Session.tsx`（511 行）と `PostSession.tsx`（479 行）は同じ状態機械（loading → animating → asking → answered → handEnd → summary）、同じタイマー・ヒント・キーボード・保存を別々に持つ。行単位で 179 行が一致。（保存は 2-1 で `recordAnswer` に寄せた。状態機械は 2-2 で `lib/practice/drill.ts`・`useDrillSession.ts` にし、`Session.tsx` はプリフロップのアダプター `lib/practice/preflopDrill.ts` で載せ替えた。`PostSession.tsx` は 2-3 でポストフロップのアダプター `lib/postflop/drillAdapter.ts` に載せ替えた）
- ポストフロップの問題をプリフロップ用の `Question` に合わせるため、1 ハンド分だけの偽の `NodeSolution` を作っている（`lib/postflop/practice.ts` の `barSol`）。（2-3 でやめた。`Question` が `stats`・`weight`・`equity`・`eqr` を直接持つ）
- 新しいドリル（ロードマップのボードテクスチャ当て等）を足すたびに 3 つ目、4 つ目の複製ができる。ICM ドリルとオッズクイズはすでに別実装。

### F. ゲーム形式とシナリオが複数の場所に直書き

- 6-max 前提: `solver/src/preflop.rs:135`（`inv: [f32; 6]`）、`lib/solution/tree.ts:10`（席 4・5 がブラインド）、`lib/practice/preflopDrill.ts`（2-2 で `Session.tsx` から移動）の `[0, 1, 2, 3, 4, 5]`。マニフェストには `players` があるのに使っていない。
- 深度の一覧: `lib/solution/loader.ts:6` の `DEPTHS` と `public/solutions/index.json` の二重管理。`"cash6max-"` の文字列が 6 ファイルに出る。
- ポストフロップのシナリオ: `gen_postflop.rs:27`、`public/postflop/index.json`、`lib/postflop/link.ts:16-18`（投入額 2.5 / 11 の直書きで照合）の 3 か所。プリフロップのサイズを変えると通しプレイの接続が黙って切れる。
- HU・9-max・他のポジション組を足すときに、ここが全部引っかかる。

### G. 画面部品が大きく、状態と保存が混ざっている

- `solve/page.tsx`（570 行、`useState` 28 個）、`analyze/page.tsx`（516 行）、`study/page.tsx`（423 行）。
- `public/solver-worker.js` は型もビルドも通らない手書き JS で、メッセージの型は `lib/solve/client.ts` と手で合わせている。
- 成績・ホーム・同期が毎回 `allAttempts()` で全件を読む（`app/stats/page.tsx:40`、`app/page.tsx:20`、`sync/engine.ts:62`）。記録が数万件になると遅くなる。

### H. 解の品質の上限（コードではなくモデルの問題）

- プリフロップはポストフロップを解かず、手で調整した EQR 係数で代用（`preflop.rs:29-75`、`docs/07` §2・§6）。ポストフロップのレンジはこのプリフロップ解から切り出すので、誤差が引き継がれる。
- ポストフロップはターン 6 枚・リバー 2 枚のサンプル（`docs/08` §3）、レーキなし、ベットサイズ固定。
- 文書も画面も「近似」と明記しており正直だが、「GTO Wizard 相当」という目標との差が一番大きいのはここ。直すかどうかは持ち主の判断（REFACTOR_PLAN の質問 2）。

## 6. このレビューで確認できなかったこと

- **画面の見た目と操作感**。スクリーンショットが無く、この環境では `npm ci` が実行できなかったためビルドもしていない。UI については構造（部品の分け方、ナビの構成）だけを見た。
- **web 側のテスト**（Vitest・Playwright）は実行していない。`HANDOFF.md` の「CI 成功」をそのまま信じている。
- 実 Supabase、実機、スクリーンリーダー、GGPoker の実ファイル（`docs/AUDIT.md` §6 と同じ）。
- `HANDOFF.md` は「PR #3 はドラフトのまま、マージしない」と書いているが、`main` の先頭は PR #3 のマージコミット。HANDOFF の記述が古い。
