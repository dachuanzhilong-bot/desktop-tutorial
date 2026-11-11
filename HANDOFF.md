# HANDOFF

## 現在の状態（Claude、PR #3 マージ後・最新）
- PR #3 はマージ済み（持ち主の了承あり）。`main` は GitHub Pages に自動公開される（`.github/workflows/pages.yml`、公開前に `npm run e2e:subpath`）。公開URL: https://dachuanzhilong-bot.github.io/desktop-tutorial/ 。持ち主が開いて使えることを確認済み。リポジトリは公開。
- 以後の作業は `claude/practical-volta-fv0rdo`（マージ済み `main` から作り直し、同名）で行う。**次のPRのマージ・公開・設定変更は、持ち主の明示的な許可を待つ**（PR #3 への許可は以後に及ばない）。
- マージ後に追加した機能（この枝、未マージ）: ① 復習キュー（`lib/practice/review.ts`、`components/practice/ReviewCard.tsx`）、② 学習の道すじ `/learn/`（`lib/learn/lessons.ts`、`lib/storage/lessons.ts`、`app/learn/page.tsx`、ホームの「次のレッスン」）、③ フロップの読み方ドリル（`lib/postflop/textureQuiz.ts`、`components/report/TextureQuiz.tsx`、`/study/report/` 上部）、④ 更新のお知らせ（`lib/pwa/updateWatch.ts`、`components/UpdateBanner.tsx`、`scripts/stamp-sw.mjs` がビルドごとに `sw.js` へ指紋を書く）。各機能に単体テスト・E2E・axe（該当画面）あり。Service Worker は `VERSION = "v9"`、シェルのキャッシュ名はビルド指紋つき。
- 学んだこと: Next の同一ページへのハッシュだけの `router.push` はページの effect も `hashchange` も再実行しない（練習セットの開始は `onStartSet` で直接開始）。表示テキストと違う `aria-label` は axe の `label-content-name-mismatch` になる（一覧ボタンは表示テキストをそのまま名前にする）。Playwright の `context.route` は Service Worker のスクリプト更新取得を横取りできない（更新通知は `controllerchange` を直接送って確認）。
- 検証できていないこと: 公開サイトの実機表示（この環境から github.io に接続できない）、実Supabase（`supabase/schema.sql` は未適用）、スマホ実機、スクリーンリーダー。
- 次の候補: HU/9人卓のプリフロップ解、全フロップ計算、Lighthouse の再計測（ホームにカードが増えた）、復習キューのポストフロップ対応。

## 以前の記録（ChatGPT 作業時点を含む。古い記述は最新の状態と食い違うことがある）
### Claude による引き継ぎ（2026-11-11）
- ChatGPT の共有会話（アシスタント発言80件、最後の引き継ぎブロックまで）を全文取り込み、この `HANDOFF.md` とコミット履歴と照合した。食い違いなし。会話にだけあった情報: 作業は Windows（PowerShell、Node 26）で行われ、目視確認の画像は ChatGPT 側の手元（`work/visual-check/`）にありリポジトリには無い。
- 引き継ぎ時点: ブランチ先端 `8fbe29d`、CI（solver / web、push と PR の4実行）はすべて success、手元の型チェック・lint・Vitest 300件OK。PR #3 はドラフトのまま、マージ・公開は持ち主の判断待ち。
- `ba46eee` の #108 の web E2E 失敗は原因判明済み: 練習の「F」キーのテストが、フォールドの無い出題（BB のチェック/レイズだけ）で押しても答えられないことがあった（`8f561ee` で修正、負荷をかけた120回で全成功）。
- 以後は Claude が `claude/practical-volta-fv0rdo` を更新する。ChatGPT が再開する場合は、先に `git pull` してから始めること。

## 今の目的
PR #3 の機能を検証しながら不足機能を優先順に実装する。P1同期、P2 `/odds/` クイズ、P3保存局面の検索/並べ替えは完了し、PRブランチへpush済み。P3コードpush CI #118、PR CI #119、HANDOFF更新CI #120–#123はすべてsuccess。PRはドラフトのままにし、マージ・公開・設定変更はしない。

