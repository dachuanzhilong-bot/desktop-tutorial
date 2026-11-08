# Tessera 設計書

テキサスホールデムのGTO（均衡戦略）を「調べる・練習する・自分のハンドを分析する」ための学習アプリ。

| # | 文書 | 内容 |
|---|------|------|
| 00 | [product.md](00-product.md) | コンセプト、ブランド（名前・ロゴ・配色）、他ツールとの差別化 |
| 01 | [screen-flow.md](01-screen-flow.md) | 画面遷移図、各画面の責務 |
| 02 | [data-model.md](02-data-model.md) | 端末内DB(IndexedDB)とSupabase(Postgres)のデータモデル、同期方針 |
| 03 | [solution-format.md](03-solution-format.md) | 解データのバイナリ形式、チャンク分割、将来のポストフロップ拡張 |
| 04 | [solver-selection.md](04-solver-selection.md) | **ソルバーの選定と理由**（ライセンス確認結果を含む） |
| 05 | [roadmap.md](05-roadmap.md) | フェーズ分割、受け入れ基準、リスク |
| 06 | [ux-design.md](06-ux-design.md) | デザイントークン、操作仕様、アクセシビリティ |
| 07 | [preflop-model.md](07-preflop-model.md) | プリフロップ解の近似モデルと、既知の限界・検証結果 |
| 08 | [postflop-model.md](08-postflop-model.md) | ポストフロップ解のモデル（サンプル抽象化）と検証 |
| 09 | [solve-and-builder.md](09-solve-and-builder.md) | Solve（WASM）・ノードロック・Range Builder |
| 10 | [analyze-and-sync.md](10-analyze-and-sync.md) | Analyze（ハンド履歴）・ログイン・クラウド同期 |
| 11 | [icm.md](11-icm.md) | MTT/ICM プッシュフォールド、性能・アクセシビリティの計測 |

## 設計上の大原則

1. **オリジナル**: 他社の名前・ロゴ・UI・解析データは使わない。解データはすべて自作ソルバーで計算する。
2. **ローカルファースト**: ログインなしで全機能が端末内で動く。クラウドは「同期」のための追加機能。
3. **オフラインで練習できる**: 解データは静的ファイル、アプリはPWA。サーバー処理は必須にしない。
4. **正直さ**: 近似・未実装・既知の誤差は、画面とドキュメントの両方に明記する。
