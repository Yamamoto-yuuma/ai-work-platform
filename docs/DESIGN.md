# 業務ナビゲーション・プラットフォーム 設計書 v1.0

> 本ドキュメントは実装前の設計提案です。コードはまだ書きません。
> リポジトリ状態: 空（コミットなし）。完全な新規構築として設計しています。

---

## 0. 設計の背骨（この設計で最も重要な5つの判断）

このプロダクトの本質は「AIチャット」ではなく **「業務の状態機械 + 文脈提示エンジン」** です。
そのため以下5点を全設計の土台に置きます。

| # | 判断 | 理由 |
|---|---|---|
| 1 | **業務フロー・STEP・ルール・派生・依存を全て「データ」として持つ** | 個別業務のハードコードを禁止。フロー追加＝DBレコード追加で完結させる |
| 2 | **`WorkflowDefinition`（定義／テンプレ）と `WorkRun`（実行インスタンス）を完全分離** | 走行中の業務が、定義の編集で壊れない。Run は開始時の定義バージョンを pin する |
| 3 | **一時ルールは定義を書き換えず「オーバーレイ」として重ねる** | 9月限定ルールが標準フローを破壊しない。期間終了で自動的に剥がれる |
| 4 | **全ての状態変化を `WorkEvent` として追記専用で記録する** | 派生タスク生成・インパクト分析・タイムライン・監査を「同じ1つのソース」から導出できる |
| 5 | **ドメインロジックを framework 非依存の純粋TypeScript (`src/core/`) に隔離** | Next.js にも DB にも LLM にも依存しない。ここが単体テスト可能な「エンジン」の実体 |

そしてUXの背骨は **「ユーザーは機能を選ばない。業務を開くと、その場に必要な機能が出てくる」**。
機能一覧をナビに並べるのではなく、STEP が「今使うべき部品」を画面に出します。

---

## 1. 技術スタック

### 1-1. コア

| 領域 | 採用 | 理由 |
|---|---|---|
| フレームワーク | **Next.js 15 (App Router) / React 19** | Server Components でデータ取得を単純化。Server Actions を薄いトランスポートに使う |
| 言語 | **TypeScript (strict)** | 業務データ構造が設計の中心。型が仕様書になる |
| スキーマ | **Zod** | 「型・バリデーション・LLM構造化出力・DB制約」の単一ソース。最重要ライブラリ |
| スタイル | **Tailwind CSS v4** | プロトタイプ速度 |
| UIコンポーネント | **shadcn/ui (Radix)** | 所有権がコード側に残る（ベンダーロックしない） |
| サーバ状態 | **TanStack Query** | 楽観更新・invalidation。業務実行中の頻繁な更新に適する |
| クライアント状態 | **Zustand** | ナビゲーター実行中の一時状態のみ（永続化しない） |
| フォーム | **React Hook Form + zodResolver** | 業務部品ごとの動的フォーム生成に必要 |
| グラフ描画 | **React Flow (`@xyflow/react`)** | 業務マップ・インパクトマップ・フロービルダーの3画面を1ライブラリで賄う |
| 日付 | **date-fns / date-fns-tz** | 逆算スケジューラで営業日計算が必須。JST固定 |
| テスト | **Vitest**（core エンジン）／**Playwright**（主要導線） | エンジンが純粋関数なので単体テストが厚く書ける |

### 1-2. 差し替え前提の外部依存（Phase 1 は全てモック）

| 領域 | Phase 1（初期） | 将来 | 抽象化する場所 |
|---|---|---|---|
| 永続化 | JSON seed + In-memory + localStorage | **Supabase / PostgreSQL**（Drizzle ORM） | `src/ports/repositories.ts` |
| 認証 | モックユーザー切替 | Supabase Auth (Google OAuth) | `src/ports/auth.ts` |
| LLM | 決め打ちモック応答 | **Claude API**（tool use による構造化出力） | `src/ports/llm.ts` |
| カレンダー | ローカル擬似イベント | **Google Calendar API** | `src/ports/calendar.ts` |
| メール | 下書き保存のみ | **Gmail API** | `src/ports/mailer.ts` |
| ファイル | ローカルメタデータ | **Google Drive / Notion API** | `src/ports/knowledge-source.ts` |
| 企業検索 | 200社のシードデータ | 外部企業DB API | `src/ports/company-search.ts` |

> **設計ルール**: UI層とドメイン層は `ports/` のインターフェースにしか依存しない。
> `adapters/` の実装は DI コンテナ（`src/container.ts`）で環境変数により差し替える。
> これにより「モック→本番」の移行が、UI・ドメインコードを一切触らずに済みます。

---

## 2. システムアーキテクチャ

### 2-1. レイヤー構造

```
┌─────────────────────────────────────────────────────────┐
│ Presentation   app/ , src/ui/                            │
│   画面・業務部品レンダラ・コンテキストパネル             │
└───────────────────────┬─────────────────────────────────┘
                        │ Server Actions / Route Handlers
┌───────────────────────▼─────────────────────────────────┐
│ Application    src/services/                             │
│   ユースケース単位: startRun / advanceStep / applyChange │
│   / decomposeAdhoc / proposeSchedule ...                 │
│   （トランザクション境界・イベント発火・AI呼出の調停）   │
└───────────────────────┬─────────────────────────────────┘
┌───────────────────────▼─────────────────────────────────┐
│ Domain Core    src/core/    ★純粋関数・依存ゼロ★        │
│  ┌──────────────┬──────────────┬──────────────────────┐ │
│  │ flow/        │ rules/       │ derivation/          │ │
│  │ STEP遷移     │ ルール解決   │ 変更→派生タスク      │ │
│  │ 分岐条件評価 │ 優先順位     │ トリガーマッチング   │ │
│  │ 完了判定     │ 競合検出     │                      │ │
│  ├──────────────┼──────────────┼──────────────────────┤ │
│  │ impact/      │ schedule/    │ context/             │ │
│  │ 影響グラフ   │ 逆算日程     │ STEP関連情報の絞込   │ │
│  └──────────────┴──────────────┴──────────────────────┘ │
└───────────────────────┬─────────────────────────────────┘
┌───────────────────────▼─────────────────────────────────┐
│ Ports          src/ports/       （インターフェースのみ） │
└───────────────────────┬─────────────────────────────────┘
┌───────────────────────▼─────────────────────────────────┐
│ Adapters       src/adapters/                             │
│  memory | supabase | llm(anthropic/mock) | google | search│
└─────────────────────────────────────────────────────────┘
```

