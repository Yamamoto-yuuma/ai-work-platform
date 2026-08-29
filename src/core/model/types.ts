/**
 * ドメインモデル定義。
 *
 * このファイルは framework 非依存。React / Next.js / DB / LLM に一切依存しない。
 * 仕様書 docs/SPECIFICATION.md §24 に対応する。
 */

// ---------------------------------------------------------------------------
// 条件式 — データとして保存・編集可能。JS の eval は使わない（仕様 §24-3-5）
// ---------------------------------------------------------------------------

export type ValueRef =
  | { kind: "literal"; value: unknown }
  | { kind: "var"; path: string }
  | { kind: "now" };

export type ComparisonOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "in" | "contains" | "exists" | "isEmpty";

export type ConditionExpr =
  | { op: ComparisonOp; left: ValueRef; right?: ValueRef }
  | { op: "and"; operands: ConditionExpr[] }
  | { op: "or"; operands: ConditionExpr[] }
  | { op: "not"; operand: ConditionExpr };

// ---------------------------------------------------------------------------
// 期限ルール
// ---------------------------------------------------------------------------

export type DeadlineAnchor = "run.startedAt" | "run.dueAt" | "now" | "change.after";

export interface DeadlineRule {
  from: DeadlineAnchor;
  offsetDays?: number;
  offsetHours?: number;
  businessDaysOnly?: boolean;
}

// ---------------------------------------------------------------------------
// 業務部品（STEP の中身）
// ---------------------------------------------------------------------------

export type WorkComponentType =
  | "input"
  | "select"
  | "checklist"
  | "customer-view"
  | "company-search"
  | "company-select"
  | "email-compose"
  | "document-compose"
  | "task-create"
  | "calendar-create"
  | "knowledge-view"
  | "ai-assist"
  | "approval"
  | "branch"
  | "complete";

// ---------------------------------------------------------------------------
// 業務フロー定義
// ---------------------------------------------------------------------------

export type WorkflowStatus = "draft" | "published" | "archived";

export interface VariableDef {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "date" | "object" | "reference";
  entity?: string;
  required: boolean;
  /**
   * マスタから初期値を導出できる場合の宣言（仕様 §8）。
   * 業務ごとの決め打ちをコードに書かないための入口。
   * 導出された値はあくまで初期値で、ユーザーは変更できる（変更時は差異を提示する）。
   */
  derivedFrom?: {
    entity: "customer";
    field: string;
    /** マスタ値（文字列化したもの）→ 業務上の値 */
    map: Record<string, string>;
  };
}

export interface StepDefinition {
  key: string;
  title: string;
  description?: string;
  /** このSTEPで何をするかの説明文。ナビゲーターに常時表示する */
  guidance: string;
  componentType: WorkComponentType;
  config: Record<string, unknown>;
  required: boolean;
  estimatedMinutes?: number;
  deadlineRule?: DeadlineRule;
  /** このSTEPで提示するナレッジ */
  knowledgeRefs?: string[];
  /** 一時ルールを引き当てるためのタグ（仕様 §5-1） */
  ruleTags?: string[];
  /** このSTEPで発火しうる派生ルール */
  derivationTriggers?: string[];
  completionCriteria?: ConditionExpr;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  condition?: ConditionExpr;
  priority: number;
  /** 合流ポリシー。all = 先行STEPが全て完了するまで待つ */
  joinPolicy?: "any" | "all";
}

