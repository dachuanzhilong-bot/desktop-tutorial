# REFACTOR_PLAN — 直す順番と完了条件

[ARCHITECTURE.md](ARCHITECTURE.md) §5 の問題 A〜H を、実装担当（Sonnet）が 1 ステップずつ単独で進められる大きさに分けた計画です。

## 結論

- **作り直しは不要です。** ソルバー、解データの形式、`lib/` のロジック、テスト基盤はそのまま使えます。
- 直すべき根幹は 3 つです。
  1. **局面の識別子**（A）。解を再生成すると学習記録が壊れる。データを改善する前に必ず直す。
  2. **同期の不具合と設計**（B・C）。実 Supabase につなぐと失敗する。
  3. **練習セッションの重複**（E）。新しいドリルを足す前に共通化する。
- 新機能（`HANDOFF.md` の「ボードテクスチャ当てドリル」、HU/9-max、フロップ追加）は、フェーズ 1 と 2 が終わるまで止めることを勧めます。

## 持ち主の方針（2026-11-12 に確認）

| 項目 | 回答 | 計画への反映 |
|------|------|--------------|
| 使い方 | 自分用。知り合いに配る程度 | クラウド同期の作り込み（0-2、1-5）は「後回し」に移した。0-1 だけは小さいので直す |
| 残したい学習記録 | 無い | 既存記録の移行はしない。ステップ 1-4 は「古い形式の記録を消す」に単純化 |
| 解の品質 | 最高品質まで上げたい | フェーズ 3 を「測る → 上げる」の具体的なステップにした。**フェーズ 1 の直後に 3-0（物差し作り）を始めてよい** |

実行順: 0-1 → 0-3 → フェーズ 1（1-1〜1-4、1-6） → 3-0 → フェーズ 2 → フェーズ 3 の残り。

## 進め方のルール

- 1 回の依頼 = 1 ステップ。完了条件を満たしたらコミットして止まる。次のステップに進まない。
- 各ステップの共通の完了条件: `cd web && npm run typecheck && npm run lint && npm test` が成功。Rust を触ったら `cd solver && cargo clippy --release --all-targets -- -D warnings && cargo test --release`。画面の動きを変えたら `npm run e2e` も。
- 既存のテストは弱めない。期待値を変えるときは理由をコミット本文に書く。
- 保存形式を変えるステップは、古い形式のデータを読むテストを必ず足す（`e2e/migration.spec.ts`、`storage.local.test.ts` と同じ流儀）。
- 迷ったら推測で進めず、質問を `HANDOFF.md` の「未確認のこと」に書いて止まる。

---

## フェーズ 0: 不具合（すぐ直す。互いに独立）

### ステップ 0-1: ポストフロップ記録が同期できるようにする（問題 B）

- 変更: `supabase/schema.sql` の `attempts.hand` の制約を `between 0 and 1325` に広げる（既存テーブル向けに `alter table … drop constraint / add constraint` も冪等に書く）。`docs/02-data-model.md` の SQL も合わせる。
- 変更: 偽サーバー（Vitest の in-memory 実装と `e2e/sync.spec.ts` の偽 PostgREST）に、`schema.sql` と同じ `check` 制約（`hand`・`seat`・`mode`・`grade`・`score`・`ev_loss`）を持たせ、違反した行を含むバッチは 400 を返す。
- 完了条件:
  - 新しいテスト「`mode: "postSpot"`, `hand: 1325` の記録が push → 別端末で pull できる」が通る。
  - 制約を元の `168` に戻すとそのテストが落ちることを確認してから戻す（コミット本文に書く）。

### ステップ 0-2（後回し）: 1 行の失敗で同期全体を止めない（問題 B の再発防止）

- 変更: `lib/sync/engine.ts` の `syncOnce` を、種類ごと（記録 / 間隔反復 / レンジ / ICM / 保存局面 / 設定）に `try` で分け、失敗した種類を `SyncReport.errors: { kind, message }[]` に入れて残りを続ける。カーソルは成功した種類だけ進める。
- 変更: 設定画面（`components/sync/SyncPanel.tsx`）に、失敗した種類を 1 行で出す（日英）。
- 完了条件: 「記録の push が 400 でも、間隔反復と設定は同期される」「次回の同期で記録が再送される」テストが通る。

### ステップ 0-3: 出題リストのシャッフルを正しくする

