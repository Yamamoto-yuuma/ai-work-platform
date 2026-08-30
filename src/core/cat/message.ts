/**
 * 案内役（黒猫）の一言を組み立てる（仕様 §29）。
 *
 * ここは判断をしない。NextActionResolver・フローエンジン・待ち・ルールが
 * すでに出している結果を、短い日本語に言い換えるだけの純粋関数。
 *
 * 守ること：
 * - 優先順位を決めない。決まった順位の「理由」を述べるだけ
 * - 指示・命令をしない。事実を述べ、判断はユーザーに残す
 * - 同じ状況なら必ず同じ文になる（決定的。AI は使わない）
 *
 * framework 非依存。React / ストアには依存しない。
 */
import type {
  ConditionExpr, MissingField, NextAction, StepDefinition, StepRun,
  WorkRun, WorkflowDefinition,
} from "../model/types";
import { evaluate } from "../flow/condition";
import { remainingDays } from "../priority/escalate";

export interface CatMessage {
  /** 1〜2行。長くしない */
  lines: string[];
  /**
   * 同じ状況なら同じ id。閉じられたことを覚えるためだけに使う。
   * 状況が変われば id も変わり、あらためて出せる。
   */
  id: string;
}

const say = (id: string, ...lines: string[]): CatMessage => ({ id, lines });

// ---------------------------------------------------------------------------
// 期限・日付の言い換え
// ---------------------------------------------------------------------------

function overduePhrase(dueAt: string, now: Date): string {
  const over = Math.abs(remainingDays(dueAt, now));
  return over <= 1 ? "期限を過ぎてる" : `期限を${over}日過ぎてる`;
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

// ---------------------------------------------------------------------------
// 待ち
// ---------------------------------------------------------------------------

/**
 * 待ち中の一言。再開するかどうかは言わない（ユーザーが決める）。
 */
export function catForWaiting(run: WorkRun, now: Date): CatMessage | null {
  if (run.status !== "paused") return null;
  const until = run.waitingUntil;
  const what = run.waitingFor?.trim();
  if (!until) {
    return say(`wait:${run.id}:none`, what ? `${what}を待ってる。` : "待ち中だ。");
  }
  const left = remainingDays(until, now);
  if (left < 0) {
    const over = Math.abs(left);
    return say(
      `wait:${run.id}:over:${over}`,
      `${over}日過ぎてる。${what ? `${what}は` : "状況は"}まだ動いてない。`,
    );
  }
  if (left === 0) {
    return say(
      `wait:${run.id}:today`,
      "今日が確認日だ。",
      what ? `${what}が来ているか見られる。` : "",
    );
  }
  return say(`wait:${run.id}:until:${until}`, `${dateLabel(until)}に確認する予定だ。`);
}

// ---------------------------------------------------------------------------
// 分岐
// ---------------------------------------------------------------------------

export interface TakenBranch {
  /** 通ったルートの名前（エッジのラベル） */
  label: string;
  /** 分かれ道になった STEP */
  fromTitle: string;
}

/**
 * 直前に通った分岐。
 *
 * 現在の STEP に条件付きで入ってくるエッジがあり、その手前の STEP が
 * 「いちばん最後に完了した STEP」なら、そこで分かれてここへ来たと分かる。
 * 新しい記録は持たず、既存の定義と StepRun だけから判定する。
 */
export function takenBranch(
  def: WorkflowDefinition,
  currentStepKey: string,
  stepRuns: StepRun[],
  scope: Record<string, unknown>,
): TakenBranch | null {
  const lastDone = [...stepRuns]
    .filter((sr) => sr.status === "done" && sr.completedAt)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0];
  if (!lastDone) return null;

  const edge = def.edges.find(
    (e) => e.to === currentStepKey && e.from === lastDone.stepKey && e.condition,
  );
  if (!edge?.label) return null;
  if (!matches(edge.condition, scope)) return null;

  const from = def.steps.find((s) => s.key === edge.from);
  return { label: edge.label, fromTitle: from?.title ?? "" };
}

function matches(condition: ConditionExpr | undefined, scope: Record<string, unknown>): boolean {
  try {
    return evaluate(condition, scope);
  } catch {
    return false;
  }
}

export function catForBranch(taken: TakenBranch, stepTitle: string): CatMessage {
  return say(
    `branch:${taken.fromTitle}:${taken.label}:${stepTitle}`,
    `「${taken.label}」だったから、こっちのルートに入った。`,
  );
}

// ---------------------------------------------------------------------------
// ナビゲーター（現在の STEP）
// ---------------------------------------------------------------------------

export interface StepSceneInput {
  def: WorkflowDefinition;
  run: WorkRun;
  step: StepDefinition;
  stepRuns: StepRun[];
  scope: Record<string, unknown>;
  /** 業務完遂に必要だがまだ埋まっていない項目 */
  missingInfo: MissingField[];
  /** この STEP を完了するのに足りていない項目 */
  missingToComplete: { label: string }[];
  progress: { index: number; total: number; done: number };
  now: Date;
}

/**
 * 現在の STEP についての一言。
 * 「何をすべきか」は言わない。「いまどうなっているか」だけを言う。
 */
