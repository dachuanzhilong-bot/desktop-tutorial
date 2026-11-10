# HANDOFF

## 今の目的
Claude Code セッション `session_019wsd5hJFvXwVL3RsR8cCxN` から Tessera を引き継ぎ、PR #3 の機能を検証しながら監査順位に沿って不足機能を実装する。マージ・公開・リポジトリ設定変更はしない。

## 完了したこと（コミットのハッシュ、検証結果つき）
- 作業ブランチ `claude/practical-volta-fv0rdo` は PR #3。引き継ぎ/監査計画は `e42872a`、`dd716bd`、失敗記録は `7c1df9e`、静的出力修正は `968e08a`、検証記録は `d5f46ba`。
- PR head `cd6543e` のActions run `42741582421` は solver/web success。`dd716bd` のrun `42742404780` と `42742409212` も両ジョブsuccess。
- `968e08a`: Next のnested route payloadを静的ホスト向けdotted `.txt` URLにも複製。Windows/Node26でのプリフェッチ404を解消。ユニットテスト2件追加、hosting docs更新。
- 静的修正後のローカル検証: `npm run typecheck` 成功、`npm run lint` 警告0、`npm test` 30 files / 291 tests passed、`npm run e2e` 233 passed・1 skipped、`npm run e2e:subpath` 2 passed。コンソールエラー検査はmobile/desktop双方で成功。
- GitHub Actions run `42744663023`/`42744669262`（`968e08a`）と `42744740057`/`42744746066`（`d5f46ba`）は現在実行中。solverはsuccess、webはin progress。
- `npm ci` 成功。npm監査は10件（8 moderate、2 critical）とESLint非推奨を報告。依存更新は未実施。

## 作業中のこと（どのファイルを、どこまで、何が残っているか）
- P1「保存局面とICM練習記録のクラウド同期」を設計中。実装はまだ開始していない。
- 設計方針: ICMログは既存の `mergeIcmLog` と同じ重複キーで追記統合。保存局面はIDごとに新しい `ts` を採用し、削除は `meta` の墓標も同期して古い局面が復活しないようにする。同期用2テーブルにRLSを設定し、DB版は上げない。
- 監査の次順位: P2 新しい練習種目、P3 HU/9-max、P4 全フロップ、P5 実環境での手動確認。

## 失敗しているテストと、その原因の見立て
- 現在失敗しているローカルテストはない。初回E2EのRSC `.txt` 404は `968e08a` で解消済み。
- P0 GitHub Actionsはまだ完了していない（上記run）。

## 次にやること（優先順）
1. P0 CIの完了結果を監視する（現時点でsolver成功、web進行中）。
2. 同期用型/マッピングとローカルbookmark tombstoneを追加し、単体テストを先に書く。
3. sync engineを拡張し、ICMログの追記マージと保存局面のIDごとLWW・削除同期を実装する。
4. Supabase schema/RLS、設定画面の送受信数、英日文言、偽サーバーの統合/E2Eを更新する。
5. README・docs/AUDIT・docs/10を更新し、実Supabase未確認の制限を記載する。
6. `npm run typecheck && npm run lint`、`npm test`、`npm run e2e`、`npm run e2e:subpath`を実行し、390×844とPC幅の画面を確認する。
7. 各区切りでHANDOFFを更新して小さくコミット/pushする。PR #3はドラフトのまま。

## 決めたことと、その理由（採用しなかった案も）
- `claude/practical-volta-fv0rdo` を継続する。PR #3の4機能とStudy URL競合修正があり、PR自身のCIはgreen。
- P0はテストを無効化せず、build成果物へRSC payload別名を追加した。
- 次の機能は保存局面/ICMログ同期を選ぶ。既存のlocal-first同期・meta保存・バックアップを再利用できる。削除を同期対象外にすると古い保存局面が再出現するため、墓標も同期する。
- 実Supabaseアカウントがないので、fake PostgRESTサーバーでプロトコルを検証して未確認と明記する。
- pushは作業ブランチのみ。マージ・Pages公開・設定変更は行わない。

## 未確認のこと・注意
- `968e08a`/`d5f46ba` の最新GitHub Actions結果。
- 実Supabase、スマホ実機、VoiceOver/TalkBack、GGPoker実履歴は未確認。
- npm監査脆弱性の詳細と依存更新は今回の範囲外。
- PR #3をマージ/公開しない。