### 2-2. 中核となる3つの実行時概念

**(A) WorkRun — 業務実行インスタンス**

`WorkflowDefinition` は設計図、`WorkRun` は動いている実体です。
Run は `workflowVersion` を保持し、開始時点の定義スナップショットで走ります。
管理者がフローを編集しても、進行中の業務は壊れません（新規 Run から新版が適用）。

**(B) WorkEvent — 追記専用イベントログ**

```
STEP完了 / 値変更 / タスク生成 / ルール適用 / AI提案採用 / 日付変更 …
        ↓ 全て WorkEvent として append
        ↓
   ┌────┴────┬─────────┬──────────┬─────────┐
派生タスク  インパクト  タイムライン  監査ログ  スケジュール再計算
```
「キャンペーン終了日を 9/30→10/15 に変更」は `WorkEvent(type: 'field.changed')` であり、
これが派生エンジンとインパクトエンジンの唯一の入力になります。
**変更の影響管理を、特別扱いの機能ではなくアーキテクチャの基本動作にする**のがこの設計の要点です。

**(C) EffectiveStep — ルール適用後のSTEP**

```
StepDefinition（標準）
   + 部署ルールのパッチ
   + 期間限定ルールのパッチ   ← 9月限定ルール
   + 個別案件ルールのパッチ
   ────────────────────────
   = EffectiveStep（画面に出るSTEP）
```
ルールはフロー定義を書き換えず、**描画時に合成**されます。
期間が切れれば、次の描画から自動的に消えます（バッチ処理不要）。

---

## 3. データモデル

### 3-1. エンティティ相関

```
Organization ─< User
              └< Team

WorkflowDefinition(version) ─< StepDefinition ─< ComponentConfig
        │                   └< FlowEdge(condition)
        │
        └──< WorkRun ──< StepRun
                 │      └< WorkEvent
                 ├──< Task ──< TaskDependency
                 │      └< Task(派生・親子)
                 ├──< ChangeEvent ──< ImpactGraph
                 └──< AiSuggestion

BusinessRule (scope で Workflow/Step/Customer に紐付く)
DerivationRule (trigger で ChangeEvent に紐付く)
KnowledgeItem / EmailTemplate / DocumentTemplate (linkedStepKeys で STEP に紐付く)
Customer / Contact / Company / CompanyCandidate / CompanySelection
CalendarLink (Task|Run ↔ 外部イベントID)
```

### 3-2. 主要エンティティ定義

#### WorkflowDefinition（業務フロー定義）

| フィールド | 型 | 説明 |
|---|---|---|
| `id` / `key` | string | key は人が読める安定識別子（`inquiry-new`） |
| `version` | number | 発行のたびに増加。Run はこれを pin |
| `status` | `draft｜published｜archived` | 下書き編集中は既存 Run に影響しない |
| `name` / `description` | string | |
| `category` | `standard｜adhoc-template` | |
| `audience` | `{ roles[], teams[] }` | 対象者 |
| `trigger` | `{ type: manual｜webhook｜schedule｜task, config }` | 起動条件 |
| `steps` | `StepDefinition[]` | |
| `edges` | `FlowEdge[]` | STEP順と分岐は「有向グラフ」で表現 |
| `variables` | `VariableDef[]` | Run コンテキストのスキーマ（型・必須・出所） |
| `completionPolicy` | `{ requireAllRequiredSteps, condition? }` | 完了条件 |
| `deadlineRule` | `DeadlineRule` | 業務全体の期限規則 |
| `ruleTags` | string[] | ルール適用のためのタグ |
| `derivationRuleIds` | string[] | このフローで有効な派生ルール |
| `createdAt/updatedAt/publishedAt/createdBy` | | |

#### StepDefinition（STEP＝再利用可能な業務部品のインスタンス）

| フィールド | 型 | 説明 |
|---|---|---|
| `id` / `key` | string | |
| `title` / `description` / `guidance` | string | guidance は「このSTEPで何をするか」の説明文 |
| `componentType` | `WorkComponentType` | **業務部品の種別**（§6-2） |
| `config` | JSON | 部品ごとの設定（Zodスキーマで検証） |
| `inputs` / `outputs` | `Binding[]` | Run コンテキスト変数との接続（`{ from: 'customer.id', as: 'customerId' }`） |
| `required` | boolean | 完了条件に含めるか |
| `assigneeRule` | `AssigneeRule` | 担当者の決め方（実行者／ロール／固定） |
| `deadlineRule` | `DeadlineRule` | 逆算スケジューラの入力（`{ offsetDays: -3, from: 'run.dueAt', businessDaysOnly: true }`） |
| `estimatedMinutes` | number | 逆算の所要時間 |
| `knowledgeRefs` | string[] | このSTEPで出すナレッジ |
| `ruleTags` | string[] | このSTEPに効くルールのタグ（`email`, `company-search`…） |
| `derivationTriggers` | string[] | このSTEPが発火しうる派生ルール |
| `completionCriteria` | `ConditionExpr?` | 部品標準の完了条件を上書き |

#### FlowEdge（STEP順・分岐）

```ts
{ id, from: 'step-a', to: 'step-b', label?: '予算が明確な場合',
  condition?: ConditionExpr, priority: number }
```
分岐は「条件付きエッジ」で表現。条件なしエッジ＝無条件遷移。
同一 `from` に複数エッジがある場合、`priority` 順に条件評価し、最初に真になったものへ遷移。
並列 STEP は複数エッジを同時に活性化（`WorkRun.currentStepIds` が配列である理由）。

