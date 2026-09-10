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
  /** このSTEPに入る前に済んでいるべきこと。ナビゲーターに注意として出す */
  preconditions?: string;
  /*
    このSTEPを終えたあとに見ておくこと（仕様 §9-1 の拡張）。

    「必ず通る手順」でも「条件で分かれる道」でもない、
    “たぶん大丈夫だが、見ておかないと事故る” たぐいの作業を置く。
    例：自動送信のあとに、エラーが出ていないかを翌日に確認する。

    STEPにはしない。STEPにすると、毎回そこで手が止まる。
    完了した時点でタスクとして切り出し、期日が来たら一覧に出す。
  */
  followUps?: StepFollowUp[];
}

/** STEP完了後の「あとで見ておくこと」 */
export interface StepFollowUp {
  /** 何を見るか。タスク名になる */
  label: string;
  /** 完了から何日後に見るか。0 なら当日 */
  afterDays: number;
  /** 暦日ではなく営業日で数える */
  businessDaysOnly?: boolean;
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

// ---------------------------------------------------------------------------
// 業務の性質・開始条件・目標（仕様 §28）
//
// すべて任意項目。既存のシード定義は未設定のまま動く。
// 「どんな業務か」を人が登録できるようにするための、データとしての語彙。
// ---------------------------------------------------------------------------

/** 業務タイプ。定型＝決まった間隔で繰り返す、発生型＝出来事をきっかけに始まる */
export type WorkKind = "routine" | "reactive" | "term" | "urgent" | "other";

export type StartTriggerKind =
  | "manual"
  | "date"
  | "weekday"
  | "time"
  | "event"
  | "after-workflow"
  | "task"
  | "condition";

/**
 * 業務の開始条件。
 * 自動で業務を始めてしまうことはせず、「開始待ち」として提示するだけにする。
 * 判断はあくまで自分が行う（個人利用前提／仕様 §26）。
 */
export interface StartTrigger {
  kind: StartTriggerKind;
  /** date: この日に開始する（YYYY-MM-DD） */
  date?: string;
  /** weekday: 開始する曜日（0=日 … 6=土） */
  weekdays?: number[];
  /** time: この時刻以降に開始する（HH:mm）。毎日が対象 */
  time?: string;
  /** event: きっかけになる出来事。自分の言葉で書く */
  eventLabel?: string;
  /** after-workflow: この業務が完了したら開始する */
  afterWorkflowKey?: string;
  /** task: きっかけになるタスク */
  taskLabel?: string;
  /** condition: データとして保存された条件式 */
  condition?: ConditionExpr;
  note?: string;
}

/**
 * 繰り返しの型。
 * 「いつ」を表すだけで、時刻は持たない。時刻は StartSchedule 側にある。
 */
export type StartScheduleRepeat =
  /** 毎日 */
  | { kind: "daily" }
  /** 毎週。0=日 … 6=土 */
  | { kind: "weekly"; weekdays: number[] }
  /** 毎月の指定日。1〜31。その月に無い日は月末に寄せる（31日→2月28日） */
  | { kind: "monthly-day"; day: number }
  /** 毎月の月末 */
  | { kind: "monthly-last" };

/**
 * 業務を始める日時のスケジュール（1業務に複数）。
 *
 * 1つの業務に複数の周期を持たせるためのもの。
 * 例：週2回の定例と、月末の締めを同じ業務に並べて持たせる。
 *
 * これが来ても業務を勝手に始めない。「今日始める業務」として
 * 提示するところまでで、始めるかどうかは自分が決める（仕様 §26）。
 */
export interface StartSchedule {
  /** 定義の中で一意。編集しても変えない */
  id: string;
  /** 自分でつける呼び名。空なら繰り返しの説明をそのまま出す */
  label?: string;
  repeat: StartScheduleRepeat;
  /** この時刻以降に提示する（HH:mm） */
  time: string;
  /** 外しても消さずに残しておけるようにする */
  enabled: boolean;
}

/** ノルマ・目標（仕様 §28-3）。件数と時間の2系統だけを持つ */
export interface WorkQuota {
  /** count = ○件、hours = ○時間 */
  metric: "count" | "hours";
  period: "day" | "week" | "month" | "quarter" | "year";
  target: number;
  /** atLeast = ○件以上こなす、atMost = ○時間以内に収める */
  direction: "atLeast" | "atMost";
  note?: string;
}

/**
 * 優先度の時間変化（仕様 §28-4）。
 * 「7日前は通常、2日前は高、超過したら緊急」のような段階をデータで持つ。
 * 残り日数が withinDays 以下になったら priority まで引き上げる。
 */
export interface PriorityEscalation {
  steps: { withinDays: number; priority: TaskPriority }[];
}

/**
 * 業務に後から足せる詳細（仕様 §28-5）。すべて任意。
 * 登録時に全部埋めさせない。運用しながら育てるための置き場。
 */
export interface WorkflowNotes {
  cautions?: string;
  specialRules?: string;
  exceptions?: string;
  emergency?: string;
  criteria?: string;
  aiInstruction?: string;
  memo?: string;
  tools?: string[];
  materials?: string[];
  companies?: string[];
  knowledgeIds?: string[];
  checkItems?: string[];
  faq?: { q: string; a: string }[];
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