## 完了したこと（コミットのハッシュ、検証結果つき）
- `e42872a` 引き継ぎ記録、`dd716bd` 監査計画、`7c1df9e` E2E失敗の診断、`968e08a` 静的出力修正、`d5f46ba` 検証記録、`d59a960` P1同期設計をコミット済み。
- `968e08a` でNextのnested route payloadを静的ホスト向けdotted `.txt` URLにも複製し、Windows/Node 26でのプリフェッチ404を修正。
- P0修正後のローカル結果: `npm run typecheck` 成功、`npm run lint` 警告0、`npm test` 30 files / 291 tests passed、`npm run e2e` 233 passed・1 skipped、`npm run e2e:subpath` 2 passed。
- P0コミット `968e08a`、`d5f46ba`、`d59a960` のGitHub Actionsは全ジョブsuccess（`d59a960`: run `42745297588` / `42745291399`）。
- P1 Actions: `8955c35` のrun `42749024772`/`42749029713`、検証HANDOFF `77d7c5e` のrun `42749172064`/`42749179175` はすべてsuccess。
- `8955c35` でICM練習ログの追記同期とStudy保存局面の更新/削除同期を追加し、README・設計書・監査表を更新してPR #3へpush。
- `f7b336f` でポットオッズ/アウツ4択クイズを `/odds/` に追加。既存の厳密式を使い、日本語/英語、正誤と計算説明、セッション内の正解数/連続正解を実装。PWA Service Workerをv7へ更新。PR #3へpush済み。
- GitHub Actions: `f7b336f` のrun #106/#107 はsuccess。HANDOFF `ba46eee` のrun #109 はsuccess、同じHEADのrun #108 はweb E2E工程failure。その後のHANDOFF `8900b5e` のrun #110/#111はsuccess。
- P1実装は `8955c35` に含む。ICMログの追記同期、保存局面のLWWと削除墓標、バックアップ統合、Supabaseテーブル/RLS、設定画面の送受信数、英日文言、Vitest/E2Eを追加。保存局面は件数が少ないため毎回全件取得し、遅れた端末時計のカーソル取りこぼしを避ける。
- 直近検証: `npm run typecheck && npm run lint` 成功・警告0。対象Vitest（`sync.test.ts`, `bookmarks.test.ts`, `icmLog.test.ts`）23 passed。`npm run e2e -- --grep=login` はPC/モバイル2 passed。失敗していたPC側のICMアップロード確認はIndexedDBへの保存完了を待つようE2Eを修正して解消。
- P1全体検証: `npm test` 30 files / 295 passed、`npm run validate:data` 90 passed、`npm run e2e` 233 passed / 1 skipped、`npm run e2e:subpath` 2 passed、`npm run build` 成功、`git diff --check` 問題なし。型チェックとlintも再実行してexit 0。
- 目視確認: 静的ビルドを390×844と1440×900で開き、設定と保存局面を各画面幅で撮影。画面エラーと横スクロールなし。確認画像は `work/visual-check/`。

