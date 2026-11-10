# HANDOFF

## 今の目的
Claude Code から Tessera を引き継ぎ、PR #3 の機能を検証してから不足機能を優先度順に実装する。P1同期はpush済み。P2の `/odds/` ポットオッズ/アウツ反復クイズは実装・ローカル検証済みで、機能コミット/pushとCI確認が残る。PRはドラフトのままにし、マージ・公開・リポジトリ設定変更はしない。

## 完了したこと（コミットのハッシュ、検証結果つき）
- `e42872a` 引き継ぎ記録、`dd716bd` 監査計画、`7c1df9e` E2E失敗の診断、`968e08a` 静的出力修正、`d5f46ba` 検証記録、`d59a960` P1同期設計をコミット済み。
- `968e08a` でNextのnested route payloadを静的ホスト向けdotted `.txt` URLにも複製し、Windows/Node 26でのプリフェッチ404を修正。
- P0修正後のローカル結果: `npm run typecheck` 成功、`npm run lint` 警告0、`npm test` 30 files / 291 tests passed、`npm run e2e` 233 passed・1 skipped、`npm run e2e:subpath` 2 passed。
- P0コミット `968e08a`、`d5f46ba`、`d59a960` のGitHub Actionsは全ジョブsuccess（`d59a960`: run `42745297588` / `42745291399`）。
- P1 Actions: `8955c35` のrun `42749024772`/`42749029713`、検証HANDOFF `77d7c5e` のrun `42749172064`/`42749179175` はすべてsuccess。
- `8955c35` でICM練習ログの追記同期とStudy保存局面の更新/削除同期を追加し、README・設計書・監査表を更新してPR #3へpush。
- P1実装は `8955c35` に含む。ICMログの追記同期、保存局面のLWWと削除墓標、バックアップ統合、Supabaseテーブル/RLS、設定画面の送受信数、英日文言、Vitest/E2Eを追加。保存局面は件数が少ないため毎回全件取得し、遅れた端末時計のカーソル取りこぼしを避ける。
- 直近検証: `npm run typecheck && npm run lint` 成功・警告0。対象Vitest（`sync.test.ts`, `bookmarks.test.ts`, `icmLog.test.ts`）23 passed。`npm run e2e -- --grep=login` はPC/モバイル2 passed。失敗していたPC側のICMアップロード確認はIndexedDBへの保存完了を待つようE2Eを修正して解消。
- P1全体検証: `npm test` 30 files / 295 passed、`npm run validate:data` 90 passed、`npm run e2e` 233 passed / 1 skipped、`npm run e2e:subpath` 2 passed、`npm run build` 成功、`git diff --check` 問題なし。型チェックとlintも再実行してexit 0。
- 目視確認: 静的ビルドを390×844と1440×900で開き、設定と保存局面を各画面幅で撮影。画面エラーと横スクロールなし。確認画像は `work/visual-check/`。

## 作業中のこと（どのファイルを、どこまで、何が残っているか）
- P1同期実装・テスト・文書は `8955c35` としてコミット/push済み。検証結果は `77d7c5e` に記録済み。Actionsはgreen。
- `README.md`、`docs/02-data-model.md`、`docs/05-roadmap.md`、`docs/10-analyze-and-sync.md`、`docs/11-icm.md`、`docs/AUDIT.md` を更新済み。同期対象と対象外、墓標、2,000件のローカル上限、実環境未確認を明記。
- ICMドリルの日本語/英語説明、設定画面の同期範囲、コードコメントを更新済み。古い「ICMは同期されない」表記は検索で解消を確認。
- 全テスト・データ検証・390×844と1440×900の確認が完了。
- P2受け入れ基準: 厳密式からポットオッズ/アウツ4択を生成し、回答後に正誤・正解・式の説明を出す。回数/連続正解は当ページのセッション内で数える。日本語/英語、44px以上、既存 `/odds/` に統合し、単体/E2E/オフラインを検証する。永続化・クラウド同期はこの小機能には加えない。
- P2実装完了（未コミット）: `web/src/lib/poker/oddsQuiz.ts`、`web/src/components/odds/OddsQuiz.tsx`、`web/src/app/odds/page.tsx`、日英i18n、単体/英日E2E、axeの動的状態テスト、`public/sw.js` をv7に更新。README/roadmap/AUDITも実装済みへ更新。
- P2対象検証: `npm run typecheck && npm run lint` 成功・警告0、対象Vitest 2 files / 11 passed、`npm run e2e -- --grep="pot odds and outs quiz"` PC/モバイル2 passed。`npm run e2e -- --grep=odds` はOddsの通常/クイズとaxe（ダーク/ライト、回答前後）を含む18 passed。
- 英語文言確認: 問題文でポットがベット前の額と明示。設定fixtureをマージに変えた後の `npm run e2e -- --grep=odds` は英語クイズを含む20 passed（PC/モバイル、axeダーク/ライト含む）。
- P2全体検証: `npm run typecheck && npm run lint` 成功・警告0、`npm test` 31 files / 298 passed、`npm run validate:data` 90 passed、`npm run e2e` 241 passed / 1 skipped（242件中）、`npm run e2e:subpath` 2 passed、`npm run build` 成功、`git diff --check` 成功。全E2Eでクイズaxe（ダーク/ライト）、英語表示、オフライン起動、操作サイズ、横スクロールも成功。
- 画面確認: 静的出力でクイズ回答済みの画面を390×844と1440×900で確認。document幅=viewport幅、ブラウザーエラー0。画像は `work/visual-check/odds-mobile.png` と `odds-desktop.png`。