- 変更: `components/practice/Session.tsx:90` の `sort(() => rnd() - 0.5)` を Fisher–Yates に置き換える（`lib/util/rng.ts` に `shuffle` を足す）。
- 完了条件: `shuffle` の単体テスト（全要素が残る、固定の乱数列で決まった順になる）。

---

## フェーズ 1: データの土台（問題 A・C・D）

順番どおりに進める。1-1 と 1-2 が終わるまで、解データを再生成しない。

### ステップ 1-1: 解データにビルド ID を付ける

- 変更: `web/scripts/pack-solutions.mjs` と `merge-postflop.mjs` が、各解（プリフロップは深度ごと、ポストフロップはシナリオ × フロップごと）の中身から SHA-256 の先頭 12 桁を計算し、`public/solutions/index.json` と `public/postflop/index.json` に `build` として書く。
- 変更: `lib/solution/loader.ts` と `lib/postflop/loader.ts` が、ファイルを `?b=<build>` 付きで取得する。`SolutionStore` と `PfFlop` に `build` を持たせる。
- 変更: `data.validate.test.ts` に「index の `build` が実ファイルのハッシュと一致する」を足す。
- Rust とバイナリ形式は変えない。再計算も不要（梱包し直すだけ）。
- 完了条件: 上のテスト。`npm run e2e` のオフライン系が通る（`sw.js` は URL のクエリ込みでキャッシュするので、古い `chunk` と新しい `manifest` が混ざらなくなる）。

### ステップ 1-2: 安定した局面キーを作る（保存形式はまだ変えない）

- 新規: `lib/solution/positionKey.ts`
  - `preflopKey(m: Manifest, nodeId): string` … ルートからのアクション列。例 `F-F-R2.5-F-F-C`（種類の頭文字 + レイズ/オールインは総額）。`lib/solution/tree.ts` の `history` から作る。
  - `resolvePreflopKey(m, key): number | null` … キーから現在の番号を引く。無ければ `null`。
- 新規: `lib/postflop/positionKey.ts`
  - フロップは添字ではなくボード文字列（`"As7d2c"`）。ノードはアクションとカードの列（例 `X-B1.75-C/Td/X-X/2c/B4.25`）。`lib/postflop/replay.ts` の経路から作る。
  - `resolvePostflopKey(flop, key): number | null`
- 完了条件:
  - 出荷している全解（5 深度の全ノード、63 フロップの全ノード）で「キー → 番号 → キー」が一致し、キーが解の中で重複しないテスト。
  - まだどの画面も保存形式も変えていない（差分は新規ファイルとテストだけ）。

### ステップ 1-3: 新しい記録に局面キーとビルド ID を持たせる

- 変更: `Attempt` に `pos?: string`（1-2 のキー）と `build?: string` を追加（`lib/storage/types.ts`）。`SrsItem` にも `pos?` と `solution?`。`Session.tsx`・`PostSession.tsx`・`lib/analyze/match.ts` の記録箇所で埋める。
- 変更: 新しく作る `SrsItem` の主キーは `k:<solution>:<pos>:<hand>` にする（番号を含めない）。既存の項目は今のキーのまま更新する。出題時の検索（`practice/sampler.ts`、`lib/postflop/practice.ts`）は、キー文字列ではなく `(solution, pos, hand)` で引く Map を使い、`pos` の無い古い項目だけ従来のキーで引く。
- 変更: 既存の読み手（`lib/storage/mistakes.ts`、`lib/storage/stats.ts`、`lib/study/links.ts`、`practice/sampler.ts` の SRS 参照）は、`pos` があれば `pos` を現在の解で引き直し、無ければ従来どおり `nodeId` を使う。引けなかった記録は集計には数えるが、リンクは出さない。
- 変更: `supabase/schema.sql` の `attempts` と `srs_items` に `pos text`、`build text` を追加（null 可）。`lib/sync/types.ts` の行変換も。
- IndexedDB の版は上げない（項目を足すだけ）。
- 完了条件:
  - 新しい記録に `pos` と `build` が入る単体テスト。
  - 「ノード番号をずらした偽のマニフェストに差し替えても、`pos` 付きの記録は同じ局面のリンクになる」テスト。
  - 既存の移行 E2E（`migration.spec.ts`）がそのまま通る。

### ステップ 1-4: 古い形式の記録を消す（移行はしない）