#### ConditionExpr（条件式・JSONで表現）

```ts
type ConditionExpr =
  | { op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in'|'contains'|'exists'|'isEmpty',
      left: ValueRef, right?: ValueRef }
  | { op: 'and'|'or', operands: ConditionExpr[] }
  | { op: 'not', operand: ConditionExpr };

type ValueRef =
  | { kind: 'literal', value: unknown }
  | { kind: 'var', path: string }          // 'context.budget' / 'customer.industry'
  | { kind: 'now' }
  | { kind: 'stepOutput', stepKey: string, path: string };
```
**JS式を eval しない**ことが重要（安全性・保存可能性・GUIビルダーでの編集可能性）。

#### WorkRun / StepRun

```ts
WorkRun {
  id, workflowKey, workflowVersion, title,
  subject: { type: 'customer'|'company'|'deal'|'campaign'|'none', id? },
  status: 'active'|'paused'|'blocked'|'done'|'canceled',
  currentStepIds: string[],           // 並列対応
  context: Record<string, unknown>,   // 変数の実値
  assigneeId, dueAt, priority,
  source: 'standard'|'adhoc',
  parentRunId?, createdFromTaskId?,
  startedAt, completedAt
}

StepRun {
  id, runId, stepKey,
  status: 'pending'|'active'|'done'|'skipped'|'blocked',
  output: Record<string, unknown>,
  appliedRuleIds: string[],           // どのルールが効いた状態で完了したかを記録
  checklistState: Record<string, boolean>,
  assigneeId, dueAt, startedAt, completedAt, note
}
```

#### Task（業務フローと紐付いたタスク）

```ts
Task {
  id, title, description,
  status: 'todo'|'doing'|'blocked'|'waiting-approval'|'done'|'canceled',
  priority: 'low'|'normal'|'high'|'urgent',
  assigneeId, dueAt, estimatedMinutes,

  // 業務との接続（ここが一般Todoとの違い）
  runId?, stepKey?,
  startableWorkflowKey?,   // 「このタスクから業務を開始」できる
  subject?,

  // 派生の系譜
  parentTaskId?, originEventId?, derivationRuleId?,
  source: 'manual'|'flow'|'derived'|'ai'|'schedule',

  // 承認ゲート（AI/自動生成は必ずここを通す）
  confirmationState: 'confirmed'|'proposed'|'rejected',

  dependsOn: string[], blocks: string[],
  calendarLinkId?, createdAt, updatedAt
}
```

#### その他

- **`WorkEvent`**: `{ id, runId?, taskId?, type, actor, payload, causedByEventId?, createdAt }`
- **`ChangeEvent`**: `{ id, entityType, entityId, field, before, after, reason, actor, occurredAt, runId? }`
- **`KnowledgeItem`**: `{ id, title, body?, url?, source: 'internal'|'gdrive'|'notion'|'upload', kind: 'manual'|'faq'|'policy'|'material', tags[], linkedStepKeys[], linkedWorkflowKeys[], updatedAt }`
- **`EmailTemplate`**: `{ id, name, subject, body, variables[], workflowKeys[], stepKeys[], tone }`（差し込みは `{{customer.name}}` 形式）
- **`Company` / `CompanyCandidate` / `CompanySelection`**: 候補は `{ companyId, score, matchedConditions[], state: 'candidate'|'selected'|'excluded', reason }`
- **`AiSuggestion`**: `{ id, kind, inputSnapshot, output, status: 'pending'|'accepted'|'edited'|'rejected', reviewedBy, reviewedAt }`
- **`CalendarLink`**: `{ id, provider, externalEventId, taskId?, runId?, syncState, lastSyncedAt }`

---

## 4. ディレクトリ構成