  // --- 以下はすべて任意。未設定でも既存の動作は変わらない ---
  /** どんな性質の業務か */
  workKind?: WorkKind;
  /**
   * いつ始める業務か。
   * 繰り返しの予定は startSchedules 側に置く。ここは1回きりの日付や、
   * 出来事きっかけなど、周期を持たない開始条件を表す。
   */
  startTrigger?: StartTrigger;
  /**
   * 繰り返しの開始予定。1つの業務に何本でも持てる。
   * 同じ日に複数が重なっても、開始の機会は1つにまとめる
   * （core/workflow/start-schedule.ts の startOccasion）。
   */
  startSchedules?: StartSchedule[];
  /** この業務から生まれる作業の既定の優先度 */
  defaultPriority?: TaskPriority;
  /** 期限が近づいたときの優先度の上げ方 */
  priorityEscalation?: PriorityEscalation;
  /** ノルマ・目標 */
  quota?: WorkQuota;
  /** 注意事項・判断基準など、後から足せる詳細 */
  notes?: WorkflowNotes;
  /*
    この業務を終えたあとに見ておくこと。
    STEPごとの followUps と同じ仕組みだが、こちらは業務が完了した
    時点で切り出す。分岐でどの道を通っても最後に必ず通るので、
    「この業務をやったら、あとでこれを見る」を確実に残せる。
  */
  followUps?: StepFollowUp[];
  /** どこから来た定義か。user = 自分で登録した */
  origin?: "seed" | "user";
  /** 複製元の業務。テンプレートとして使った履歴 */
  copiedFromKey?: string;
  createdAt?: string;
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
  /** 自分が次に確認する日。この日が来ると HOME の「要確認」に出る */
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
export type TaskSource = "manual" | "flow" | "derived" | "ai" | "schedule" | "external";
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
  /*
    完了した時刻。
    完了したタスクは一覧から外して「完了」に寄せているので、
    いつ終わったかが無いと並べ替えられず、今週やったことも数えられない。
    書き込むのは store の updateTask 1か所だけ（完了にする経路は
    一覧のチェック・詳細・取り込み・繰り返しと複数あり、
    どれかで付け忘れるとそのぶん抜ける）。
  */
  completedAt?: string;
  /*
    繰り返し。業務の開始スケジュールと同じ語彙を使う。
    次の1件は完了にした時に作る（core/task/repeat.ts）。
    先の分まで作り置きしない。並べると、いま抱えている量が分からなくなる。
  */
  repeat?: StartScheduleRepeat;
  /** 完了時に作った次の1件。同じタスクから2件目を作らないための目印 */
  repeatNextTaskId?: string;
  /** どの回から生まれたか。ひとつ前をたどれるようにしておく */
  repeatFromTaskId?: string;
  /*
    外から取り込んだタスク（Google ToDo リストなど）。
    向こうで作られたものなので、こちらでは持ち主を名乗らない。
    externalUpdatedAt は「前回取り込んだ時点の、向こうの更新時刻」。
    これがあるので、向こうが動いていないのにこちらの変更を
    上書きしてしまう、という事故を防げる。
  */
  external?: ExternalOrigin;
}

/** 取り込み元。いまは Google ToDo リストだけ */
export interface ExternalOrigin {
  service: "google-tasks";
  /** 向こうでの id。取り込み直しても二重に増やさないための鍵 */
  id: string;
  /** 向こうのリスト（ToDo リストは複数持てる） */
  listId: string;
  /** 前回取り込んだ時点の、向こうの更新時刻（RFC3339） */
  updatedAt: string;
  /** 向こうの画面で開くための入口 */
  url?: string;
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
  /*
    どこにあるものか。置き場所の URL から決まる（knowledge-link.ts）。
    人に選ばせない。URL を貼れば分かることを、もう一度聞かない。
  */
  source: "internal" | "gdrive" | "notion" | "notebooklm";
  tags: string[];
  linkedStepKeys: string[];
  linkedWorkflowKeys: string[];
  updatedAt: string;
  /*
    置き場所。「テンプレはどこにあるか」を残すための欄。
    URL でも、共有フォルダのパスでも、棚の場所でもよい。
    http(s) のときだけ開ける形にして、それ以外は写せる文字として出す。
    形式を縛ると、書けないものが出てきて結局どこにも残らない。
  */
  location?: string;
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
