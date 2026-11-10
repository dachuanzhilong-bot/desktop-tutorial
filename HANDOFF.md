# HANDOFF

## 今の目的
Claude Code セッション `session_019wsd5hJFvXwVL3RsR8cCxN` から Tessera を引き継ぎ、PR #3 の変更を検証して不足機能を優先順に実装する。マージ・公開・リポジトリ設定変更はしない。

## 完了したこと（コミットのハッシュ、検証結果つき）
- 作業ブランチ `claude/practical-volta-fv0rdo` は PR #3。`e42872a` で開始記録、`dd716bd` で監査順位を追加して push 済み。
- 監査: `docs/00-product.md`、`docs/05-roadmap.md`、`docs/AUDIT.md`、`docs/13-hosting.md`、`docs/10-analyze-and-sync.md`、README を照合。優先順位は P0: PR #3 の検証、P1: 保存局面とICMログのクラウド同期、P2: 新しい練習種目、P3: HU/9-max、P4: 全フロップ、P5: 実環境での手動確認。
- PR #3 の GitHub Actions run `42741582421`（`cd6543e`）は solver/web とも success。後続 run `42742404780` と `42742409212`（`dd716bd`）も両ジョブ success。
- `web`: `npm ci` 成功（Node v26.12.1 / npm 11.20.0）。`npm run typecheck`、`npm run lint` 成功。`npm test`: 29 files / 289 tests passed。
- `npm run e2e`: 234件中231 passed、2 failed、1 skipped。失敗2件は `resilience.spec.ts` の同一ケース（mobile/desktop）。画面/横幅/a11y/PR #3 機能/既存同期の他テストは成功。
- 失敗原因をブラウザの404 URLで診断: Next のRSCプリフェッチが `/practice/__next.practice.__PAGE__.txt` のような平坦なURLを要求する一方、Next 16.4.5のWindows静的書き出しは `out/practice/__next.practice/__PAGE__.txt` に入れ、このURLで404になる。`page.goto()` のたびにナビリンクのプリフェッチが同種404を記録する。テストのエラー抑制はしていない。
- `npm ci` は依存脆弱性10件（8 moderate、2 critical）とESLint非推奨警告を報告。依存更新は未実施。

## 作業中のこと（どのファイルを、どこまで、何が残っているか）
- アプリコード変更はまだない。
- P0として、静的書き出しにRSCプリフェッチ用の平坦な`.txt`別名を生成し、実際の静的配信とローカルE2Eの両方で正しい応答になるよう修正する方針。`web/scripts/prepare-static-export.mjs`（仮）を build 後に実行し、ユニットテストを追加する。
- その後、`npm run e2e` と `npm run e2e:subpath` を全件再実行してから P1の同期機能に進む。

## 失敗しているテストと、その原因の見立て
- `npm run e2e`: `[mobile]` と `[desktop]` の `every screen renders without console errors` が失敗。静的 export に Next のプリフェッチ URLと同じ相対位置の`.txt` payloadがなくHTTP 404になる。ブラウザ診断で要求パスと出力ファイルの不一致を確認した。
- ほかに失敗した Vitest/typecheck/lint はない。GitHub Actions run は成功だが、Windows/Node26環境のE2E差を放置せず修正して検証する。

## 次にやること（優先順）
1. Next静的出力のRSC `.txt` payload別名を生成するスクリプトを作り、buildへ組み込む。元payloadから同じ内容をコピーし、既存出力やベースパス配下でも壊れないようにする。
2. 変換スクリプトの小さなテストを追加し、既存ファイルを上書きしないことも確認する。
3. `npm run typecheck && npm run lint`、`npm test`、`npm run e2e`、`npm run e2e:subpath` を実行。E2Eの全件成功を確認してから機能実装をpushする。
4. テストが通ったら HANDOFF を更新・コミット・pushし、P1の保存局面/ICMログ同期を実装する。
5. Supabase schema/RLS、同期型/エンジン/設定表示、英日文言、偽サーバーの統合テストと docs/README/AUDIT を更新する。
6. 390×844 とPC幅のスクリーンショットを確認し、最終結果と次の一手を記録する。

## 決めたことと、その理由（採用しなかった案も）
- PR #3 の既存ブランチを続けて使う。4つの追加機能と Study URL競合修正があり、CIはgreen。
- pushは作業ブランチのみ。PRをマージせずPages公開・設定変更もしない。
- E2E検査を弱める・console 404を無視する案は採用しない。静的exportの成果物に要求されるpayload別名を含めて、ユーザーの静的ホスティングでも利用できるようにする。
- 次の製品機能は保存局面/ICM練習記録の同期を選ぶ。既存のlocal-first同期とmeta保存を再利用できる。巨大な解生成より変更範囲を絞り検証できる。

## 未確認のこと・注意
- CIはNode 22/Linux、ローカルはNode 26/Windows。今回の404はローカルで確認し、CIはdd716bdまでgreen。
- `npm run e2e:subpath` は未実行。Playwright Chromiumはインストール済み。
- 実Supabase、スマホ実機、VoiceOver/TalkBack、GGPoker実履歴は未確認。
- npm監査の詳細と依存脆弱性への対応は今回の範囲外。
- PR #3 のマージ・公開はしない。
