# 完成度監査（docs/AUDIT.md）

最初の依頼の仕様書（Study / Practice / Analyze / Solve / Range Builder / Dashboard ほか）と、「完成」の基準（機能・状態・保存・操作・見やすさ・速さ）に照らした監査結果です。
区切りごとに更新します。判定: ✅完成 / 🟡一部だけ / 🧪仮のデータ・モックで動いている / ❌未着手

- 監査日: 2026-11-08（作業前） → 作業後の列は同じ表の右端に追記
- 途中経過（2026-11-09）: P0（壊れている箇所・lint・ロジックテスト・データ検証）と P1（取り消し/やり直し・Analyze・保存の版管理・近似表示）が完了
- 対象コミット: `4ba51da`（作業前）

## 1. チェックの実行結果（作業前）

| 項目 | 結果 |
|------|------|
| `npm run build`（Next.js 静的書き出し） | ✅ 成功・警告なし（17ページ） |
| `tsc --noEmit` | ✅ エラー0 |
| `tsc --noUnusedLocals --noUnusedParameters` | 🟡 未使用の宣言 11件（`analyze/page.tsx` の `m`、`builder/page.tsx` の `loadDraft`、`solve/page.tsx` の `seatOf`、`PostflopViewer.tsx` の `FreqBars` など） |
| lint | ❌ **ESLint が未設定**（設定ファイルも依存もない） → ✅ ESLint（Next・TypeScript・React Hooks・jsx-a11y）警告0、CIで必須 |
| Vitest | ✅ 109件すべて成功 |
| Playwright（モバイル/デスクトップ） | ✅ 160件成功・1件スキップ（意図的） |
| `cargo test --release` | ✅ 25件成功 |
| `cargo clippy` | 🟡 警告32件（ほぼ `needless_range_loop` などの書き方の指摘、`unsafe fn` の `# Safety` 欠落6件） → ✅ 0件（`-D warnings` をCIで必須） |
| ブラウザのコンソール（全画面を巡回） | ❌ **`/icm` で React のハイドレーションエラー #418**（2回）。他の画面はエラーなし → ✅ 原因は用語ツールチップの不正な入れ子。全画面でエラー0をe2eで常時確認 |
| `any` 型（テスト以外） | ✅ 0箇所（作業前 🟡 10箇所（`solve/page.tsx` の `catch (e: any)`、`solution/decode.ts` の `parseManifest(raw: any)`、`sync/supabase.ts` の JSON、`tree.ts` の `t: (k: any)` など）） |
| TODO / FIXME / HACK | ✅ 0件 |
| `href="#"`・空の onClick | ✅ 0件 |
| Lighthouse（モバイル、gzip配信、前回計測） | 🟡 Performance: ホーム97 / 練習92 / **スタディ85** / Solve95 / ICM95 / Analyze94、Accessibility: 全画面100、Best practices 96〜100 |

## 2. 機能ごとの判定