## 作業中のこと（どのファイルを、どこまで、何が残っているか）
- P3実装は `4412e01` としてコミット/push済み。コード作業の残りなし。#118–#123はすべてsuccess。対象ファイルは `web/src/app/study/saved/page.tsx`、`web/src/lib/study/savedPositions.ts`、その単体/E2E、日英i18n、`web/public/sw.js`、README/AUDIT/roadmap。
- P1同期実装・テスト・文書は `8955c35` としてコミット/push済み。検証結果は `77d7c5e` に記録済み。Actionsはgreen。
- `README.md`、`docs/02-data-model.md`、`docs/05-roadmap.md`、`docs/10-analyze-and-sync.md`、`docs/11-icm.md`、`docs/AUDIT.md` を更新済み。同期対象と対象外、墓標、2,000件のローカル上限、実環境未確認を明記。
- ICMドリルの日本語/英語説明、設定画面の同期範囲、コードコメントを更新済み。古い「ICMは同期されない」表記は検索で解消を確認。
- 全テスト・データ検証・390×844と1440×900の確認が完了。
- P2受け入れ基準: 厳密式からポットオッズ/アウツ4択を生成し、回答後に正誤・正解・式の説明を出す。回数/連続正解は当ページのセッション内で数える。日本語/英語、44px以上、既存 `/odds/` に統合し、単体/E2E/オフラインを検証する。永続化・クラウド同期はこの小機能には加えない。
- P2実装 `f7b336f` としてコミット/push済み。README・roadmap・AUDITも実装済みへ更新。ブランチに未コミット差分なし。
- P2対象検証: `npm run typecheck && npm run lint` 成功・警告0、対象Vitest 2 files / 11 passed、`npm run e2e -- --grep="pot odds and outs quiz"` PC/モバイル2 passed。`npm run e2e -- --grep=odds` はOddsの通常/クイズとaxe（ダーク/ライト、回答前後）を含む18 passed。
- 英語文言確認: 問題文でポットがベット前の額と明示。設定fixtureをマージに変えた後の `npm run e2e -- --grep=odds` は英語クイズを含む20 passed（PC/モバイル、axeダーク/ライト含む）。
- P2全体検証: `npm run typecheck && npm run lint` 成功・警告0、`npm test` 31 files / 298 passed、`npm run validate:data` 90 passed、`npm run e2e` 241 passed / 1 skipped（242件中）、`npm run e2e:subpath` 2 passed、`npm run build` 成功、`git diff --check` 成功。全E2Eでクイズaxe（ダーク/ライト）、英語表示、オフライン起動、操作サイズ、横スクロールも成功。
- 画面確認: 静的出力でクイズ回答済みの画面を390×844と1440×900で確認。document幅=viewport幅、ブラウザーエラー0。画像は `work/visual-check/odds-mobile.png` と `odds-desktop.png`。
- `8f561ee` で練習のキーボードE2Eが存在しない操作キーを押す可能性と、問題表示前にキーを送る競合を修正。ローカル `npm run e2e -- --grep=keyboard` は3 passed / 1 skipped。コミット本文には高負荷下120/120成功とあるが、こちらでは独立再現していない。
- `8f561ee` のGitHub Actions #114/#115とHANDOFFコミット #112/#113 はすべてsuccess。
- `4412e01` で `/study/saved/` にタイトル/メモ検索、保存日の新しい順/古い順、件数表示、該当なし表示を追加。NFKC正規化で全角/半角の検索差を吸収。保存形式・同期形式は変更せず、Service Workerをv8へ更新。README・AUDIT・roadmapを更新。
- `4412e01` の検証: `npm run typecheck && npm run lint` exit 0（警告0）、`npm test` 32 files / 300 passed、`npm run validate:data` 90 passed、`npm run e2e` 245 passed / 1 skipped（246件中）、`npm run e2e:subpath` 2 passed。`npm run e2e -- --grep=saved` 12 passed（PC/モバイル、英日、axe）。全E2Eのビルド工程も成功。
- `/study/saved/` を390×844と1440×900で目視確認。document幅は各viewportと一致し、ブラウザー例外0。画像は `work/work/visual-check/saved-search-390.png` と `saved-search-1440.png`。
- GitHub Actions #116/#117（手前のHANDOFFコミット）はsuccess。`4412e01` の#118/#119と後続HANDOFFコミットの#120–#123はすべてsuccess。

## 失敗しているテストと、その原因の見立て
- 現在の作業で未解決のローカルテスト失敗はない。最新P3の全体E2Eは245 passed / 1 skipped。
- P0の初回E2Eは静的出力のRSC `.txt` 404だったが `968e08a` で修正し、その後の全E2Eは通過。
- P1のログインE2E初回はPC側でICM記録が同期前に存在しないことがあった。ICMのIndexedDB保存が非同期であることを確認し、E2Eで保存完了を待つようにして修正。修正後は単独のPC/モバイル2件と全体E2E（233 passed / 1 skipped）が成功。
- P2の初回ターゲットE2EはPC/モバイルで失敗したが、原因はテストが結果欄ではなく親クイズ欄内に同じtest IDを重ねて探していたこと。結果欄を直接確認するよう直し、PC/モバイル2件が成功。
- `npm run e2e -- --grep="odds quiz question and answer feedback"` はPowerShell経由の引数分割で対象0件となった（テスト失敗ではない）。`--grep=odds` に変えて再実行し、該当する18件が成功。
- 全体`npm test`初回はi18nテスト1件が失敗。新しい日本語の式説明に半角括弧が含まれていたため全角括弧に直し、再実行は31 files / 298 passed。
- 英語クイズのE2E追加後、Odds対象実行で英語表示テストがPC/モバイル各1件失敗。共通初期化がページ遷移時に設定全体を上書きしていた。fixtureを既存設定のマージに直し、再実行20件は成功（アプリ本体の言語切替不具合ではなかった）。
- `8f561ee` より前、練習のキーボードE2Eは約3%の頻度で失敗していた（コミット本文の報告）。存在するアクションのキーを選び、`asking` 状態を待つ修正を取り込み、対象E2Eは成功。GitHub Actions全体の完了を確認する。
- P3の英語E2E初回は閉じた`select`内の`option`を可視と誤判定してPC/モバイルで失敗。選択値と全optionの文言を検査する正しい期待値へ直し、保存画面対象12件と全体E2E 245件は成功。アプリ不具合ではない。