- 前提: 持ち主は既存の学習記録を残さなくてよい。変換コードは書かない。
- 変更: IndexedDB を v4 に上げ、アップグレード時に `pos` の無い `attempts`・`srs`・取り込みハンド（`hands`）と、`meta` の保存局面・削除墓標・同期状態を消す。保存レンジ・Solve 結果・設定は残す。
- 変更: 1-3 で残した「`pos` が無ければ `nodeId` を使う」分岐を消し、`Attempt.pos`・`SrsItem.pos` を必須にする。`lib/practice/srs.ts:60` の `srsKey`（100bb だけ特別扱い）も消す。保存局面の `href` は番号（`n=`）ではなく局面キー（`p=`）にし、`lib/study/links.ts` と Study 画面のハッシュ読み取りを合わせる。
- 完了条件: v3 のデータを入れた状態から起動する E2E で、古い記録が消え、保存レンジと設定が残る。`grep -rn "nodeId" web/src/lib/storage web/src/lib/study` が、局面キーから引き直した後の一時的な値以外で 0 件。

### ステップ 1-5（後回し）: 同期の取得カーソルをサーバー側の値にする（問題 C）

- 変更: `supabase/schema.sql` の `attempts`・`srs_items`・`range_presets`・`icm_drill_log` に `seq bigint generated always as identity`（`attempts` は既存の `id` を使う）を足し、`srs_items`・`range_presets` は更新時にも進むよう `before update` トリガーで `seq` を振り直す。
- 変更: `SyncBackend` の `pull*` を `sinceSeq: number` に変え、`SyncState` のカーソルも `seq` にする。古い `SyncState`（時刻カーソル）を読んだら 0 から取り直す（重複は既存の重複排除で落ちる）。
- 完了条件: 「端末 B が古い `ts` の記録を、端末 A の同期より後に push しても、A の次の同期で届く」テスト（記録・間隔反復・レンジ・ICM の 4 種類）。

### ステップ 1-6: Service Worker のキャッシュを分ける（問題 D）

- 変更: `sw.js` のキャッシュを `tessera-core-<VERSION>`（アプリ本体）と `tessera-data`（解データ。版なし）に分ける。解データは 1-1 の `?b=` 付き URL で cache-first にし、`index.json` だけ network-first。activate 時に「現在の `index.json` に無い `build` のエントリ」だけ消す。
- 変更: 事前キャッシュするページ一覧を、ビルド時に `scripts/prepare-static-export.mjs` が `out/` から作って `sw.js` に埋め込む（手書きの `PAGES` をやめる）。
- 完了条件: E2E「フロップを 1 つ開く → SW を新しい版に更新 → オフラインで同じフロップが開ける」。新しいルートを足しても `sw.js` を手で直さずにオフラインで開ける（テストは `out/` の全ページを巡回）。

---

## フェーズ 2: 構造（問題 E・F・G）

### ステップ 2-1: 回答の記録を 1 か所にまとめる

- 新規: `lib/practice/record.ts` に `recordAnswer(repo, input): Promise<SrsItem>`。`Attempt` の組み立て、SRS の更新、保存をここで行う。
- 変更: `Session.tsx` と `PostSession.tsx` の保存部分をこれに置き換える。`getRepo()` の直接呼び出しを両ファイルから消す。
- 完了条件: `recordAnswer` の単体テスト（`MemoryRepo` で、プリフロップ / ポストフロップそれぞれの `Attempt` と SRS が今と同じ値になる）。既存 E2E がそのまま通る。

### ステップ 2-2: セッションの状態機械を共通のフックにする

- 新規: `lib/practice/useDrillSession.ts`。`useReducer` で `phase`・`shown`・`answer`・`results`・`pane`・ヒント・タイマー・キーボードを持つ。ゲーム固有の部分は引数のアダプターで渡す:
  ```ts
  interface DrillAdapter<Round, Step> {
    start(): Promise<Round | null>;                       // 次の問題（無ければ null → "empty"）
    steps(round: Round): Step[];                          // アニメーションする手順
    question(round: Round): Question | null;
    answer(round: Round, choice: number): AnswerOutcome;  // 採点と次の状態
    next(round: Round, outcome: AnswerOutcome): Promise<Round | null>; // 同じハンドの続き
    shortcuts(round: Round): Record<string, number>;      // キー → アクション番号
  }
  ```
- この段階では `Session.tsx` だけを載せ替える。
- 完了条件: reducer の単体テスト（各フェーズの遷移、時間切れ、ヒントで得点半分）。`Session.tsx` が 250 行以下。`e2e/app.spec.ts`・`ergonomics.spec.ts`・キーボードのテストが変更なしで通る。

### ステップ 2-3: `PostSession.tsx` を同じフックに載せる