| 領域 | 機能 | 作業前 | 根拠（ファイル） | 作業後 |
|------|------|--------|------------------|--------|
| Study | 解のツリーをたどる（ライン表示・戻る） | ✅ | `web/src/app/study/page.tsx`, `components/LineBar.tsx` | |
| Study | 13×13表（頻度の色分け） | ✅ | `components/RangeGrid.tsx` | |
| Study | 戦略 / EV / エクイティ / レンジ表示の切替 | ✅ | `app/study/page.tsx`（`MODES`） | |
| Study | マスをタップした詳細（頻度・EV・エクイティ・EQR・スート別） | ✅ | `components/HandPanel.tsx` | |
| Study | ハンド種別・ブロッカーのフィルター | ✅ | `lib/poker/hands.ts`（`HAND_FILTERS`） | |
| Study | レンジ比較 | ✅ | `app/study/page.tsx`（compare タブ）, `lib/study/summary.ts` | |
| Study | スタック深度 20/40/60/100/200bb | 🟡 | `public/solutions/*`, `components/DepthPicker.tsx` — 100bb以外はモデル未調整 | 🟡 近似の表示を追加（100bb以外は「より粗い近似」と明記） |
| Study | ポストフロップ（フロップ→ターン→リバー） | 🟡 | `app/study/postflop/page.tsx` — 3シナリオ×21フロップのみ、ターン/リバーは代表カード | |
| Study | 集計レポート（テクスチャ別） | 🟡 | `app/study/report/page.tsx` — 計算済み21フロップの範囲だけ | |
| Practice | スポット練習 / ハンド通しプレイ / 条件指定 | ✅ | `components/practice/{Setup,Session}.tsx`, `lib/practice/sampler.ts` | |
| Practice | EV損失の5段階採点・スコア・セッション集計 | ✅ | `lib/practice/grading.ts`（しきい値は `THRESHOLDS` に1か所）, `lib/practice/session.ts` | |
| Practice | 解説（1画面・EV損失を最大表示） | ✅ | `components/practice/ResultPanel.tsx` | |
| Practice | 間隔反復（ミス・混合ハンドを優先） | 🟡 | `lib/practice/srs.ts`, `sampler.ts` — **ミスしたハンドが実際に多く出るかのテストが無い** | ✅ 実データで検証（ミス後は4倍以上、習得済みは0.5倍未満）`logic.test.ts` |
| Practice | RNGモード・時間制限・ストリーク・アニメーション | ✅ | `Session.tsx`, `PokerTable.tsx` | |
| Practice | ポストフロップ練習（スポット / 通し） | ✅ | `components/postflop/PostSession.tsx` | |
| Practice | どこからでも2タップで開始 | 🟡 | 「練習」→設定画面の**一番下までスクロール**して「はじめる」（スマホでは画面外） | |
| Practice | キーボード（F/C/R/A・数字・Space/Enterで次へ・E解説） | ✅ | `Session.tsx` 307〜320行 | |
| Analyze | PokerStars 履歴の取り込み・EV損失一覧・弱点・練習セット | ✅ | `lib/analyze/{parse,normalize,match,aggregate}.ts`, `app/analyze/page.tsx` | |
| Analyze | GGPoker 形式 | 🧪 | `parse.ts` — 書式の知識から作った合成サンプルでのみ確認 | |
| Analyze | 壊れた/知らない形式で落ちない・理由を表示 | 🟡 | 理由の表示はあるが、**壊れたファイルの網羅的なテスト（ファズ）が無い** | ✅ ファズ1,500件・壊れた入力でも例外なし、理由は日本語 `analyze.robust.test.ts` |
| Analyze | 重い処理で画面を固めない | 🟡 | 取り込み・採点がメインスレッドで連続実行（数千ハンドで固まる可能性） | ✅ 12msごとに分割実行・進捗バー・中止（3,000ハンドで確認） |
| Solve | ボード・レンジ・スタック・サイズ指定→計算（Worker/WASM） | ✅ | `app/solve/page.tsx`, `public/solver-worker.js`, `solver/src/ffi.rs` | |
| Solve | 進捗・Exploitability・残り時間・キャンセル | ✅ | `solve/page.tsx`（`solve-progress`, `solve-stop`） | |
| Solve | ノードロック・保存・Studyで開く | ✅ | `components/solve/LockPanel.tsx`, `lib/storage/idb.ts` | |
| Solve | フロップからの計算精度 | 🟡 | ブラウザ内は概算（250反復でポットの約3%） | |
| Range Builder | なぞって塗る・頻度ブラシ・一括入力 | ✅ | `app/builder/page.tsx`, `components/ranges/RangeCells.tsx` | |
| Range Builder | PIO形式の読み書き・GTO比較スコア・保存 | ✅ | `lib/ranges/range.ts`, `presets.ts` | |
| Range Builder | **取り消し・やり直し** | ❌ | なし | ✅ ボタン＋Ctrl/⌘+Z・Shift+Z、1回のドラッグ＝1手 `lib/ranges/editor.ts` |
| Dashboard | 正解率・平均EV損失・推移・ヒートマップ・目標・連続日数 | ✅ | `app/stats/page.tsx`, `lib/storage/stats.ts` | |
| Dashboard | クラウド同期（ログイン） | 🧪 | `lib/sync/*` — **偽のSupabaseでのみ検証**（実プロジェクトなし） | |
| MTT/ICM | ICMプッシュ/フォールド計算・練習 | 🟡 | `solver/src/icm.rs`, `app/icm/page.tsx` — プッシュ/フォールドのみ、練習の記録は保存しない | |
| 全体 | 日本語/英語 | ✅ | `lib/i18n/{ja,en}.ts`（キーの型で抜けを検出） | |
| 全体 | 用語のタップ解説 | 🟡 | `components/Term.tsx` — 用語集はあるが、画面内で使われている箇所が一部（練習の結果・解説などに無い） | |
| 全体 | 初回の説明 | 🟡 | `components/Onboarding.tsx` — **5画面**（基準は3画面程度） | |
| 全体 | PWA・オフライン | ✅ | `public/sw.js`（v4）, e2e `app.spec.ts` | |
| 状態 | 読み込み中（スケルトン） | ✅ | `components/Skeleton.tsx`, `SolutionGate.tsx` | |
| 状態 | データなし | ✅ | 成績・Analyze・保存一覧に空表示あり | |
| 状態 | エラー表示 | 🟡 | 解の読み込み失敗は再試行つき。**例外時の Error Boundary が無い**（`app/error.tsx` なし）→ 画面が真っ白になりうる | ✅ `app/error.tsx`（画面内）・`global-error.tsx`（全体）、e2eで確認 |
| 状態 | オフライン表示 | ❌ | オフラインであることを示す表示が無い | ✅ `OfflineBanner`（接続が戻ると消える） |
| 状態 | 404 | 🟡 | Next の既定（英語・白画面） | ✅ 日本語の404（ナビ付き） |
| 保存 | 成績・設定・レンジ・Solve・履歴の永続化 | ✅ | IndexedDB `tessera` v3（`lib/storage/idb.ts`）、設定は localStorage | |
| 保存 | バージョン番号と移行 | 🟡 | IndexedDB は v1→v3 の移行あり（e2e あり）。**localStorage の設定・下書きには版の移行処理が無い**（キー名に v1 があるだけ） | ✅ localStorage も `_v`＋段階的移行＋値の検証 `lib/storage/local.ts` |
| 操作 | タップ領域44px以上 | 🟡 | `min-h-9`(36px) 15箇所・`min-h-10`(40px) 29箇所・`h-8 w-8` 2箇所。13×13のマス（約26px）とSolveのカード選択（約25px）は画面幅の制約で44px不可（WCAG 2.5.8 の24px は満たす） | |
| 見やすさ | 色だけで区別しない | 🟡 | アクションボタン・凡例は文字あり。**13×13のマスは既定で色だけ**（模様は設定でオンにする必要） | |
| 見やすさ | コントラスト WCAG AA | ✅ | axe（全画面・主要状態・ダーク/ライト）で違反0 | |
| 見やすさ | 視差効果を減らす設定に従う | 🟡 | CSS とカード/卓のアニメーションは対応。**framer-motion 全体の設定（MotionConfig）が無い** | |
| 見やすさ | デザイントークン | 🟡 | 色は CSS 変数に集約済み。**角丸・高さ・余白は画面ごとに直書き**（`rounded-lg/xl/2xl`、`min-h-9〜14` が混在） | |
| 見やすさ | 文言・表記の統一 | 🟡 | 「(」と「（」、「3-bet」と「3ベット」などが混在 | |
| 速さ | Lighthouse 90以上 | 🟡 | スタディが85（TBT 430ms） | |
| 速さ | 表の切替でカクつかない | ✅ | `useDeferredValue`（EV切替 152→32ms, CPU4倍遅い条件） | |
| 速さ | 重い計算を Worker で | 🟡 | Solve/ICM は Worker。Analyze の取り込みはメインスレッド | |
| 正確さ | ハンド評価・エクイティ | ✅ | `solver/src/eval.rs`・`equity.rs` のテスト（AA–KK=81.9% など）。**アプリが使うエクイティ表（`public/data/equity169.bin`）自体の照合テストは無い** | ✅ エクイティ表（AA vs KK 82% など）とRust側の境界ケースを追加 |
| 正確さ | レンジ表記の読み込み | ✅ | `__tests__/ranges.test.ts`（ラウンドトリップ含む） | |
| 正確さ | ポット・ベット額・オールインの計算 | 🟡 | ソルバー側はテストあり。**アプリ側（`solution/tree.ts` の `applyAction`、`postflop/replay.ts`）のテストが薄い** | ✅ 100/20/40bb の具体例と全ノードの合法性チェック |
| 正確さ | EV損失の採点 | ✅ | `__tests__/grading.test.ts` | |
| 正確さ | 全スポットのデータ検証 | 🟡 | 100bbプリフロップとポストフロップの一部はテストあり。**全深度・全フロップを検証するスクリプトが無い** | ✅ `npm run validate:data`（全5深度・全63フロップ・エクイティ表） |
| 正確さ | 近似データであることの表示 | 🟡 | ポストフロップ画面・深度選択・設定画面に記載。**練習・Analyze・ICM の結果画面には無い** | ✅ `ApproxNote` を Study・練習・Analyze・ICM・ポストフロップに |

## 3. 画面ごとの問題（スクリーンショット 390×844 / 1440×900）

| 画面 | 問題 | 優先度 |
|------|------|--------|
| `/icm` | React ハイドレーションエラー #418（初回描画がサーバーHTMLと一致しない） | 高 |
| 全画面 | 例外が起きると真っ白（Error Boundary なし）／オフライン表示なし | 高 |
| `/nope` など | 404 が英語の白い既定画面（アプリの見た目・ナビが無い） | 中 |
| `/practice` | 「練習をはじめる」が設定の一番下（スマホでスクロールしないと見えない） | 高 |
| `/builder` | 「保存」ボタンが縦に潰れて「保／存」と2行になる | 中 |
| `/stats` | ヒートマップの列見出し（オープン(RFI) など）が狭い列で細切れに折り返す | 中 |
| `/icm` | 「あなた」以外の行のボタンが「·」だけで意味が分からない | 低 |
| `/study/report` | 「Studyで開く」が2行に折り返し、表が窮屈 | 低 |
| 全画面（PC幅） | コンテンツが幅768pxの1列のまま。スタディは表が大きすぎて詳細を見るのにスクロールが必要 | 中 |
| 全画面 | 44px未満のタップ領域（`min-h-9`/`min-h-10`/`h-8`）が46箇所 | 中 |
| 初回 | 説明が5画面（基準は3画面程度） | 低 |

## 4. 作業計画（優先度順）

**P0 — 壊れている／基準を満たしていない**
1. `/icm` のハイドレーションエラーを直す
2. Error Boundary（`app/error.tsx`・`global-error.tsx`）、アプリの見た目の 404、オフライン表示
3. ESLint を設定（TypeScript・React Hooks・アクセシビリティ）し、警告ゼロに。未使用コードと `any` を除去
4. ロジックの単体テスト追加: アプリのエクイティ表（AA vs KK など）、ポット・ベット額・オールイン、間隔反復で「ミスしたハンドが多く出る」こと
5. 全深度・全フロップの解データを検証するスクリプト（`npm run validate:data`、CIで実行）

**P1 — 仕様の未完成部分**
6. Range Builder の取り消し・やり直し（ボタン＋ Ctrl/⌘+Z・Shift+Z）
7. Analyze: 壊れた/知らない形式のファズテスト、取り込みを分割実行して画面を固めない
8. 保存データの版管理: localStorage（設定・下書き）に版番号と移行処理、テスト
9. 近似データの表示を共通部品にし、練習・Analyze・ICM にも出す

**P2 — 使い心地・見た目**
10. タップ領域44px（例外は13×13のマスとカード選択、理由を記載）、潰れたボタン・ヒートマップ見出しの修正
11. 色だけで区別しない（13×13のマスの模様を既定でオン）、MotionConfig で「視差効果を減らす」に全体で従う
12. デザイントークン（角丸・高さ・余白）を1か所にまとめ、各画面を合わせる
13. 「練習をはじめる」を常に見える位置に（2タップで開始）、初回説明を3画面に
14. 用語のタップ解説を練習の結果・解説にも、文言・表記を統一（自動チェック付き）
15. PC幅のレイアウト（スタディの表と詳細を横並び）

**P3 — 速さ**
16. スタディの Lighthouse Performance を90以上に、全画面を再計測

**今回の範囲では作れないもの（理由と代案）** — 最後に「残っている課題」として整理
- 1,755フロップの全計算: 1フロップ約5分×1,755×シナリオ数で数百時間かかり、データも1GB規模。→ 代表21フロップの拡充を続け、テクスチャ集計の精度を上げる
- 実際の Supabase での動作確認・実機（iPhone/Android）・スクリーンリーダーでの手動確認・実際の GGPoker ファイル: この環境では不可。→ 確認手順を最後に記載
