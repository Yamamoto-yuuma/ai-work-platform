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
  /** 業務日。設定のデモ用日付を反映するため、呼び出し側から渡す */
  now?: Date;
}

export function buildRun({ def, customers, assigneeId, override, now }: StartRunInput): {
  run: WorkRun;
  stepRuns: StepRun[];
} {
  const startedAt = (now ?? new Date()).toISOString();
  const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const first = orderedSteps(def)[0];
  const subject = deriveSubject(def, customers, override);

  const context: Record<string, unknown> = {};
  if (subject.type === "customer" && subject.id) context.customerId = subject.id;

  // マスタから導出できると宣言されている変数に初期値を入れる。
  // 「どの変数が何から derive されるか」は業務フロー定義側のデータで決まる。
  const customer = customers.find((c) => c.id === subject.id);
  if (customer) {
    for (const v of def.variables) {
      const d = v.derivedFrom;
      if (!d || d.entity !== "customer") continue;
      const raw = (customer as unknown as Record<string, unknown>)[d.field];
      const mapped = d.map[String(raw)];
      if (mapped !== undefined) context[v.key] = mapped;
    }
  }

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

  /**
   * 既に業務情報として分かっている値は、その項目の初期値として置く。
   * 「表示は埋まっているのに完了条件は未入力」という食い違いを作らない。
   * ユーザーは変更でき、変更した場合は画面側で登録内容との差異を示す。
   */
  const seedOutput = (step: { config: Record<string, unknown> }): Record<string, unknown> => {
    const fields = (step.config.fields ?? []) as { key: string }[];
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (context[f.key] !== undefined) out[f.key] = context[f.key];
    }
    return out;
  };

  const stepRuns: StepRun[] = def.steps.map((s) => ({
    stepKey: s.key,
    status: first && s.key === first.key ? ("active" as const) : ("pending" as const),
    output: seedOutput(s),
    checklistState: {},
    appliedRuleIds: [],
    startedAt: first && s.key === first.key ? startedAt : undefined,
  }));

  return { run, stepRuns };
}