- 変更: ポストフロップ用のアダプターを `lib/postflop/drillAdapter.ts` に置き、`PostSession.tsx` は表示だけにする。`lib/postflop/practice.ts` の `barSol`（1 ハンドだけの偽の `NodeSolution`）をやめ、`Question` に「このハンドの頻度と EV」を直接持たせる（`ResultPanel` 側も合わせる）。
- 変更: `PostConfig` 型を `lib/postflop/types.ts` に移し、`lib/postflop/link.ts` が `components/` を import しないようにする。ESLint に「`src/lib` から `@/components`・`@/app` を import 禁止」のルール（`no-restricted-imports`）を足す。
- 完了条件: `PostSession.tsx` が 250 行以下。`e2e/postflop.spec.ts` が変更なしで通る。lint ルールが有効（わざと違反させると落ちることを確認）。

### ステップ 2-4: 解の一覧とシナリオを 1 か所にする（問題 F の前半）

- 変更: `lib/solution/loader.ts` の `DEPTHS`・`solutionId`・`depthOf` を、`public/solutions/index.json`（ビルドに含める。`lib/postflop/loader.ts` の `PF_INDEX` と同じやり方）から作る `SOLUTIONS` カタログに置き換える。`index.json` の各解に `{ id, game: "cash", players: 6, stack }` を足す（`pack-solutions.mjs` がマニフェストから書く）。`"cash6max-"` の正規表現（`lib/storage/mistakes.ts` ほか 5 か所）をカタログ参照に変える。
- 変更: `public/postflop/index.json` の各シナリオに、接続条件 `{ pre: { stack: 100, oopSeat, ipSeat, oopPath, ipPath } }` を足す（値は `solver/src/bin/gen_postflop.rs:27-31` の `SCENARIOS` と同じ。`gen_postflop.rs` の出力にも足し、今ある `index.json` は手で 1 回だけ更新する。再計算はしない）。`lib/postflop/link.ts` は、投入額の直書き（2.5 / 11）ではなく、1-2 の局面キーと `oopPath`/`ipPath` の一致で判定する。
- 完了条件: `link.ts` に数値の直書きが無い。テスト「全シナリオについて、プリフロップ解でそのラインをたどると `postflopLink` がそのシナリオを返す」。`grep -rn "cash6max" web/src --include=*.ts --include=*.tsx` がテストとカタログ以外で 0 件。

### ステップ 2-5: 席の数をマニフェストから取る（問題 F の後半、web 側のみ）

- 変更: `lib/solution/tree.ts` の `initialState`・`SEATS`・`SB_SEAT`・`BB_SEAT`、`Session.tsx` の `[0,1,2,3,4,5]`、`PokerTable` の席配置を、`manifest.players` の長さと「後ろ 2 席がブラインド（2 人のときは SB=BTN）」から求める。`lib/analyze/match.ts` の `POSTFLOP_ORDER` も同様。
- Rust 側（`preflop.rs` の `[f32; 6]`）は触らない。HU/9-max の解を実際に作ると決めたときに別ステップで行う（質問 3）。
- 完了条件: 2 人と 9 人の小さな偽マニフェストで `stateAt`・`spotType`・`PokerTable` が正しく動く単体テスト。既存の 6-max のテストと E2E が変更なしで通る。

### ステップ 2-6: Solve 画面を分ける（問題 G）

- 変更: `app/solve/page.tsx` を、入力（`useSolveForm`: ボード・レンジ・ポット・サイズ・精度。下書き保存込み）、実行（`useSolveRun`: フェーズ・進捗・結果・ロック）、保存一覧の 3 つのフックと表示部品に分ける。状態は `useReducer`。
- 変更: `public/solver-worker.js` を `src/workers/solver.worker.ts` に移し、メッセージ型を `lib/solve/protocol.ts` で `lib/solve/client.ts` と共有する（`flop.worker.ts` と同じ読み込み方）。`sw.js` の事前キャッシュ対象も合わせる。
- 完了条件: `page.tsx` が 200 行以下、`useState` が 5 個以下。`e2e/solve.spec.ts`・`icm.spec.ts`・オフラインのテストが通る。`solve.wasm.test.ts` が新しい worker の型でビルドできる。

### ステップ 2-7: 記録の全件読みをやめる（問題 G）

