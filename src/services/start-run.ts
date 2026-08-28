/**
 * 業務実行の生成（ユースケース）。
 *
 * 業務フロー詳細とタスク詳細の双方から呼ばれる。
 * 対象（subject）は業務フロー定義の variables から導出し、業務ごとの
 * 決め打ちを行わない。
 */
import type {
  Customer, RunSubject, StepRun, WorkRun, WorkflowDefinition,
} from "@/core/model/types";
import { orderedSteps } from "@/core/flow/engine";
import { resolveDeadline } from "@/core/schedule/backward";

/** 定義が顧客を必要とするなら顧客を、そうでなければ業務名を対象にする */
export function deriveSubject(
  def: WorkflowDefinition,
  customers: Customer[],
  override?: { label?: string; customerId?: string },
): RunSubject {
  const needsCustomer = def.variables.some(
    (v) => v.type === "reference" && v.entity === "customer",
  );

  if (needsCustomer) {
    const customer =
      customers.find((c) => c.id === override?.customerId) ?? customers[0];
    if (customer) {
      return { type: "customer", id: customer.id, label: override?.label ?? customer.name };
    }
  }
  return { type: "none", label: override?.label ?? def.name };
}

export interface StartRunInput {
  def: WorkflowDefinition;
  customers: Customer[];
  assigneeId: string;
  /** タスクから開始した場合など、対象名や期限を引き継ぐ */
  override?: { label?: string; customerId?: string; dueAt?: string };
}

export function buildRun({ def, customers, assigneeId, override }: StartRunInput): {
  run: WorkRun;
  stepRuns: StepRun[];
} {
  const startedAt = new Date().toISOString();
  const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const first = orderedSteps(def)[0];
  const subject = deriveSubject(def, customers, override);

  const context: Record<string, unknown> = {};
  if (subject.type === "customer" && subject.id) context.customerId = subject.id;

  const run: WorkRun = {
    id,
    workflowKey: def.key,
    workflowVersion: def.version,
    title: def.name,
    subject,
    status: "active",
    currentStepKeys: first ? [first.key] : [],
    context,
    assigneeId,
    dueAt:
      override?.dueAt ??
      (def.deadlineRule ? resolveDeadline(def.deadlineRule, { runStartedAt: startedAt }) : undefined),
    startedAt,
    source: "standard",
  };

  const stepRuns: StepRun[] = def.steps.map((s) => ({
    stepKey: s.key,
    status: first && s.key === first.key ? ("active" as const) : ("pending" as const),
    output: {},
    checklistState: {},
    appliedRuleIds: [],
    startedAt: first && s.key === first.key ? startedAt : undefined,
  }));

  return { run, stepRuns };
}