export interface WorkflowDefinition {
  key: string;
  version: number;
  status: WorkflowStatus;
  name: string;
  description: string;
  category: string;
  audience: { roles: string[]; teams: string[] };
  variables: VariableDef[];
  steps: StepDefinition[];
  edges: FlowEdge[];
  completionPolicy: { requireAllRequiredSteps: boolean; condition?: ConditionExpr };
  deadlineRule?: DeadlineRule;
  ruleTags: string[];
  derivationRuleIds: string[];
  estimatedMinutes?: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 業務実行
// ---------------------------------------------------------------------------

export type RunStatus = "active" | "paused" | "blocked" | "done" | "canceled";
export type StepRunStatus = "pending" | "active" | "done" | "skipped" | "blocked";

export interface StepRun {
  stepKey: string;
  status: StepRunStatus;
  output: Record<string, unknown>;
  checklistState: Record<string, boolean>;
  /** どのルールが効いた状態で完了したか（仕様 §14-9） */
  appliedRuleIds: string[];
  startedAt?: string;
  completedAt?: string;
  note?: string;
}

export interface RunSubject {
  type: "customer" | "company" | "campaign" | "article" | "none";
  id?: string;
  label: string;
}

export interface WorkRun {
  id: string;
  workflowKey: string;
  /** 開始時点の定義バージョンを固定する（仕様 §7-3） */
  workflowVersion: number;
  title: string;
  subject: RunSubject;
  status: RunStatus;
  currentStepKeys: string[];
  context: Record<string, unknown>;
  assigneeId: string;
  dueAt?: string;
  startedAt: string;
  completedAt?: string;
  source: "standard" | "adhoc";
  /**
   * 待ち（status === "paused"）のときだけ入る。
   * 相手の状態を管理するものではなく、自分から見た「何を待っているか」。
   */
  waitingFor?: string;
  /** 自分が次に確認する日。この日が来ると HOME の「今日確認する」に出る */
  waitingUntil?: string;
}

// ---------------------------------------------------------------------------
// イベント — 全ての状態変化の記録（仕様 §24-3-3）
// ---------------------------------------------------------------------------

export type WorkEventType =
  | "run.started" | "run.completed" | "run.canceled"
  | "run.paused" | "run.resumed"
  | "step.completed" | "step.reopened" | "step.skipped"
  | "field.changed" | "task.created" | "task.confirmed" | "rule.applied";

export interface WorkEvent {
  id: string;
  runId?: string;
  taskId?: string;
  type: WorkEventType;
  actor: string;
  payload: Record<string, unknown>;
  causedByEventId?: string;
  createdAt: string;
}

/** 値の変更。派生タスク生成の唯一の入力（仕様 §10-3） */
export interface ChangeEvent {
  id: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  field: string;
  fieldLabel: string;
  before: unknown;
  after: unknown;
  reason?: string;
  actor: string;
  occurredAt: string;
  runId?: string;
}

// ---------------------------------------------------------------------------
// タスク
// ---------------------------------------------------------------------------

export type TaskStatus = "todo" | "doing" | "blocked" | "waiting-approval" | "done" | "canceled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskSource = "manual" | "flow" | "derived" | "ai" | "schedule";
/** 自動生成は proposed を経由する（仕様 §9-3 / §10-6） */
export type ConfirmationState = "confirmed" | "proposed" | "rejected";
export type ImpactLayer = "direct" | "indirect" | "check";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  dueAt?: string;
  estimatedMinutes?: number;
  runId?: string;
  stepKey?: string;
  startableWorkflowKey?: string;
  parentTaskId?: string;
  originEventId?: string;
  derivationRuleId?: string;
  source: TaskSource;
  confirmationState: ConfirmationState;
  impactLayer?: ImpactLayer;
  dependsOn: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 一時ルール（仕様 §14）
// ---------------------------------------------------------------------------

export type RuleType = "case" | "temporary" | "department" | "standard";

export interface RuleScope {
  workflowKeys: string[];
  stepRuleTags: string[];
  componentTypes: WorkComponentType[];
  teams: string[];
}

export type RuleEffect =
  | { type: "addChecklistItems"; items: { key: string; label: string; required: boolean }[] }
  | { type: "addFields"; fields: { key: string; label: string; required: boolean }[] }
  | { type: "showNotice"; level: "info" | "warn"; text: string }
  | { type: "attachKnowledge"; knowledgeIds: string[] }
  | { type: "requireConfirmation"; text: string }
  | { type: "blockCompletion"; condition: ConditionExpr; message: string };

export interface BusinessRule {
  id: string;
  name: string;
  description: string;
  ruleType: RuleType;
  priority: number;
  enabled: boolean;
  activeFrom: string;
  activeTo?: string;
  scope: RuleScope;
  condition?: ConditionExpr;
  effects: RuleEffect[];
  createdBy: string;
  createdAt: string;
}

/** ルール適用後の STEP（仕様 §14-4 オーバーレイ合成の結果） */
export interface EffectiveStep extends StepDefinition {
  extraChecklistItems: { key: string; label: string; required: boolean; ruleId: string }[];
  extraFields: { key: string; label: string; required: boolean; ruleId: string }[];
  notices: { level: "info" | "warn"; text: string; ruleId: string; ruleName: string }[];
  extraKnowledgeIds: string[];
  appliedRules: BusinessRule[];
}

export interface RuleConflict {
  severity: "high" | "low";
  target: string;
  winnerRuleId: string;
  loserRuleId: string;
  message: string;
}

// ---------------------------------------------------------------------------
// 派生ルール（仕様 §10-4）
// ---------------------------------------------------------------------------

export interface DerivedTaskTemplate {
  ref: string;
  title: string;
  description?: string;
  assigneeRole: string;
  impact: ImpactLayer;
  deadline?: DeadlineRule;
  /** ref による依存指定。タイトル文字列では張らない */
  dependsOnRefs?: string[];
  startableWorkflowKey?: string;
  priority?: TaskPriority;
}

export interface DerivationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  trigger: {
    entityType: string;
    field: string;
    /** 画面に出す項目名。未指定なら field をそのまま使う */
    fieldLabel?: string;
    changeKind: "updated" | "created" | "deleted";
    condition?: ConditionExpr;
  };
  scope: { workflowKeys: string[]; teams: string[] };
  effects: DerivedTaskTemplate[];
}