- 変更: `Repo` に `attemptsSince(ts)` と `attemptsAfterId(id)` を足す（IDB は既存の `ts` インデックスと主キーの範囲読み）。ホーム（直近だけ）と同期（未送信だけ）をこれに変える。
- 変更: 成績画面は、日ごと・スポットごとの集計を `meta["stats.daily.v1"]` に持ち、`recordAnswer`（2-1）で差分更新する。無ければ全件から 1 回作る。
- 完了条件: 5 万件の記録を入れた `MemoryRepo`/IDB で、ホームと成績の表示までの時間が 1 万件のときの 2 倍以内（Vitest で計測）。集計が全件から作り直した値と一致するテスト。

---

## フェーズ 3: 解の品質を上げる（問題 H）

### 目標の決め方

「100%」をそのまま目標にはできません。ノーリミットホールデムの完全な均衡は誰にも計算できず、どのソルバーの解も「決めたベットサイズの中での均衡」に、ある誤差まで近づけたものです。そこで目標を、測れる数字に置き換えます。

| 物差し | いま | 目標 |
|--------|------|------|
| ポストフロップの exploitability（**全カードで**測ったもの。ポット比） | 未計測。出荷値 0.14〜0.94% はサンプルした 12 通りのランアウトの中での値（`docs/08` §3・§5） | 全フロップで 0.3% 以下 |
| ターン/リバーのカード | ターン 6 枚・リバー 2 枚のサンプル | 全カード |
| プリフロップの終端の価値 | 手で調整した EQR 係数（`docs/07` §2） | ポストフロップの実解から求めた値 |
| レーキ | なし | 設定できる（なし / 一般的なオンラインの率） |
| ベットサイズ | フロップ 2、ターン 1、リバー 2 | 各ストリート 3 以上 + オーバーベット |
| 範囲 | 3 シナリオ × 21 フロップ、100bb | 主要なポジション組すべて × 代表フロップ 100 前後 |

「画面の近似表示（`ApproxNote`）を外せるか」は、3-0 の物差しで上の目標を満たしたかで決めます。

### ステップ 3-0: 本当の誤差を測る（フェーズ 1 の直後に始めてよい）

- 新規: `solver/src/bin/measure_exploit.rs`。出荷している 1 フロップの解（`TSP1`）を読み、その戦略を固定したまま、**全ターン・全リバーカード**で相手の最適応答を計算して exploitability を出す。サンプルに無いカードの戦略は「同じランクの層で一番近いサンプル」のものを使う（割り当て方を `docs/QUALITY.md` に書く）。
- 出力: フロップごとの値を `docs/QUALITY.md` の表に書く（シナリオ、フロップ、サンプル内の値、全カードでの値）。
- 完了条件: リバー単独の小さな木で、既存の `Solver::exploitability`（`postflop.rs:662`）と値が一致するテスト。63 フロップ全部の表が `docs/QUALITY.md` にある。
- **ここで上位モデルのレビューを入れる。** 表の数字を見て、3-3 以降のやり方（下の A / B）を決める。

### ステップ 3-1: プリフロップの EQR を実解から求める

- 変更: 出荷済みのフロップ解から、ハンドクラス別・IP/OOP 別・SPR 別の「実現した取り分 ÷ 生エクイティ」を集計する `gen_eqr`（`solver/src/bin/`）を作り、`preflop.rs:29-75` の係数（`Realization`）と `play_score` を、集計値の表で置き換える。
- プリフロップ → ポストフロップ → EQR → プリフロップ…と 2〜3 回まわし、レンジ幅の変化が 0.5 ポイント未満になったら止める。
- 完了条件: 既存の `solution.test.ts`（均衡性・単調性）が通る。`docs/07` §4 の表を新しい値で更新し、前回との差を書く。解を再生成するので、フェーズ 1 が終わっていること。

### ステップ 3-2: レーキ

- 変更: `preflop.rs` と `postflop.rs` の終端利得に「ポットの x%、上限 y bb、フロップを見なければ 0」を足す（`Config` に `rake_pct`・`rake_cap`）。解 ID に含める（例 `cash6max-100bb-r5`）。ステップ 2-4 のカタログに `rake` を足し、画面で選べるようにする。
- 完了条件: レーキ 0 で今のデータと一致する。レーキありで「2 人の利得の合計 = ポット − レーキ」が全終端で成り立つテスト。

### ステップ 3-3: 全カードで解く

3-0 の結果で次のどちらかを選ぶ（見積もりは `docs/08` §5 の実測「12 ランアウトで 1 フロップ約 5.7 分・約 0.22 MB」からの単純な比例で、実測ではない）。