export function catForStep(input: StepSceneInput): CatMessage | null {
  const { def, run, step, stepRuns, scope, missingInfo, missingToComplete, progress, now } = input;

  // 待ち中はそれが最大の事実
  if (run.status === "paused") return catForWaiting(run, now);
  if (run.status === "canceled") return say(`canceled:${run.id}`, "この業務は途中でやめた。記録は残ってる。");

  // 分かれ道を通った直後は、なぜここに来たのかを伝える
  const taken = takenBranch(def, step.key, stepRuns, scope);
  if (taken) return catForBranch(taken, step.title);

  // 期限を過ぎているなら、それが先
  if (run.dueAt && remainingDays(run.dueAt, now) < 0) {
    return say(`step:${run.id}:${step.key}:overdue`, `この業務は${overduePhrase(run.dueAt, now)}。`);
  }

  // この STEP を終えるのに足りないもの
  if (missingToComplete.length > 0) {
    const first = missingToComplete[0].label;
    return missingToComplete.length === 1
      ? say(`step:${run.id}:${step.key}:need:1:${first}`, `「${first}」がまだ残ってる。`)
      : say(
          `step:${run.id}:${step.key}:need:${missingToComplete.length}`,
          `あと${missingToComplete.length}件残ってる。「${first}」もそのひとつだ。`,
        );
  }

  // 業務全体として足りていない情報
  if (missingInfo.length > 0) {
    return say(
      `step:${run.id}:${step.key}:missing:${missingInfo.map((m) => m.key).join(",")}`,
      `${missingInfo.map((m) => `「${m.label}」`).join("と")}がまだ決まってない。`,
    );
  }

  // 進み具合。1つ目なら始まったこと、途中なら前が終わったこと。
  // 業務名は見出しに出ているので繰り返さない（仕様 §28-10）
  if (progress.done === 0) {
    return say(`step:${run.id}:${step.key}:start`, `始まったところだ。ここが最初のSTEPだ。`);
  }
  return say(
    `step:${run.id}:${step.key}:ready:${progress.done}`,
    `前のSTEPは終わった。ここから続けられる。`,
  );
}

// ---------------------------------------------------------------------------
// HOME（いま着手すること）
// ---------------------------------------------------------------------------

export interface HomeSceneInput {
  next: NextAction;
  now: Date;
  /** 未確認の派生タスク件数 */
  proposedCount: number;
  /** 確認日が来ている待ちの件数 */
  dueCheckCount: number;
}

/**
 * HOME の先頭カードの補足。
 * 「これをやろう」とは言わない。「なぜ上に来ているか」だけを言う。
 */
export function catForHome(input: HomeSceneInput): CatMessage | null {
  const { next, now, proposedCount, dueCheckCount } = input;

  if (next.kind === "idle") {
    return dueCheckCount > 0
      ? say("home:idle:waiting", `いま手を付けられる作業はない。確認日が来てるものが${dueCheckCount}件ある。`)
      : say("home:idle", "いま手を付けられる作業はない。");
  }

  if (next.kind === "review-proposals") {
    return say("home:proposals", `変更から生まれたタスクが${proposedCount}件、未確認のままだ。`);
  }

  if (next.kind === "check") {
    if (next.dueAt && remainingDays(next.dueAt, now) < 0) {
      return say(`home:check:over:${next.runId}`, `${overduePhrase(next.dueAt, now)}。まだ待ち中だ。`);
    }
    return say(`home:check:today:${next.runId}`, "今日が確認日だ。上に来てる理由はこれだ。");
  }

  if (next.dueAt) {
    const left = remainingDays(next.dueAt, now);
    if (left < 0) {
      return say(`home:over:${next.runId ?? next.taskId}:${left}`, `${overduePhrase(next.dueAt, now)}。上に来てる理由はこれだ。`);
    }
    if (left === 0) return say(`home:today:${next.runId ?? next.taskId}`, "今日が期限だ。だから一番上にある。");
    if (left <= 2) return say(`home:soon:${next.runId ?? next.taskId}:${left}`, `期限まであと${left}日だ。`);
  }

  if (next.kind === "step") {
    return say(`home:step:${next.runId}:${next.stepKey}`, "進めてる業務だ。単発の仕事より先に来てる。");
  }
  return null;
}

// ---------------------------------------------------------------------------
// 業務の登録
// ---------------------------------------------------------------------------

/** 未設定があるときだけ。「後から足せる」ことを伝える */
export function catForRegister(unset: string[]): CatMessage | null {
  if (unset.length === 0) return null;
  return say(`register:${unset.length}`, "細かい設定は後から足せる。名前と順番だけでも動く。");
}

// ---------------------------------------------------------------------------
// 完了
// ---------------------------------------------------------------------------

/** 完了時。残っている仕事があるなら、それは事実として述べる */
export function catForCompletion(input: { openTaskCount: number; runId: string }): CatMessage {
  const { openTaskCount, runId } = input;
  return openTaskCount > 0
    ? say(`done:${runId}:${openTaskCount}`, "終わったな。", `この業務から残ってる仕事が${openTaskCount}件ある。`)
    : say(`done:${runId}:0`, "終わったな。");
}
