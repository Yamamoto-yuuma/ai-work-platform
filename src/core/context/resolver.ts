/**
 * 業務コンテキストの解決（仕様 §15）。
 * 「現在のSTEPに関係するものだけ」を返す。全件を返してはいけない。
 */
import type {
  EffectiveStep, KnowledgeItem, StepContext, Task,
  WorkRun, WorkflowDefinition, RuleConflict,
} from "../model/types";
import { resolveDeadline } from "../schedule/backward";

const TOOL_LABELS: Record<string, { label: string; port?: string }> = {
  "email-compose": { label: "メール作成", port: "mailer" },
  "calendar-create": { label: "Google Calendar", port: "calendar" },
  "company-search": { label: "企業検索", port: "companySearch" },
  "company-select": { label: "企業検索", port: "companySearch" },
  "ai-assist": { label: "AIアシスト", port: "llm" },
  "document-compose": { label: "文章作成" },
  "knowledge-view": { label: "ナレッジ" },
  "task-create": { label: "タスク" },
  "customer-view": { label: "顧客情報" },
};

/** Phase 1 では外部連携を未接続とする。ここが将来 container 経由の実接続に変わる */
const CONNECTED_PORTS = new Set<string>();

export function resolveStepContext(input: {
  workflow: WorkflowDefinition;
  run: WorkRun;
  effectiveStep: EffectiveStep;
  knowledge: KnowledgeItem[];
  tasks: Task[];
  conflicts: RuleConflict[];
  now: Date;
}): StepContext {
  const { workflow, run, effectiveStep, knowledge, tasks, conflicts, now } = input;

  // ナレッジ: STEPが明示参照しているもの + ルールが追加したもの + 部品種別が一致するもの
  const refs = new Set([...(effectiveStep.knowledgeRefs ?? []), ...effectiveStep.extraKnowledgeIds]);
  const relevantKnowledge = knowledge.filter(
    (k) =>
      refs.has(k.id) ||
      (k.linkedStepKeys.includes(effectiveStep.key) && k.linkedWorkflowKeys.includes(workflow.key)),
  );

  // 不足情報：業務完遂に必要な情報のうち、まだ run.context に無いもの（仕様 §8-5）。
  // 業務フロー定義の variables から機械的に導出するため、AI が停止していても動く（§20-4）。
  // 「現STEPの未チェック項目」は中央の STEP UI が示すので、ここには載せない。
  const missingInfo = workflow.variables
    .filter((v) => v.required)
    .filter((v) => {
      const value = run.context[v.key];
      return value === undefined || value === null || value === "";
    })
    .map((v) => ({
      key: v.key,
      label: v.label,
      reason: "この業務の完遂に必要です",
    }));

  // 派生タスク: この業務由来のもののみ
  const relevantTasks = tasks.filter((t) => t.runId === run.id && t.source === "derived");

  // 必要ツール
  const toolSpec = TOOL_LABELS[effectiveStep.componentType];
  const tools = toolSpec
    ? [{
        label: toolSpec.label,
        available: !toolSpec.port || CONNECTED_PORTS.has(toolSpec.port),
        reason: toolSpec.port && !CONNECTED_PORTS.has(toolSpec.port) ? "未接続" : undefined,
      }]
    : [];

  const deadline = run.dueAt ? toDeadlineView(run.dueAt, now) : undefined;

  // STEP の期限は既存の deadlineRule をそのまま使う（新しい計算方式は作らない）
  const stepDueAt = effectiveStep.deadlineRule
    ? resolveDeadline(effectiveStep.deadlineRule, {
        runStartedAt: run.startedAt,
        runDueAt: run.dueAt,
      })
    : undefined;
  const stepDeadline = stepDueAt ? toDeadlineView(stepDueAt, now) : undefined;

  return {
    rules: effectiveStep.appliedRules,
    notices: effectiveStep.notices,
    knowledge: relevantKnowledge,
    missingInfo,
    derivedTasks: relevantTasks,
    deadline,
    stepDeadline,
    tools,
    conflicts,
  };
}

function toDeadlineView(iso: string, now: Date) {
  const due = new Date(iso);
  return { dueAt: iso, remainingLabel: remainingLabel(due, now), isOverdue: due < now };
}

export function remainingLabel(due: Date, now: Date): string {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const diffMs = due.getTime() - now.getTime();

  // 過ぎているものは必ず「超過」と言う。
  // 丸めた結果 0 日になっても「今日まで」と表示すると、
  // 赤い「期限超過」表示と矛盾する（仕様 §26-6）。
  if (diffMs < 0) {
    const over = Math.floor(-diffMs / DAY_MS);
    return over === 0 ? "期限超過" : `${over}日超過`;
  }

  const days = Math.round(diffMs / DAY_MS);
  if (days === 0) return "今日まで";
  if (days === 1) return "明日まで";
  return `あと${days}日`;
}

export function urgencyOf(dueAt: string | undefined, now: Date): "overdue" | "today" | "soon" | "normal" {
  if (!dueAt) return "normal";
  const due = new Date(dueAt);
  const days = Math.floor((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 2) return "soon";
  return "normal";
}