```
ai-work-platform/
├ app/
│  ├ layout.tsx
│  ├ (app)/
│  │  ├ page.tsx                       ① HOME
│  │  ├ navigator/[runId]/page.tsx     ③ 業務ナビゲーター（中心画面）
│  │  ├ workflows/
│  │  │  ├ page.tsx                    ② 業務フロー一覧
│  │  │  ├ new/page.tsx                ⑩ フロー作成
│  │  │  └ [key]/edit/page.tsx         ⑩ フロー編集（React Flow ビルダー）
│  │  ├ runs/page.tsx                  進行中の業務一覧
│  │  ├ adhoc/new/page.tsx             ④ アドホック業務作成
│  │  ├ tasks/
│  │  │  ├ page.tsx                    ⑤ タスク一覧
│  │  │  └ [taskId]/page.tsx           ⑥ タスク詳細
│  │  ├ map/[runId]/page.tsx           ⑨ 業務マップ
│  │  ├ impact/[changeId]/page.tsx     ⑫ インパクトマップ
│  │  ├ schedule/page.tsx              ⑬ 逆算スケジューラー
│  │  ├ rules/page.tsx                 ⑪ 一時ルール管理
│  │  ├ companies/page.tsx             ⑦ 企業検索・選定
│  │  ├ email/page.tsx                 ⑧ メール作成 / テンプレ管理
│  │  ├ documents/page.tsx             文章作成
│  │  ├ knowledge/page.tsx             ナレッジ（横断検索は補助的位置づけ）
│  │  └ settings/page.tsx              ⑫ 設定・連携
│  └ api/                              Route Handlers（Webhook/OAuth コールバック）
│
├ src/
│  ├ core/                    ★ 依存ゼロの純粋ドメイン ★
│  │  ├ model/                Zod スキーマ + 型（全エンティティ）
│  │  ├ flow/
│  │  │  ├ engine.ts          next()/advance()/canComplete()
│  │  │  ├ condition.ts       ConditionExpr 評価器
│  │  │  └ completion.ts
│  │  ├ rules/
│  │  │  ├ resolver.ts        scope/期間/条件で該当ルール抽出
│  │  │  ├ priority.ts        4段階の優先順位解決
│  │  │  ├ conflict.ts        競合検出と警告生成
│  │  │  └ overlay.ts         StepDefinition → EffectiveStep 合成
│  │  ├ derivation/
│  │  │  ├ matcher.ts         ChangeEvent → DerivationRule マッチング
│  │  │  └ generator.ts       派生タスク草案生成（proposed 状態で返す）
│  │  ├ impact/graph.ts       直接／間接／確認事項の影響グラフ構築
│  │  ├ schedule/
│  │  │  ├ backward.ts        期限からの逆算
│  │  │  ├ topology.ts        依存関係のトポロジカルソート・循環検出
│  │  │  └ business-days.ts   営業日・祝日計算
│  │  └ context/resolver.ts   現在STEPに関係するものだけ返す
│  │
│  ├ components-registry/     ★ 業務部品プラグイン ★
│  │  ├ registry.ts           型 → {configSchema, Renderer, executor} の登録表
│  │  └ types/                input / select / checklist / customer-view /
│  │                          company-search / company-select / email-compose /
│  │                          document-compose / task-create / calendar-create /
│  │                          knowledge-view / ai-assist / approval / branch / complete
│  ├ services/                ユースケース（core + ports を組み合わせる）
│  ├ ports/                   repositories.ts / llm.ts / calendar.ts / mailer.ts /
│  │                          company-search.ts / knowledge-source.ts / auth.ts / clock.ts
│  ├ adapters/
│  │  ├ memory/               Phase1 実装（seed 読み込み）
│  │  ├ supabase/             Phase7 実装
│  │  ├ llm/ anthropic.ts, mock.ts
│  │  ├ google/ calendar.ts, gmail.ts, drive.ts
│  │  └ company-search/ seed.ts, external.ts
│  ├ ai/
│  │  ├ prompts/              用途別プロンプト
│  │  ├ schemas/              出力の Zod スキーマ（tool use 定義に変換）
│  │  └ guard.ts              確認必須／自動確定禁止の判定
│  ├ ui/                      デザインシステム（Button, Card, StepRail, ContextPanel…）
│  └ lib/                     date, id, template（差し込み）, result 型
│
├ seed/                       デモデータ（JSON）
│  ├ workflows/               inquiry-new / post-cv / company-research
│  ├ rules/                   september-rule ほか
│  ├ derivation-rules/        campaign-date-change ほか
│  ├ knowledge/ email-templates/ companies/ customers/ tasks/
├ docs/                       DESIGN.md（本書）, ADR/
└ tests/                      core の単体テスト中心
```

---

## 5. 画面構成

### 5-1. グローバルレイアウト（最重要のUX判断）

```
┌────────┬──────────────────────────────────┬──────────────────┐
│        │                                  │ コンテキストパネル │
│ サイド │      メイン（今の業務／STEP）    │  ・関連ルール      │
│  ナビ  │                                  │  ・関連ナレッジ    │
│(最小限)│   ここに「今使う部品」が出る     │  ・不足情報        │
│        │                                  │  ・派生タスク      │
│        │                                  │  ・期限            │
└────────┴──────────────────────────────────┴──────────────────┘
```
- **サイドナビは6項目まで**（HOME / 業務 / タスク / マップ / ナレッジ / 管理）。機能を並べない。
- **右のコンテキストパネルが本プロダクトの心臓部**。`core/context/resolver.ts` が
  「現在のSTEPの `componentType` と `ruleTags`」を鍵に、関係するものだけを返す。
  企業検索STEPなら企業検索ルールだけ、メール作成STEPならメールルールだけ。
- AIは常設のチャット画面を持たない。各部品の中に「AIに下書きさせる」ボタンとして埋め込む。

### 5-2. 画面一覧（Phase 1 で作る12画面）

| # | 画面 | 目的 / 主要要素 |
|---|---|---|
| ① | **HOME** | 「今日何をすればよいか」を最初の1画面で。①今日の業務 ②今日のタスク ③期限が近い業務（赤バッジ） ④進行中の業務（再開ボタン） ⑤有効な一時ルール ⑥最近の業務。上部に `＋新しい業務` |
| ② | 業務フロー一覧 | カテゴリ別カード。`開始` で Run 生成 → ③へ。管理者は `＋新しい業務フロー` |
| ③ | **業務ナビゲーター** | 中心画面。左に STEP レール（`✓済 →現在 ○未`）、中央に現在STEPの部品UI（最も目立たせる）、下部に「次にやること」1文＋主要CTA、右にコンテキストパネル。ヘッダに `株式会社○○ / CV後対応 / STEP 3 of 6` と進捗バー |
| ④ | アドホック業務作成 | 自然文入力 → AI分解結果を**編集可能なカード群**（ゴール／作業／不足情報／確認事項／ツール／完遂条件／期限／派生タスク）で提示 → ユーザーが確認して `この内容で開始` |
| ⑤ | タスク一覧 | ビュー切替（今日／今週／期限超過／業務別／派生別）。`proposed` タスクは黄色帯で「承認待ち」表示 |
| ⑥ | タスク詳細 | 派生の系譜（親タスク・派生元イベント）、依存関係、`この業務を開始` ボタン、Calendar登録 |
| ⑦ | 企業検索・選定 | 左に条件（業界／規模／地域／売上／AI導入状況／自由条件）、中央に候補テーブル（選択・除外・比較・詳細）、右にAIの候補整理コメント。**選定確定は人間のみ** |
| ⑧ | メール作成 | テンプレ選択 → 差し込みプレビュー（差し込み値の欠損を赤表示）→ AI推敲（差分表示）→ 下書き保存／送信 |
| ⑨ | 業務マップ | React Flow。ゴール → 主要タスク → 派生タスク → 依存 → 完了。一本道でないことが見て分かる。ノード色＝状態 |
| ⑩ | 業務フロー作成・編集 | React Flow ビルダー。左に部品パレット、中央にSTEPグラフ、右にSTEP設定（部品設定／完了条件／期限ルール／ナレッジ／ルールタグ／派生トリガ）。将来 `AIにフロー案を作らせる` を同画面に追加 |
| ⑪ | 一時ルール管理 | 一覧（有効／期間切れ／予約）＋作成フォーム。**プレビュー機能**「このルールは〈新規問い合わせ〉のSTEP2に3項目を追加します」を必ず付ける |
| ⑫ | 設定 | ユーザー／チーム／外部連携（Google連携ボタンはPhase1では無効表示）／AI設定 |

