# HANDOFF

## 今の目的
Claude Code セッション `session_019wsd5hJFvXwVL3RsR8cCxN` から Tessera の開発を引き継ぐ。PR #3 の現状を検証し、監査順位に沿って不足機能を実装する。マージ・公開・リポジトリ設定変更はしない。

## 完了したこと（コミットのハッシュ、検証結果つき）
- 作業ブランチ `claude/practical-volta-fv0rdo` は PR #3。引き継ぎ/監査計画は `e42872a`、`dd716bd`、失敗記録は `7c1df9e`。
- PR head `cd6543e` の Actions run `42741582421` は solver/web success。`dd716bd` の run `42742404780` と `42742409212` も両ジョブ success。
- P0修正 `968e08a` を作成して作業ブランチへ push 済み。Next のnested route payloadから静的ホスト向けdotted `.txt`別名を生成し、`npm run build` に組み込んだ。変換ユニットテスト2件、`docs/13-hosting.md` 更新を含む。
- 修正後（Windows / Node v26.12.1 / npm 11.20.0）の結果: `npm run typecheck` 成功、`npm run lint` 警告0、`npm test` 30 files / 291 tests passed、`npm run e2e` 233 passed・1 skipped、`npm run e2e:subpath` 2 passed。コンソールエラー検査はmobile/desktop双方で成功。
- 初回E2Eは231 passed・2 failed・1 skipped。`/practice/__next.practice.__PAGE__.txt` 等のRSCプリフェッチURLが静的exportの実ファイル配置と不一致で404。テストを弱めずビルド成果物を修正し解消した。
- `npm ci` 成功。npm監査は10件（8 moderate、2 critical）とESLint非推奨を報告。依存更新は未実施。

## 作業中のこと（どのファイルを、どこまで、何が残っているか）
- P0修正の最新コミットは `968e08a`。作業ツリーはclean。GitHub ActionsでこのコミットのCI結果を確認中（現時点ではまだrunが一覧に出ていない）。
- 次に P1「保存局面とICM練習記録のクラウド同期」を実装する。IndexedDB `meta` は現状どおり、DB版は上げない。
- 監査の次順位: P2 新しい練習種目、P3 HU/9-max、P4 全フロップ、P5 実環境での手動確認。

## 失敗しているテストと、その原因の見立て
- 現在、失敗しているローカルテストはない。初回E2Eの静的route payload 404はP0修正と再実行で解消。
- `968e08a` のGitHub CIは未確認。Node 22/LinuxとWindows/Node26の差を含めて結果を確認する。

## 次にやること（優先順）
1. `968e08a` のGitHub Actions（solver/web）完了を確認する。
2. HANDOFFを更新してコミットし、P1同期機能の設計・テストから着手する。
3. Supabase schema/RLS、同期型/エンジン、設定画面の送受信数、英日文言、偽サーバーのテストを更新する。
4. README・docs/AUDIT・docs/10を更新し、削除が同期されない制限を明記する。
5. `npm run typecheck && npm run lint`、`npm test`、`npm run e2e`、`npm run e2e:subpath` を再実行する。
6. 390×844 とPC幅の主要画面をスクリーンショットで確認し、小さくコミット/pushする。PR #3はドラフトのまま。

## 決めたことと、その理由（採用しなかった案も）
- `claude/practical-volta-fv0rdo` を継続する。PR #3の4機能とStudy URL競合修正があり、既存CIはgreen。
- P0はテストの無効化でなく、ビルド成果物へRSC route payload別名を足す方法を選んだ。静的ホストにrewriteを要求しない。
- 次の機能は保存局面/ICMログ同期を選ぶ。既存のlocal-first同期・meta保存・バックアップを再利用できる。実Supabase用アカウントが無いため、偽サーバーで検証し実環境未確認と記載する。
- pushは作業ブランチのみ。マージ、Pages公開、設定変更は行わない。

## 未確認のこと・注意
- `968e08a` のGitHub Actions結果（push直後、まだrunが見えていない）。
- 実Supabase、スマホ実機、VoiceOver/TalkBack、GGPoker実履歴は未確認。
- npm監査脆弱性の詳細と依存更新は範囲外。
- PR #3をマージ/公開しない。