// ---------------------------------------------------------------------------
// ナレッジ / テンプレート / マスタ
// ---------------------------------------------------------------------------

export interface KnowledgeItem {
  id: string;
  title: string;
  body: string;
  kind: "manual" | "faq" | "policy" | "material";
  source: "internal" | "gdrive" | "notion";
  tags: string[];
  linkedStepKeys: string[];
  linkedWorkflowKeys: string[];
  updatedAt: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  workflowKeys: string[];
  tone: string;
}

export interface Customer {
  id: string;
  name: string;
  contactName: string;
  industry: string;
  employeeCount: number;
  isExisting: boolean;
  lastContactAt?: string;
  note?: string;
}

export interface Company {
  id: string;
  name: string;
  industry: string;
  employeeCount: number;
  region: string;
  revenue: string;
  aiAdoption: "none" | "considering" | "partial" | "advanced";
}

export interface User {
  id: string;
  name: string;
  roles: ("executor" | "designer" | "admin" | "viewer")[];
  team: string;
}

// ---------------------------------------------------------------------------
// 文脈提示（仕様 §15）
// ---------------------------------------------------------------------------

export interface MissingField {
  key: string;
  label: string;
  reason: string;
}

export interface DeadlineView {
  dueAt: string;
  remainingLabel: string;
  isOverdue: boolean;
}

export interface StepContext {
  rules: BusinessRule[];
  notices: EffectiveStep["notices"];
  knowledge: KnowledgeItem[];
  /** 業務完遂に必要だが、まだ取得できていない業務情報（仕様 §8-5） */
  missingInfo: MissingField[];
  derivedTasks: Task[];
  /** 業務全体の期限 */
  deadline?: DeadlineView;
  /** このSTEPの期限（仕様 §15-2）。deadlineRule が無い STEP では未設定 */
  stepDeadline?: DeadlineView;
  tools: { label: string; available: boolean; reason?: string }[];
  conflicts: RuleConflict[];
}

// ---------------------------------------------------------------------------
// 次の一手（仕様 §4-3 / レビュー指摘 Q2）
// ---------------------------------------------------------------------------

export type NextActionKind =
  | "step"
  /** 待ち中の業務で、自分が決めた確認日が来たもの */
  | "check"
  | "task"
  | "review-proposals"
  | "idle";

export interface NextAction {
  kind: NextActionKind;
  /** 「次にやること」1文 */
  headline: string;
  reason: string;
  runId?: string;
  stepKey?: string;
  taskId?: string;
  dueAt?: string;
  urgency: "overdue" | "today" | "soon" | "normal";
}