追加画面（Phase 4〜）: **インパクトマップ**（変更→直接影響／間接影響／確認事項の3層グラフ）、**逆算スケジューラー**（ゴール期限を入れると日程案がガントで出る）。

---

## 6. 業務フローのデータ構造

### 6-1. 実データ例（デモ1「新規問い合わせ対応」の抜粋）

```jsonc
{
  "key": "inquiry-new",
  "version": 1,
  "status": "published",
  "name": "新規問い合わせ対応",
  "description": "Webフォームからの新規問い合わせに対する初期対応",
  "category": "standard",
  "audience": { "roles": ["sales", "inside-sales"] },
  "trigger": { "type": "manual" },
  "ruleTags": ["inquiry", "sales"],
  "variables": [
    { "key": "customerId", "type": "reference", "entity": "customer", "required": true },
    { "key": "hearing",    "type": "object",    "required": true },
    { "key": "service",    "type": "string",    "required": true }
  ],
  "deadlineRule": { "type": "relative", "from": "run.startedAt", "offsetHours": 24 },
  "completionPolicy": { "requireAllRequiredSteps": true },

  "steps": [
    { "key": "confirm-customer", "title": "顧客情報確認",
      "componentType": "customer-view", "required": true,
      "config": { "customerRef": { "kind": "var", "path": "context.customerId" },
                  "showFields": ["company","contact","history","pastDeals"] },
      "knowledgeRefs": ["kb-customer-check"],
      "ruleTags": ["inquiry", "customer"] },

    { "key": "hearing", "title": "ヒアリング",
      "componentType": "checklist", "required": true,
      "config": { "items": [
          { "key": "issue",   "label": "課題", "required": true },
          { "key": "scale",   "label": "対象規模", "required": true },
          { "key": "decider", "label": "決裁者", "required": false } ],
        "outputVar": "hearing" },
      "ruleTags": ["inquiry", "hearing"],          // ← 9月限定ルールがここに刺さる
      "deadlineRule": { "offsetDays": -1, "from": "run.dueAt" } },

    { "key": "select-service", "title": "サービス選定",
      "componentType": "select", "required": true,
      "config": { "options": [
          { "value": "ai-consulting", "label": "AI導入コンサル" },
          { "value": "dev",           "label": "受託開発" },
          { "value": "training",      "label": "研修" } ],
        "outputVar": "service" },
      "knowledgeRefs": ["kb-service-matrix"] },

    { "key": "branch-budget", "title": "予算判定",
      "componentType": "branch",
      "config": { "expression": null } },          // 分岐は edges 側の condition で表現

    { "key": "compose-email", "title": "メール作成",
      "componentType": "email-compose", "required": true,
      "config": { "templateKey": "inquiry-reply",
                  "bindings": { "customer": "context.customerId",
                                "service":  "context.service" },
                  "aiAssist": { "enabled": true, "requireReview": true } },
      "ruleTags": ["email"] },

    { "key": "create-tasks", "title": "フォロータスク作成",
      "componentType": "task-create", "required": true,
      "config": { "templates": [
        { "title": "初回提案資料の準備", "offsetDays": 2, "priority": "high" },
        { "title": "1週間後フォロー",    "offsetDays": 7, "priority": "normal" } ] } },

    { "key": "done", "title": "完了", "componentType": "complete" }
  ],

  "edges": [
    { "from": "confirm-customer", "to": "hearing",        "priority": 1 },
    { "from": "hearing",          "to": "select-service", "priority": 1 },
    { "from": "select-service",   "to": "branch-budget",  "priority": 1 },
    { "from": "branch-budget",    "to": "compose-email",  "priority": 1,
      "label": "予算100万以上 → 通常対応",
      "condition": { "op": "gte", "left": { "kind": "var", "path": "context.hearing.budget" },
                                  "right": { "kind": "literal", "value": 1000000 } } },
    { "from": "branch-budget",    "to": "compose-email",  "priority": 2,
      "label": "それ以外（既定）" },
    { "from": "compose-email",    "to": "create-tasks",   "priority": 1 },
    { "from": "create-tasks",     "to": "done",           "priority": 1 }
  ]
}
```

### 6-2. 業務部品レジストリ（拡張点）

部品は `componentType` の文字列キーで登録される**プラグイン**です。
新部品の追加＝レジストリに1エントリ追加のみ。フローエンジンは部品の中身を知りません。

```ts
interface WorkComponentSpec<TConfig, TOutput> {
  type: string;                       // 'email-compose'
  label: string;                      // 'メール作成'
  icon: string;
  configSchema: ZodSchema<TConfig>;   // フロー編集画面のフォームを自動生成
  outputSchema: ZodSchema<TOutput>;
  Renderer: React.FC<StepRendererProps<TConfig, TOutput>>;
  defaultCompletion: (output, config) => boolean;
  contextHints: { ruleTags: string[]; knowledgeKinds: string[] };  // 文脈提示のヒント
  requiredPorts?: Array<'llm'|'mailer'|'calendar'|'companySearch'>;
}
registerComponent(emailComposeSpec);
```

初期16部品: `input` / `select` / `checklist` / `company-search` / `company-select` /
`customer-view` / `email-compose` / `document-compose` / `material-create` /
`task-create` / `calendar-create` / `knowledge-view` / `ai-assist` / `approval` /
`branch` / `complete`

### 6-3. フローエンジンの動作（純粋関数）

