/** 進行中の業務・タスク・変更イベントのシード。日付は起動日基準で相対生成する */
import type { ChangeEvent, StepRun, Task, WorkRun } from "../src/core/model/types";

const DAY = 24 * 60 * 60 * 1000;
const base = () => new Date();
const shift = (days: number, hour = 18): string => {
  const d = new Date(base().getTime() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

function stepRun(stepKey: string, status: StepRun["status"], output: Record<string, unknown> = {}, checklist: Record<string, boolean> = {}): StepRun {
  return {
    stepKey, status, output, checklistState: checklist, appliedRuleIds: [],
    startedAt: status !== "pending" ? shift(-1, 10) : undefined,
    completedAt: status === "done" ? shift(-1, 11) : undefined,
  };
}

export const runs: WorkRun[] = [
  {
    id: "run-001",
    workflowKey: "inquiry-new",
    workflowVersion: 1,
    title: "新規問い合わせ対応",
    subject: { type: "customer", id: "cus-001", label: "株式会社アオイ製作所" },
    status: "active",
    // ヒアリングSTEPで停止中（9月限定ルールが刺さる位置）
    currentStepKeys: ["hearing"],
    context: { customerId: "cus-001", customerType: "new", employeeCount: 300, inquiryKind: "service" },
    assigneeId: "user-me",
    dueAt: shift(0, 18),
    startedAt: shift(-1, 9),
    source: "standard",
  },
  {
    id: "run-002",
    workflowKey: "post-cv",
    workflowVersion: 1,
    title: "CV後フォロー",
    subject: { type: "customer", id: "cus-004", label: "ハシモト会計事務所" },
    status: "active",
    currentStepKeys: ["send-material"],
    context: { customerId: "cus-004" },
    assigneeId: "user-me",
    dueAt: shift(1, 18),
    startedAt: shift(-1, 14),
    source: "standard",
  },
  {
    id: "run-003",
    workflowKey: "article-writing",
    workflowVersion: 1,
    title: "記事作成：製造業のAI活用事例",
    subject: { type: "article", id: "art-001", label: "製造業のAI活用事例" },
    status: "active",
    // 並列STEP（原稿作成と画像手配が同時にactive）
    currentStepKeys: ["draft", "prepare-image"],
    context: { theme: "製造業のAI活用事例", articleType: "column", audience: "製造業の情報システム部門" },
    assigneeId: "user-me",
    dueAt: shift(6, 18),
    startedAt: shift(-3, 10),
    source: "standard",
  },
  {
    id: "run-004",
    workflowKey: "company-research",
    workflowVersion: 1,
    title: "企業リサーチ：運輸業界",
    subject: { type: "none", label: "運輸業界 20社選定" },
    status: "active",
    currentStepKeys: ["select"],
    context: { conditions: { industry: "運輸", targetCount: 20 } },
    assigneeId: "user-me",
    dueAt: shift(3, 18),
    startedAt: shift(-2, 11),
    source: "standard",
  },
  {
    id: "run-005",
    workflowKey: "inquiry-new",
    workflowVersion: 1,
    title: "新規問い合わせ対応",
    subject: { type: "customer", id: "cus-002", label: "みどりリテール株式会社" },
    status: "done",
    currentStepKeys: [],
    context: { customerId: "cus-002", customerType: "existing", employeeCount: 1000, inquiryKind: "service", service: "training" },
    assigneeId: "user-me",
    dueAt: shift(-4, 18),
    startedAt: shift(-6, 9),
    completedAt: shift(-5, 16),
    source: "standard",
  },
];

export const stepRunsByRun: Record<string, StepRun[]> = {
  "run-001": [
    stepRun("receive", "done"),
    stepRun("classify-inquiry", "done", { inquiryKind: "service" }),
    stepRun("confirm-customer", "done", { customerType: "new", employeeCount: 300 }),
    stepRun("branch-customer", "done"),
    // 新規顧客のため、既存取引の確認は条件によりスキップされている
    stepRun("check-history", "skipped"),
    stepRun("required-info", "done", {}, { purpose: true, target: true, deadline: true }),
    stepRun("hearing", "active", {}, { issue: true }),
    stepRun("select-service", "pending"),
    stepRun("branch-scale", "pending"),
    stepRun("compose-email", "pending"),
    stepRun("send", "pending"),
    stepRun("create-tasks", "pending"),
    stepRun("done", "pending"),
  ],
  "run-002": [
    stepRun("cv", "done"),
    stepRun("thanks-mail", "done"),
    stepRun("send-material", "active", {}, { "select-doc": true }),
    stepRun("set-follow", "pending"),
    stepRun("calendar", "pending"),
    stepRun("done", "pending"),
  ],
  "run-003": [
    stepRun("plan", "done", { theme: "製造業のAI活用事例", audience: "製造業の情報システム部門" }),
    stepRun("select-type", "done", { articleType: "column" }),
    stepRun("branch-type", "done"),
    stepRun("interview", "skipped"),
    stepRun("draft", "active"),
    stepRun("prepare-image", "active", {}, { eyecatch: true }),
    stepRun("review", "pending"),
    stepRun("publish", "pending"),
    stepRun("done", "pending"),
  ],
  "run-004": [
    stepRun("conditions", "done", { industry: "運輸", targetCount: 20 }),
    stepRun("search", "done"),
    stepRun("select", "active"),
    stepRun("register", "pending"),
    stepRun("compose-email", "pending"),
    stepRun("create-tasks", "pending"),
    stepRun("done", "pending"),
  ],
  "run-005": [
    stepRun("receive", "done"), stepRun("classify-inquiry", "done", { inquiryKind: "service" }),
    stepRun("confirm-customer", "done"),
    stepRun("branch-customer", "done"), stepRun("check-history", "done"),
    stepRun("required-info", "done"), stepRun("hearing", "done"),
    stepRun("select-service", "done"), stepRun("branch-scale", "done"),
    stepRun("approval", "done"), stepRun("compose-email", "done"),
    stepRun("send", "done"), stepRun("create-tasks", "done"), stepRun("done", "done"),
  ],
};

/** 派生タスクのデモ用：キャンペーン終了日の変更イベント */
export const changeEvents: ChangeEvent[] = [
  {
    id: "chg-001",
    entityType: "campaign",
    entityId: "camp-001",
    entityLabel: "秋の業務効率化キャンペーン",
    field: "endDate",
    fieldLabel: "配信終了日",
    before: shift(33, 23),
    after: shift(48, 23),
    reason: "出展イベントの日程変更に伴い、キャンペーン期間を延長",
    actor: "user-manager",
    occurredAt: shift(0, 9),
  },
];

export const tasks: Task[] = [
  {
    id: "task-manual-001",
    title: "アオイ製作所へのヒアリング内容をまとめる",
    description: "ヒアリング完了後、社内共有用に要点をまとめる。",
    status: "todo", priority: "high", assigneeId: "user-me",
    dueAt: shift(0, 18), runId: "run-001", stepKey: "hearing",
    source: "flow", confirmationState: "confirmed", dependsOn: [],
    createdAt: shift(-1, 9),
  },
  {
    id: "task-manual-002",
    title: "ハシモト会計事務所へ送付する資料の最新版を確認",
    status: "todo", priority: "normal", assigneeId: "user-me",
    dueAt: shift(1, 18), runId: "run-002", stepKey: "send-material",
    source: "flow", confirmationState: "confirmed", dependsOn: [],
    createdAt: shift(-1, 14),
  },
  {
    id: "task-manual-003",
    title: "運輸業界の企業リサーチ結果をレビュー",
    status: "todo", priority: "normal", assigneeId: "user-me",
    dueAt: shift(3, 18), runId: "run-004",
    startableWorkflowKey: "company-research",
    source: "flow", confirmationState: "confirmed", dependsOn: [],
    createdAt: shift(-2, 11),
  },
  {
    id: "task-manual-004",
    title: "先月の展示会リストから20社を選定する",
    description: "展示会で獲得した名刺リストから、営業対象を絞り込む。",
    status: "todo", priority: "normal", assigneeId: "user-me",
    dueAt: shift(5, 18),
    startableWorkflowKey: "company-research",
    source: "manual", confirmationState: "confirmed", dependsOn: [],
    createdAt: shift(-4, 10),
  },
  {
    id: "task-manual-005",
    title: "記事「製造業のAI活用事例」の参考資料を集める",
    status: "done", priority: "normal", assigneeId: "user-me",
    dueAt: shift(-1, 18), runId: "run-003",
    source: "flow", confirmationState: "confirmed", dependsOn: [],
    createdAt: shift(-3, 10),
  },
  {
    id: "task-overdue-001",
    title: "7月分の営業レポートを提出",
    status: "todo", priority: "urgent", assigneeId: "user-me",
    dueAt: shift(-2, 18),
    source: "manual", confirmationState: "confirmed", dependsOn: [],
    createdAt: shift(-10, 10),
  },
];
