/**
 * 業務コンテキストの解決（仕様 §15）。
 * 「現在のSTEPに関係するものだけ」を返す。全件を返してはいけない。
 */
import type {
  EffectiveStep, KnowledgeItem, StepContext, StepRun, Task,
  WorkRun, WorkflowDefinition, RuleConflict,
} from "../model/types";
import { checkStepCompletion } from "../flow/engine";

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
  stepRun: StepRun;
  knowledge: KnowledgeItem[];
  tasks: Task[];
  conflicts: RuleConflict[];
  scope: Record<string, unknown>;
  now: Date;
}): StepContext {
  const { workflow, run, effectiveStep, stepRun, knowledge, tasks, conflicts, scope, now } = input;

  // ナレッジ: STEPが明示参照しているもの + ルールが追加したもの + 部品種別が一致するもの
  const refs = new Set([...(effectiveStep.knowledgeRefs ?? []), ...effectiveStep.extraKnowledgeIds]);
  const relevantKnowledge = knowledge.filter(
    (k) =>
      refs.has(k.id) ||
      (k.linkedStepKeys.includes(effectiveStep.key) && k.linkedWorkflowKeys.includes(workflow.key)),
  );

  // 不足情報: 完了条件から機械的に導出（AI に依存しない）
  const check = checkStepCompletion(
    effectiveStep, stepRun,
    effectiveStep.extraChecklistItems, effectiveStep.extraFields, scope,
  );

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

  const deadline = run.dueAt
    ? {
        dueAt: run.dueAt,
        remainingLabel: remainingLabel(new Date(run.dueAt), now),
        isOverdue: new Date(run.dueAt) < now,
      }
    : undefined;

  return {
    rules: effectiveStep.appliedRules,
    notices: effectiveStep.notices,
    knowledge: relevantKnowledge,
    missingInfo: check.missing.map((m) => ({ key: m.key, label: m.label, reason: m.reason })),
    derivedTasks: relevantTasks,
    deadline,
    tools,
    conflicts,
  };
}

export function remainingLabel(due: Date, now: Date): string {
  const diffMs = due.getTime() - now.getTime();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days < 0) return `${Math.abs(days)}日超過`;
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