```ts
advance(def: WorkflowDefinition, run: WorkRun, stepRuns: StepRun[],
        completedStepKey: string, output: unknown)
  : { nextStepKeys: string[]; events: WorkEvent[]; runStatus: RunStatus }
```
1. 該当 StepRun を `done` に、`output` を `run.context` へ書き戻す
2. `completedStepKey` を `from` に持つ edges を `priority` 昇順で条件評価
3. 真になったエッジの `to` を活性化（複数可＝並列）
4. `completionPolicy` を評価し Run 完了判定
5. 発生した全変化を `WorkEvent[]` として返す（→ 派生エンジンへ）

---

## 7. 派生タスクのデータ構造

### 7-1. DerivationRule（派生ルール）

```jsonc
{
  "id": "dr-campaign-date-change",
  "name": "キャンペーン期間変更に伴う派生タスク",
  "enabled": true,
  "priority": 100,
  "trigger": {
    "entityType": "campaign",
    "field": "endDate",
    "changeKind": "updated",
    "condition": { "op": "neq", "left": { "kind": "var", "path": "change.before" },
                                "right": { "kind": "var", "path": "change.after" } }
  },
  "scope": { "workflowKeys": ["campaign-ops"], "teams": ["marketing", "sales"] },
  "effects": [
    { "type": "createTask", "impact": "direct",
      "template": { "title": "配信設定の期間変更",       "assigneeRole": "marketing",
                    "deadline": { "offsetDays": -10, "from": "change.after" },
                    "startableWorkflowKey": "delivery-setting-update" } },
    { "type": "createTask", "impact": "direct",
      "template": { "title": "LP掲載期間の変更",         "assigneeRole": "marketing",
                    "deadline": { "offsetDays": -8, "from": "change.after" } } },
    { "type": "createTask", "impact": "indirect",
      "template": { "title": "案内メール本文の日付確認", "assigneeRole": "marketing",
                    "deadline": { "offsetDays": -6, "from": "change.after" },
                    "dependsOnTitles": ["LP掲載期間の変更"] } },
    { "type": "createTask", "impact": "indirect",
      "template": { "title": "営業資料の記載日付確認",   "assigneeRole": "sales",
                    "deadline": { "offsetDays": -5, "from": "change.after" } } },
    { "type": "createTask", "impact": "indirect",
      "template": { "title": "関係者への変更通知",       "assigneeRole": "sales",
                    "deadline": { "offsetDays": -3, "from": "change.after" },
                    "dependsOnTitles": ["配信設定の期間変更", "LP掲載期間の変更"] } },
    { "type": "requireCheck", "impact": "check",
      "template": { "title": "契約期間との整合を確認", "note": "延長が契約範囲内か要確認" } }
  ],
  "aiAugment": { "enabled": true, "prompt": "additional-derived-tasks" }
}
```

### 7-2. 生成フロー

```
ユーザーが値を変更（9/30 → 10/15）
        ↓
   ChangeEvent 記録
        ↓
 matcher.ts: 全 DerivationRule の trigger をマッチング（決定的）
        ↓
 generator.ts: effects からタスク草案を生成
        ↓
 （任意）AI が「他に漏れている派生はないか」を追加提案     ← 補助であって主ではない
        ↓
 全て confirmationState = 'proposed' で保存
        ↓
 ★ 確認画面：ユーザーがチェックを外す／編集／期限調整 → 「この内容で作成」
        ↓
 confirmed に昇格、依存関係を張り、逆算スケジューラで期限確定
        ↓
 インパクトマップに反映
```

**重要**: 派生タスクは決して自動確定しません。必ず `proposed` を経由します。
決定的なルールで骨格を作り、AIは「抜け漏れの候補追加」だけを担当します
（AIが落ちてもシステムは機能する、という設計）。

### 7-3. インパクトグラフ

```ts
ImpactGraph {
  root: { changeEventId, label: "キャンペーン終了日 9/30 → 10/15" },
  nodes: Array<{ id, label, layer: 'direct'|'indirect'|'check',
                 entityType, taskId?, status, hop: number }>,
  edges: Array<{ from, to, kind: 'causes'|'depends'|'requires-check' }>
}
```
`hop` は根からの距離。`layer` は `direct`（hop=1）／`indirect`（hop≥2 または間接指定）／
`check`（確認事項）。React Flow で3層に配置して描画します。

---

## 8. 一時ルール（業務コンテキスト）のデータ構造

### 8-1. BusinessRule

```jsonc
{
  "id": "rule-september-inquiry",
  "name": "9月限定：問い合わせ時ヒアリング強化",
  "description": "9月の商談化率向上施策のため、初回接触時に3項目を必ず確認する",
  "ruleType": "temporary",              // case | temporary | department | standard
  "priority": 200,                      // 数値が大きいほど優先
  "enabled": true,
  "activeFrom": "2025-09-01T00:00:00+09:00",
  "activeTo":   "2025-09-30T23:59:59+09:00",
  "scope": {
    "workflowKeys": ["inquiry-new"],
    "stepRuleTags": ["hearing"],        // ← STEP の ruleTags と突合（部品横断で効かせられる）
    "componentTypes": [],
    "teams": [], "customerIds": []
  },
  "condition": null,                    // 追加の適用条件（任意）
  "effects": [
    { "type": "addChecklistItems", "items": [
        { "key": "budget",       "label": "予算を確認",           "required": true },
        { "key": "timeline",     "label": "導入時期を確認",       "required": true },
        { "key": "aiExperience", "label": "AI導入経験を確認",     "required": true } ] },
    { "type": "showNotice", "level": "info",
      "text": "9月限定ルールが適用されています（〜9/30）" }
  ],
  "createdBy": "user-admin", "createdAt": "2025-08-25T10:00:00+09:00"
}
```

### 8-2. effect の種類（拡張可能）

