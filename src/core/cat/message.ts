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
 * - 情報が増えないときは黙る。null を返す（仕様 §29-2）
 *
 * 話すのは次の場合だけ：
 * 期限超過／今日が確認日／待ちの確認日超過／不足情報あり／
 * 分岐に入った直後／業務を登録した直後／業務が完了した直後
 *
 * framework 非依存。React / ストアには依存しない。
 */
import type {
  ConditionExpr, NextAction, StepDefinition, StepRun,
  WorkRun, WorkflowDefinition,
} from "../model/types";
import { evaluate } from "../flow/condition";
import { urgencyOf } from "../context/resolver";

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

/**
 * 超過日数。画面の期限表示（core/context/resolver の remainingLabel）と
 * まったく同じ数え方にする。猫が別の数え方をすると、同じ日付なのに
 * ヘッダーと猫で日数が食い違う。
 */
function overdueDays(dueAt: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dueAt).getTime()) / 86400000);
}

function overduePhrase(dueAt: string, now: Date): string {
  const over = overdueDays(dueAt, now);
  return over <= 0 ? "期限を過ぎてる" : `期限を${over}日過ぎてる`;
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
  // 確認日がまだ先なら黙る。画面に出ている「次回確認」以上のことは言えない
  if (!until) return null;

  const urgency = urgencyOf(until, now);
  if (urgency === "overdue") {
    const over = overdueDays(until, now);
    return say(
      `wait:${run.id}:over:${over}`,
      over <= 0
        ? `確認日を過ぎてる。${what ? `${what}は` : "状況は"}まだ動いてない。`
        : `${over}日過ぎてる。${what ? `${what}は` : "状況は"}まだ動いてない。`,
    );
  }
  if (urgency === "today") {
    return say(
      `wait:${run.id}:today`,
      "今日が確認日だ。",
      what ? `${what}が来ているか見られる。` : "",
    );
  }
  return null;
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
  /** この STEP を完了するのに足りていない項目 */
  missingToComplete: { label: string }[];
  now: Date;
}

/**
 * 現在の STEP についての一言。
 * 「何をすべきか」は言わない。「いまどうなっているか」だけを言う。
 */
export function catForStep(input: StepSceneInput): CatMessage | null {
  const { def, run, step, stepRuns, scope, missingToComplete, now } = input;

  // 待ち中はそれが最大の事実（確認日が来ているときだけ話す）
  if (run.status === "paused") return catForWaiting(run, now);
  // 中止済みは画面が十分に説明している
  if (run.status === "canceled") return null;

  // 分かれ道を通った直後は、なぜここに来たのかを伝える
  const taken = takenBranch(def, step.key, stepRuns, scope);
  if (taken) return catForBranch(taken, step.title);

  // 期限を過ぎているなら、それが先
  if (run.dueAt && urgencyOf(run.dueAt, now) === "overdue") {
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

  /*
    業務全体の不足情報は、右パネルの「不足している業務情報」が項目名まで
    出している。ここで同じ名前を並べると二重になるので触れない（仕様 §29-1）。
    猫が言うのは、STEPを終えるのに足りていないもの（上の分岐）だけにする。
  */

  // 通常の進行中は黙る。レールと「次にやること」が出している以上のことはない
  return null;
}

// ---------------------------------------------------------------------------
// HOME（いま着手すること）
// ---------------------------------------------------------------------------

export interface HomeSceneInput {
  next: NextAction;
  now: Date;
}

/**
 * HOME の先頭カードの補足。
 * 「これをやろう」とは言わない。「なぜ上に来ているか」だけを言う。
 */
export function catForHome(input: HomeSceneInput): CatMessage | null {
  const { next, now } = input;

  // 待ちの確認日が来ているとき
  if (next.kind === "check") {
    if (next.dueAt && urgencyOf(next.dueAt, now) === "overdue") {
      return say(`home:check:over:${next.runId}`, `${overduePhrase(next.dueAt, now)}。まだ待ち中だ。`);
    }
    return say(`home:check:today:${next.runId}`, "今日が確認日だ。上に来てる理由はこれだ。");
  }

  // 期限を過ぎているとき
  if (next.dueAt && urgencyOf(next.dueAt, now) === "overdue") {
    return say(
      `home:over:${next.runId ?? next.taskId}`,
      `${overduePhrase(next.dueAt, now)}。上に来てる理由はこれだ。`,
    );
  }

  // それ以外は黙る。カードの期限表示より増える情報がない
  return null;
}

// ---------------------------------------------------------------------------
// 業務の登録
// ---------------------------------------------------------------------------

/**
 * 業務を登録した直後。未設定があるときだけ、後から足せることを伝える。
 * 入力の途中では出さない（まだ確定していないため）。
 */
export function catForRegistered(input: { key: string; unsetCount: number }): CatMessage | null {
  if (input.unsetCount === 0) return null;
  return say(`registered:${input.key}`, "細かい設定は後から足せる。名前と順番だけでも動く。");
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