## 次にやること（優先順）
1. この枝（`claude/practical-volta-fv0rdo`）のドラフトPRのCIを緑にして、持ち主に「マージしてよいか」を確認する（許可なくマージしない）。
2. マージ後に公開版（GitHub Pages）の実表示を持ち主に確認してもらう。この環境からは github.io に接続できない。
3. HU/9人卓プリフロップ解・全フロップ計算、復習キューのポストフロップ対応、Lighthouse の再計測（ホームにカードが増えた）を、価値とデータ量で優先度を再評価する。
4. 実Supabase適用、実機とVoiceOver/TalkBack、GGPoker実履歴は未確認のまま。利用可能な環境ができたら検証する。

## 決めたことと、その理由（採用しなかった案も）
- `claude/practical-volta-fv0rdo`（PR #3）を継続する。P1同期、P2クイズ、P3検索/並べ替えとStudy URL競合修正がある。PRはドラフトのまま。
- P0のE2E検査を弱めず、ビルド後にRSC payload別名を作る修正を採用した。
- ICMログは追記・重複排除、保存局面はIDごとの更新時刻で統合し削除墓標も送る。ICM記録や保存局面を端末限定にする案は、複数端末の学習データが揃わず復活/再同期の問題も残すため採用しない。
- 保存局面は少量データなので毎回全件取得し、時刻カーソルによる取りこぼしを避ける。大量データのICMログは追記で時刻カーソルを使う。
- IndexedDBはmetaストアを継続使用し、DB版は上げない。バックアップの既存マージ経路にも削除墓標を含める。
- 実Supabase環境はないため偽PostgREST/GoTrueとブラウザE2Eで検証し、実環境未確認を明記する。
- P2は「学習ドリルを追加」を優先し、既存計算ロジックを使うポットオッズ/アウツのクイズを採用。新ルート・DB保存は加えず、短いセッション内で反復できる形にする。
- 練習E2Eのキーボードは出題済みフェーズを待ち、現在提示中のアクションに対応するキーを使う。ランダム状態依存を減らし、テストを弱めない `8f561ee` の修正を採用。
- P3は少量の保存局面（上限300件）をクライアント側で絞り込み・並べ替える。検索対象はタイトルとメモ、NFKCで全角/半角を寄せる。並び順はメモ編集時刻ではなく最初の保存日時（`created`）を使い、学習順の安定を保つ。
- pushは作業ブランチのみ。マージ、Pages公開、リポジトリ設定変更は行わない。

## 未確認のこと・注意
- P1のコード/HANDOFF Actionsはすべてsuccess。P2機能 `f7b336f` のActions #106/#107、`8f561ee` の#112–#115、HANDOFF `b3362c3` の#116/#117、P3コードpush CI #118、PR CI #119、HANDOFF `174fac3`/`ac3199d` の#120–#123はすべてsuccess。実Supabase適用は未確認。
- `ba46eee` の#108だけweb E2E工程がfailure、同一HEADの#109と後続コミット#110/#111はsuccess。公開注釈は `npm run e2e` のexit code 1のみで、失敗テスト名/ログは出なかった。ActionsログAPIは管理者権限が必要で取得できず、GitHubの画面もサインイン限定。間欠E2EまたはCI環境の見立てだが、正確な原因は未確認。テストは弱めていない。
- 実Supabase、スマホ実機、VoiceOver/TalkBack、GGPoker実履歴は未確認。
- `npm ci` は成功したがnpm auditが10件（8 moderate、2 critical）とESLint非推奨を報告。依存更新は未実施。
- SQLはスキーマ追加案。既存/実際のSupabaseプロジェクトへ適用していない。
- PR #3をマージ/公開しない。