| type | 効果 |
|---|---|
| `addChecklistItems` | STEPにチェック項目を追加 |
| `addFields` | 入力フォームに項目追加 |
| `requireConfirmation` | 完了前に確認ダイアログを挟む |
| `replaceTemplate` | メール／文書テンプレを差し替え |
| `insertStep` | STEPを挿入（before/after 指定） |
| `changeDeadlineRule` | 期限規則を上書き |
| `attachKnowledge` | 参照ナレッジを追加 |
| `showNotice` | 注意文を表示 |
| `blockCompletion` | 条件未達なら完了させない |

### 8-3. 解決アルゴリズム（`core/rules/`）

```ts
resolveRules(input: {
  workflowKey, step: StepDefinition, run: WorkRun, now: Date, user: User
}): { applied: BusinessRule[]; conflicts: RuleConflict[]; effective: EffectiveStep }
```

1. **期間フィルタ**: `enabled && activeFrom <= now <= activeTo`
   → **期間終了後は自動的に対象外**。無効化バッチもフラグ更新も不要
2. **スコープフィルタ**: `workflowKeys` / `stepRuleTags` / `componentTypes` / `teams` / `customerIds` を突合
3. **条件評価**: `condition` を Run コンテキストで評価
4. **優先順位ソート**（仕様どおり4段階）
   1. `case`（個別案件ルール）— priority 300帯
   2. `temporary`（期間限定ルール）— 200帯
   3. `department`（部署ルール）— 100帯
   4. `standard`（標準業務フロー）— 0帯（＝定義そのもの）
   同帯内は `priority` 数値、同値なら `createdAt` 新しい方
5. **競合検出**: 同一ターゲット（同じフィールド／同じテンプレ／同じ期限）に対して
   異なる値を設定する effect が2つ以上 → `RuleConflict` を生成。
   高優先が勝つが、**`severity: 'high'` の競合はUI上部に警告バナーを出す**
   （例: 「個別案件ルールが期間限定ルールの期限指定を上書きしています」）
6. **オーバーレイ合成**: 低優先→高優先の順に `StepDefinition` へ effect を適用し `EffectiveStep` を返す

### 8-4. コンテキスト表示（§16の思想の実装）

`core/context/resolver.ts` が、現在のSTEPに対して以下**だけ**を返します。

```ts
StepContext {
  rules:     BusinessRule[];   // step.ruleTags ∩ rule.scope.stepRuleTags のみ
  knowledge: KnowledgeItem[];  // step.knowledgeRefs + componentType 一致のみ
  missingInfo: MissingField[]; // 完了条件から逆算した不足
  derivedTasks: Task[];        // このRun/STEP由来のもののみ
  deadline: { dueAt, remaining, isOverdue };
  tools: ToolRef[];            // componentType.requiredPorts から導出
}
```
企業検索STEPなら企業検索ルールだけ、メール作成STEPならメールルールだけが出ます。
**ルール一覧を全部見せる画面は「管理画面」だけ**で、業務中は絶対に出しません。

---

## 9. AIを利用する箇所

**原則**: AIは「主役」ではなく「下書き係」。決定的ロジック（フローエンジン・ルール解決・
逆算スケジューラ）が骨格を作り、AIはその周辺の自然言語処理を担当します。
**AIが停止してもプラットフォームは動く**ことを設計要件とします。

| # | 用途 | 入力 | 出力（構造化） | 確認 | フォールバック |
|---|---|---|---|---|---|
| 1 | **業務分解**（アドホック） | 自然文 + 既存フローカタログ | ゴール/作業/不足情報/確認事項/ツール/完遂条件/期限/派生タスク | **必須** | 空テンプレを手入力 |
| 2 | **不足情報検出** | Run context + 完了条件 | `MissingField[]`（項目名・理由・確認先） | 必須 | 必須変数の未充足を機械的に列挙（AI無しでも動く） |
| 3 | **確認事項の文面生成** | 不足情報 + 宛先種別 | 件名 + 本文 | **必須（送信前）** | テンプレ文 |
| 4 | **メール／文章生成・推敲** | テンプレ + 差し込み値 + トーン | 件名 + 本文（差分表示） | **必須（送信前）** | テンプレそのまま |
| 5 | **企業情報の整理・要約** | 検索結果 | 要約・比較軸・スコア根拠 | 参考表示 | 生データ表 |
| 6 | **検索結果の絞り込み提案** | 候補 + 選定条件 | 推奨候補 + 理由 | **選定は人間のみ** | 条件ソート |
| 7 | **派生タスク候補の追加** | ChangeEvent + 既存派生 | 追加タスク草案 | **必須** | 決定的ルールの結果のみ |
| 8 | **変更影響分析** | ChangeEvent + 関連エンティティ | 影響先候補 + 確認事項 | **必須** | 決定的ルールのグラフのみ |
| 9 | **業務フロー案の生成**（Phase 8） | 業務説明の自然文 | WorkflowDefinition 草案 | **必須（draft 保存）** | 手動作成 |
| 10 | 逆算スケジュールの妥当性コメント | 生成済みスケジュール | 警告・所要時間の指摘 | 参考表示 | なし |

### 9-1. 実装方針

- 全出力は **Zod スキーマ → Claude の tool use 定義に変換** して構造化取得。自由文パースはしない
- 全提案は `AiSuggestion` レコードとして保存（`pending` → `accepted`/`edited`/`rejected`）。
  採択率をログして品質改善に使う
- `src/ai/guard.ts` が「この kind は確認必須か」を一元判定。
  **確認必須の提案は、サービス層が確認なしにコミットできない**よう型で強制する
  （`Confirmed<T>` ブランド型を経由しないと永続化関数を呼べない）
- プロンプトとスキーマは `src/ai/` に集約。UI・ドメインにプロンプト文字列を書かない
- Phase 1〜7 は `MockLlmAdapter`（seed に決め打ち応答）で全画面が動く状態を維持

---

## 10. 実装フェーズ

指示書の Phase 1〜8 を土台に、前段に **Phase 0（基盤）** を追加します。
各フェーズ末で「動く状態」を保ち、モック→実接続の差し替えは最後に集中させます。

