/**
 * 「次にやること」を決定するエンジン。
 *
 * 本プロダクトが単なるタスク管理にならないための中核。
 * 進行中の全業務・全タスクを横断し、「今この瞬間に着手すべき唯一のこと」を決める。
 * 画面はこの出力を表示するだけにする（仕様 §4-3）。
 */
import type {
  NextAction, StepRun, Task, WorkRun, WorkflowDefinition, StepDefinition,
} from "../model/types";
import { getStep } from "../flow/engine";
import { urgencyOf, remainingLabel } from "./resolver";

const URGENCY_SCORE = { overdue: 1000, today: 500, soon: 200, normal: 0 } as const;
const PRIORITY_SCORE = { urgent: 120, high: 60, normal: 0, low: -30 } as const;

export interface NextActionInput {
  runs: WorkRun[];
  stepRunsByRun: Record<string, StepRun[]>;
  workflows: WorkflowDefinition[];
  tasks: Task[];
  userId: string;
  now: Date;
}

/** STEP 1件に対する「次にやること」1文を生成する（決定的。AI は使わない） */
export function headlineForStep(step: StepDefinition, run: WorkRun): string {
  const subject = run.subject.label ? `${run.subject.label}の` : "";
  return `${subject}${step.title}：${step.guidance}`;
}

/** 業務が「待ち」状態か判定する。着手できるものが無い状態を可視化する */
export function isWaiting(
  run: WorkRun,
  stepRuns: StepRun[],
  def: WorkflowDefinition | undefined,
): boolean {
  if (!def || run.status !== "active") return false;
  const activeSteps = run.currentStepKeys
    .map((k) => getStep(def, k))
    .filter((s): s is StepDefinition => Boolean(s));
  if (activeSteps.length === 0) return true;
  // 承認STEPだけが残っている場合は「他者待ち」
  return activeSteps.every((s) => s.componentType === "approval");
}

export interface RankedAction extends NextAction {
  score: number;
}

/** 全業務・全タスクを横断して、着手すべきものを優先順位付きで返す */
export function rankActions(input: NextActionInput): RankedAction[] {
  const { runs, stepRunsByRun, workflows, tasks, userId, now } = input;
  const actions: RankedAction[] = [];
  const defOf = (key: string, version: number) =>
    workflows.find((w) => w.key === key && w.version === version) ??
    workflows.find((w) => w.key === key);

  // 1. 進行中業務の active STEP
  for (const run of runs) {
    if (run.status !== "active" || run.assigneeId !== userId) continue;
    const def = defOf(run.workflowKey, run.workflowVersion);
    if (!def) continue;
    const stepRuns = stepRunsByRun[run.id] ?? [];
    if (isWaiting(run, stepRuns, def)) continue;

    for (const key of run.currentStepKeys) {
      const step = getStep(def, key);
      if (!step || step.componentType === "approval") continue;
      const urgency = urgencyOf(run.dueAt, now);
      actions.push({
        kind: "step",
        headline: headlineForStep(step, run),
        reason: `「${def.name}」の STEP ${stepIndex(def, key)} / ${countSteps(def)}`,
        runId: run.id,
        stepKey: key,
        dueAt: run.dueAt,
        urgency,
        score: URGENCY_SCORE[urgency] + 300, // 進行中業務は単発タスクより優先
      });
    }
  }

  // 2. 未確認の提案（派生タスク）— 放置すると漏れるため高優先
  const proposed = tasks.filter((t) => t.confirmationState === "proposed" && t.assigneeId === userId);
  if (proposed.length > 0) {
    actions.push({
      kind: "review-proposals",
      headline: `${proposed.length}件の派生タスクが未確認です：内容を確認して確定してください`,
      reason: "変更によって発生したタスクが提案中のままです",
      urgency: "today",
      score: URGENCY_SCORE.today + 250,
    });
  }

  // 3. 確定済みの単発タスク
  for (const task of tasks) {
    if (task.confirmationState !== "confirmed") continue;
    if (task.assigneeId !== userId) continue;
    if (task.status === "done" || task.status === "canceled") continue;
    const blocked = task.dependsOn.some((id) => {
      const dep = tasks.find((t) => t.id === id);
      return dep && dep.status !== "done";
    });
    if (blocked) continue;

    const urgency = urgencyOf(task.dueAt, now);
    actions.push({
      kind: "task",
      headline: task.title,
      reason: task.startableWorkflowKey ? "このタスクから業務を開始できます" : "単発タスク",
      taskId: task.id,
      runId: task.runId,
      dueAt: task.dueAt,
      urgency,
      score: URGENCY_SCORE[urgency] + PRIORITY_SCORE[task.priority],
    });
  }

  return actions.sort((a, b) => b.score - a.score);
}

/** 「今この瞬間、あなたが着手すべき唯一のこと」 */
export function resolveNextAction(input: NextActionInput): NextAction {
  const ranked = rankActions(input);
  if (ranked.length > 0) return ranked[0];

  const waitingRuns = input.runs.filter(
    (r) =>
      r.status === "active" &&
      r.assigneeId === input.userId &&
      isWaiting(r, input.stepRunsByRun[r.id] ?? [], input.workflows.find((w) => w.key === r.workflowKey)),
  );

  if (waitingRuns.length > 0) {
    return {
      kind: "idle",
      headline: "今すぐ着手できる作業はありません",
      reason: `${waitingRuns.length}件の業務が他者の対応待ちです`,
      urgency: "normal",
    };
  }
  return {
    kind: "idle",
    headline: "着手中の業務はありません",
    reason: "業務フロー一覧から新しい業務を開始できます",
    urgency: "normal",
  };
}

/** 待ち状態の業務一覧。「何もできない」と「次が分からない」を区別する */
export function waitingRuns(input: NextActionInput): { run: WorkRun; reason: string }[] {
  return input.runs
    .filter((r) => r.status === "active" && r.assigneeId === input.userId)
    .filter((r) => isWaiting(r, input.stepRunsByRun[r.id] ?? [], input.workflows.find((w) => w.key === r.workflowKey)))
    .map((r) => ({ run: r, reason: "承認・返信待ち" }));
}

function stepIndex(def: WorkflowDefinition, key: string): number {
  return def.steps.filter((s) => s.componentType !== "branch").findIndex((s) => s.key === key) + 1;
}
function countSteps(def: WorkflowDefinition): number {
  return def.steps.filter((s) => s.componentType !== "branch").length;
}

export { remainingLabel };