- **A. 全部を事前計算して配る。** ランアウトは 49 × 48 = 2,352 通りで今の約 196 倍。1 フロップ約 19 時間（1 スレッド）、約 40 MB。63 フロップで約 1,200 CPU 時間・2.7 GB。静的ファイルとして配るには大きすぎる。スート同型（`docs/03` で未実装）で数分の 1 にはなるが、それでも現実的ではない見込み。
- **B. フロップとターンだけ事前計算し、リバーは端末で解く。**（勧める案）全ターンカード（49 枚）で解き、リバーは事前計算時だけ全カードで評価して、配るのはフロップ・ターンの戦略とリバー開始時の両者のレンジだけにする。リバーは開いた時にブラウザの WASM で解く（`docs/04` の実測でリバーは 0.6 ms/反復、4,000 反復で約 0.2%、数秒）。ファイルは今と同程度か小さくなる。
- B の作業: `postflop.rs` の `export` に「リバーのノードは書かず、到達レンジを書く」モード（`TSP1` v3。v2 も読めるまま）、`lib/postflop/` にリバーをその場で解いてキャッシュする層、練習・Study の両方で使う。計算は GitHub Actions のジョブか持ち主の PC で流す。
- 完了条件: 3-0 の物差しで、対象フロップが目標値以下。リバーの待ち時間がスマホ相当（Lighthouse のモバイル設定）で 5 秒以内。オフラインでも動く（WASM は既に事前キャッシュ済み）。

### ステップ 3-4: ベットサイズを増やす

- 変更: `gen_postflop` の既定を、フロップ 33/75/125%、ターン 50/100/150%、リバー 33/75/150% + オールインにする。木が大きくなる分、3-3 の後に行う。プリフロップも 3 ベットを 2 サイズにする（`docs/07` §6-3）。
- 完了条件: 3-0 の物差しで目標値以下。採点（`grading.ts`）とアクションバーが 5 個以上の選択肢で崩れない（E2E、390px 幅）。

### ステップ 3-5: 範囲を広げる

- 変更: `SCENARIOS`（`gen_postflop.rs:27`）に SB vs BB、BTN vs SB、HJ vs BB、UTG vs BB、CO vs BTN の SRP と主要な 3 ベットポットを足す。フロップは代表 100 前後（テクスチャの層ごとに選ぶ。選び方を `docs/08` に書く）。
- 他の深度（40bb、200bb）のポストフロップも作る。
- 完了条件: `validate:data` が全件通る。通しプレイ（`postflopLink`）が、足したシナリオすべてでフロップに進める。

### ステップ 3-6: HU と 9-max

- `preflop.rs` の 6 席固定（`[f32; 6]`、`POS`）を一般化する。web 側はステップ 2-5 で済んでいる。フェーズ 3 の最後。

### 外部ソルバーを使う案について

市販並みの精度に一番早く届くのは、計算だけ既存の高速なオープンソースのソルバーで行う方法です。ただし候補は AGPL で、`docs/04` はそれを避けて自作を選んでいます。計算結果のデータを配ることが許諾上どう扱われるかは、ここでは判断していません。3-0 の数字を見て自作では届かないと分かったときに、改めて検討する選択肢として残します。

---

## 後回しにしたもの（知り合いに配る前、またはクラウド同期を使うと決めたとき）

- ステップ 0-2、1-5（同期の作り込み）と、実 Supabase での検証。
- 名前「Tessera」の商標確認（`docs/00`）。
- `HANDOFF.md` の書き直し（「PR #3 はドラフトのまま」は古い。`main` にマージ済み）。

## まだ答えが要る質問

- **UI の不満はどこですか。** 今回は画面を見られていません（ARCHITECTURE §6）。気になる画面のスクリーンショット（スマホ幅）を 2〜3 枚もらえれば、見た目と操作のレビューを別に行います。
- **計算に使える機械はありますか。** フェーズ 3 は合計で数十〜数百 CPU 時間かかる見込みです。持ち主の PC で夜間に流すか、GitHub Actions（公開リポジトリは無料枠で使える）で流すかで、ステップ 3-3 の段取りが変わります。

## Sonnet への依頼文の型

```
CLAUDE.md と REFACTOR_PLAN.md に従ってください。
REFACTOR_PLAN.md のステップ <番号> だけを実装してください。
完了条件のテストが全部通ったらコミットして止まり、変更したファイルとテスト結果を報告してください。
次のステップには進まないでください。計画と違うやり方が必要だと思ったら、実装せずに理由を書いて止まってください。
```