| Phase | 内容 | 主な成果物 | 完了条件 |
|---|---|---|---|
| **0** | 基盤構築 | Next.js/TS/Tailwind 初期化、`core/model` の Zod スキーマ全定義、`ports/` インターフェース、`adapters/memory`、DIコンテナ、seed ローダ、CI | 型とインターフェースが確定し、`pnpm test` が通る |
| **1** | UI/UX と基本ナビゲーション | レイアウト、サイドナビ、コンテキストパネル枠、HOME、業務フロー一覧、タスク一覧/詳細、設定。デザインシステム | 静的データで全画面が遷移できる |
| **2** | **業務フローエンジン** | `core/flow`（遷移・条件・完了）、部品レジストリ + 初期16部品、業務ナビゲーター画面、フロー作成/編集（React Flow）、デモ3業務の seed | デモ3業務が最初から最後まで実行でき、新フローをGUIで追加できる |
| **3** | アドホック業務 | 自然文入力 → 分解結果確認UI → Run 生成、不足情報検出、確認事項生成（モックLLM） | 「展示会で集めた企業から20社選定して」が Run として起動する |
| **4** | 派生タスク・インパクトマップ | `core/derivation`、`core/impact`、ChangeEvent 記録、派生タスク確認UI、インパクトマップ画面、業務マップ画面、`core/schedule`（逆算） | 「キャンペーン終了日 9/30→10/15」で5派生タスク＋確認事項が提案され、10/15から逆算した期限が付く |
| **5** | 業務コンテキスト・一時ルール | `core/rules`（解決・優先順位・競合・オーバーレイ）、ルール管理画面、ルールプレビュー、コンテキストパネル本実装 | 「9月限定ルール」が新規問い合わせのヒアリングSTEPに自動で3項目を追加し、10/1に自動で消える |
| **6** | 企業検索・メール作成・文章作成 | 企業検索/選定画面（seedデータ）、選定理由記録、メールテンプレ管理・差し込み・プレビュー、文章作成 | デモ3（企業リサーチ）が検索→選定→メール→タスクまで通る |
| **7** | Calendar・外部API・永続化 | Supabase スキーマ + `adapters/supabase`、Supabase Auth、Google OAuth、Calendar 双方向同期、Gmail 下書き、Drive ナレッジ取込 | `ADAPTER=supabase` でUI無改修のまま本番データで動作 |
| **8** | AI連携 | Claude API 接続、tool use 構造化出力、AiSuggestion 管理、10用途の実装、フロー案生成 | モックLLMを実LLMに差し替えるだけで全AI機能が動作 |

### 10-1. 各フェーズ共通の受け入れ基準

1. **ハードコード禁止チェック**: 業務名・STEP名・ルール内容がコード内に文字列で存在しないこと（seed/DB のみ）
2. `src/core/` が `react` / `next` / DB / SDK を import していないこと（ESLint の import 制限で機械的に強制）
3. 新しいSTEP部品・新しい業務フロー・新しいルールが**コード変更なしに**追加できること

### 10-2. デモシナリオ（Phase 2/4/5 の検証に使用）

- **デモ1** 新規問い合わせ: 問い合わせ→顧客情報確認→ヒアリング→サービス選定→メール作成→タスク作成→完了
- **デモ2** CV後対応: CV→お礼メール→資料送付→フォロー日設定→Calendar登録→完了
- **デモ3** 企業リサーチ: 条件入力→企業検索→候補表示→人間による選定→企業登録→メール作成→タスク作成→完了
- **デモ4** アドホック: 「展示会で集めた企業から営業できそうな企業を20社選定して」
- **デモ5** 一時ルール: 「9月限定ルール」がデモ1のヒアリングSTEPに反映される
- **デモ6** 派生タスク: 「キャンペーン終了日 9/30→10/15」で派生5件＋逆算スケジュール

---

## 11. 主要な設計上のリスクと対処

| リスク | 対処 |
|---|---|
| 業務フローを汎用化しすぎて、GUIでフローが作れないほど複雑になる | 部品の `configSchema` からフォームを自動生成し、編集UIの実装コストを部品側に閉じる |
| ルールのオーバーレイが増えると、実際に出る画面が予測不能になる | ルール管理画面に**プレビュー**（「このルールは〈どのフロー〉の〈どのSTEP〉に〈何を〉するか」）を必須実装。StepRun に `appliedRuleIds` を記録し、事後に「なぜこの項目が出たか」を追跡可能にする |
| 派生タスクが大量生成されてノイズになる | 全て `proposed` 経由。一括チェック解除UI。派生ルールに `scope` を必須化 |
| 逆算スケジュールが依存循環で計算不能 | `topology.ts` で循環検出し、該当箇所をUIで明示（React Flow の赤ハイライト） |
| モックからSupabaseへの移行が大工事になる | Phase 0 で `ports/` を先に確定させ、`adapters/memory` も同じインターフェースで実装。Phase 7 は adapter 追加のみ |
| AIの出力が不安定でUXを壊す | 骨格は決定的ロジック。AIは補助のみ。全て確認ゲート経由。モックLLMで全機能が動く状態を常に維持 |

---

## 12. 次のアクション（承認をいただき次第）

1. Phase 0 の実行：Next.js 初期化 + `core/model` の Zod スキーマ全定義 + `ports/` 確定
2. Phase 1 の実行：レイアウト・HOME・一覧系画面
3. Phase 2 の実行：フローエンジン + 業務部品 + ナビゲーター + デモ3業務

ご確認いただきたい点：

- **技術スタック**（特に Supabase / Drizzle / React Flow / Claude API）の採否
- **フェーズの優先順位**（デモの説得力を早く出すなら Phase 4・5 を 3 より前倒しする案もあります）
- **想定利用者**（管理者がフローを作る／現場が使う、の2ロールで進めてよいか）
- **初期スコープ**：Phase 1〜5（エンジンとデモが全て動く状態）を最初のマイルストーンとしてよいか
