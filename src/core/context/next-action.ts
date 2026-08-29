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
import { getStep, runProgress } from "../flow/engine";
import { isBlocked } from "../task/dependency";
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
  // 対象 + STEP名まで。guidance は長く、STEPの説明であって行動の見出しではない
  const subject = run.subject.label ? `${run.subject.label}の` : "";
  return `${subject}${step.title}`;
}

/**
 * 待ち中の業務か。
 *
 * 「承認STEPだから自動的に待ち」という推測はしない（仕様の個人利用前提）。
 * 待ちにするかどうかは必ずユーザーが明示的に操作する。
 */
export function isWaitingRun(run: WorkRun): boolean {
  return run.status === "paused";
}

/** 次回確認日が来ている（または過ぎている）待ちか */
export function isDueForCheck(run: WorkRun, now: Date): boolean {
  if (!isWaitingRun(run) || !run.waitingUntil) return false;
  const u = urgencyOf(run.waitingUntil, now);
  return u === "overdue" || u === "today";
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

    const position = runProgress(def, run, stepRuns);
    for (const key of run.currentStepKeys) {
      const step = getStep(def, key);
      // 承認STEPも自分が内容を確認して進める作業なので、着手候補から外さない。
      // 進められないなら、ユーザーが明示的に「待ち」にする
      if (!step) continue;
      const urgency = urgencyOf(run.dueAt, now);
      actions.push({
        kind: "step",
        headline: headlineForStep(step, run),
        reason: `「${def.name}」の STEP ${position.index} / ${position.total}`,
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

  // 3. 確認日が来た待ち。作業ではなく「確認して判断する」アクション
  for (const run of runs) {
    if (run.assigneeId !== userId) continue;
    if (!isDueForCheck(run, now)) continue;
    const urgency = urgencyOf(run.waitingUntil, now);
    actions.push({
      kind: "check",
      headline: `${run.subject.label} — ${run.waitingFor ?? "待ち中の確認"}`,
      reason: urgency === "overdue"
        ? `確認予定日を過ぎています（${remainingLabel(new Date(run.waitingUntil!), now)}）`
        : "待ち中の業務。今日が確認予定日です",
      runId: run.id,
      dueAt: run.waitingUntil,
      urgency,
      // 確認は短時間で終わる。滞留させないため作業より少し高く置く
      score: URGENCY_SCORE[urgency] + 320,
    });
  }

  // 4. 確定済みの単発タスク
  for (const task of tasks) {
    if (task.confirmationState !== "confirmed") continue;
    if (task.assigneeId !== userId) continue;
    if (task.status === "done" || task.status === "canceled") continue;
    // ブロック判定は core/task/dependency に一元化している（画面間で判定を揃えるため）
    if (isBlocked(task, tasks)) continue;

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

  const paused = input.runs.filter(
    (r) => r.assigneeId === input.userId && isWaitingRun(r),
  );

  if (paused.length > 0) {
    const next = [...paused]
      .filter((r) => r.waitingUntil)
      .sort((a, b) => a.waitingUntil!.localeCompare(b.waitingUntil!))[0];
    return {
      kind: "idle",
      headline: "今すぐ着手できる作業はありません",
      reason: next?.waitingUntil
        ? `${paused.length}件を待ち中です。次の確認は ${new Date(next.waitingUntil).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}`
        : `${paused.length}件を待ち中です`,
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

/**
 * 待ち中の業務一覧。確認日の早い順。
 * reason は自分が入力した「何を待っているか」で、システムの推測ではない。
 */
export function waitingRuns(input: NextActionInput): {
  run: WorkRun; reason: string; dueForCheck: boolean;
}[] {
  return input.runs
    .filter((r) => r.assigneeId === input.userId && isWaitingRun(r))
    .sort((a, b) => (a.waitingUntil ?? "").localeCompare(b.waitingUntil ?? ""))
    .map((r) => ({
      run: r,
      reason: r.waitingFor ?? "待ち中",
      dueForCheck: isDueForCheck(r, input.now),
    }));
}


export { remainingLabel };