## 失敗しているテストと、その原因の見立て
- P0の初回E2Eは静的出力のRSC `.txt` 404だったが `968e08a` で修正し、その後の全E2Eは通過。
- P1のログインE2E初回はPC側でICM記録が同期前に存在しないことがあった。ICMのIndexedDB保存が非同期であることを確認し、E2Eで保存完了を待つようにして修正。修正後は単独のPC/モバイル2件と全体E2E（233 passed / 1 skipped）が成功。
- P2の初回ターゲットE2EはPC/モバイルで失敗したが、原因はテストが結果欄ではなく親クイズ欄内に同じtest IDを重ねて探していたこと。結果欄を直接確認するよう直し、PC/モバイル2件が成功。
- `npm run e2e -- --grep="odds quiz question and answer feedback"` はPowerShell経由の引数分割で対象0件となった（テスト失敗ではない）。`--grep=odds` に変えて再実行し、該当する18件が成功。
- 全体`npm test`初回はi18nテスト1件が失敗。新しい日本語の式説明に半角括弧が含まれていたため全角括弧に直し、再実行は31 files / 298 passed。
- 英語クイズのE2E追加後、Odds対象実行で英語表示テストがPC/モバイル各1件失敗。共通初期化がページ遷移時に設定全体を上書きしていた。fixtureを既存設定のマージに直し、再実行20件は成功（アプリ本体の言語切替不具合ではなかった）。

## 次にやること（優先順）
1. P2コード・README・roadmap・AUDITを機能コミットして作業ブランチへpushする。
2. コミットハッシュと最終検証結果をHANDOFFへ記録してpushし、P2最新コミットのGitHub Actionsを確認する。
3. PR #3はドラフトのまま維持。次の候補はHU/9人卓解、全フロップ計算、実履歴・実Supabase・実機確認。費用対効果で優先度を見直す。

## 決めたことと、その理由（採用しなかった案も）
- `claude/practical-volta-fv0rdo`（PR #3）を継続する。PR #3の4機能とStudy URL競合修正があり、既存CIもgreen。
- P0のE2E検査を弱めず、ビルド後にRSC payload別名を作る修正を採用した。
- ICMログは追記・重複排除、保存局面はIDごとの更新時刻で統合し削除墓標も送る。ICM記録や保存局面を端末限定にする案は、複数端末の学習データが揃わず復活/再同期の問題も残すため採用しない。
- 保存局面は少量データなので毎回全件取得し、時刻カーソルによる取りこぼしを避ける。大量データのICMログは追記で時刻カーソルを使う。
- IndexedDBはmetaストアを継続使用し、DB版は上げない。バックアップの既存マージ経路にも削除墓標を含める。
- 実Supabase環境はないため偽PostgREST/GoTrueとブラウザE2Eで検証し、実環境未確認を明記する。
- P2は「学習ドリルを追加」を優先し、既存計算ロジックを使うポットオッズ/アウツのクイズを採用。新ルート・DB保存は加えず、短いセッション内で反復できる形にする。
- pushは作業ブランチのみ。マージ、Pages公開、リポジトリ設定変更は行わない。

## 未確認のこと・注意
- P1のコード/HANDOFF Actionsはすべてsuccess。P2 HANDOFF `3af725a` までのActionsと、これからpushするP2機能/HANDOFFのActionsを確認する。実Supabase適用は未確認。
- 実Supabase、スマホ実機、VoiceOver/TalkBack、GGPoker実履歴は未確認。
- `npm ci` は成功したがnpm auditが10件（8 moderate、2 critical）とESLint非推奨を報告。依存更新は未実施。
- SQLはスキーマ追加案。既存/実際のSupabaseプロジェクトへ適用していない。
- PR #3をマージ/公開しない。
