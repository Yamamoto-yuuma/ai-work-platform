# 業務ナビゲーション・プラットフォーム

社員が業務を進める際の「次に何をすればいい？」「どこに情報がある？」「この変更で他に何が必要？」
「いつまでに終わらせる？」を減らすための業務ナビゲーション・プラットフォームです。

AIチャットツールではありません。業務を開始すると、**現在の状況・次にやること・必要な情報・
関連ルール・派生タスク・期限・必要なツール**を適切なタイミングで提示し、完遂までナビゲートします。

## ステータス

**Phase 1（UI/UXプロトタイプ）実装済み。** 外部サービス連携は未接続です。

## 起動方法

```bash
npm install
npm run dev      # http://localhost:3000
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを起動 |
| `npm run build` | 本番ビルド |
| `npm run typecheck` | 型検査 |
| `npm run lint` | ESLint |
| `npm run check:hardcode` | 業務固有の文字列がコードに混入していないか検査 |
| `npm run verify` | 型検査 → ハードコード検査 → ビルド |

## 技術構成

Next.js 15 (App Router) / React 19 / TypeScript (strict) / Tailwind CSS v4

外部依存（Supabase・Google Calendar・Gmail・Google Drive・LLM API・企業検索API）は
`src/ports/` のインターフェース越しに定義され、Phase 1 では `src/adapters/memory/` が実装しています。

## ディレクトリ構成

```
app/                    画面（Next.js App Router）
src/
├ core/                 ドメインエンジン（framework 非依存の純粋関数）
│  ├ model/             型定義
│  ├ flow/              STEP遷移・条件分岐・合流・完了判定
│  ├ rules/             一時ルールの解決・優先順位・競合検出・オーバーレイ
│  ├ derivation/        変更 → 派生タスク・影響グラフ
│  ├ schedule/          期限算出・逆算スケジュール
│  └ context/           文脈提示・次の一手の決定
├ components-registry/  業務部品のレジストリ
├ ports/                外部依存のインターフェース
├ adapters/memory/      Phase 1 の実装（インメモリ + localStorage）
└ ui/                   画面共通コンポーネント
seed/                   業務フロー・ルール・マスタのシードデータ
docs/                   仕様書・設計書
```

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) | **正式仕様書**（何を作るのか・なぜ）。矛盾した場合はこちらが正 |
| [`docs/DESIGN.md`](docs/DESIGN.md) | 技術設計（どう作るのか） |

## 設計の要点

- 業務フロー・STEP・条件分岐・ルール・派生タスク・期限・依存関係を**すべてデータとして管理**
  （コードへのハードコードは `npm run check:hardcode` で機械的に禁止）
- 業務フロー定義（テンプレ）と業務実行（Run）を分離し、定義のバージョンを Run に固定
- 一時ルールは定義を書き換えず**オーバーレイとして合成**（期間終了で自動的に外れる）
- すべての状態変化を **WorkEvent** として記録し、派生タスク・影響分析を同一ソースから導出
- ドメインロジックは `src/core/` に隔離（ESLint で framework の import を禁止）
- **AIが停止しても中核機能は動作する**（派生タスク生成・不足情報検出・逆算はすべて決定的ロジック）
