/**
 * STEP完了後の「あとで見ておくこと」をタスクにする。
 *
 * 必ず通る手順でも、条件で分かれる道でもない作業がある。
 * 「自動送信したあと、エラーが出ていないか見ておく」のような、
 * たぶん大丈夫だが見ておかないと事故る、たぐいのもの。
 *
 * STEPにはしない。STEPにすると毎回そこで手が止まるし、
 * 「今やることではない」ものが現在地に居座る。
 * 完了した時点で切り出して、期日が来たら一覧に出す。
 *
 * ID は決定的にする。STEPをやり直して再度完了しても同じ ID になり、
 * 同じ確認が二重に積み上がらない（addTasks は既存 ID を取り込まない）。
 */
import type { StepDefinition, StepFollowUp, Task, WorkRun, WorkflowDefinition } from "../model/types";
import { addBusinessDays } from "../schedule/backward";

export function followUpTaskId(runId: string, stepKey: string, index: number): string {
  return `followup-${runId}-${stepKey}-${index}`;
}

/*
  業務そのものの終わりに紐付くもの。
  STEPキーの代わりに @run を使う。STEPキーは s1・s2・done のような
  形で作られるので、@ を含む名前とはぶつからない。
*/
export const RUN_FOLLOW_UP_KEY = "@run";

/** 何日後に見るか。営業日指定なら土日を飛ばす */
export function followUpDueAt(
  afterDays: number, businessDaysOnly: boolean | undefined, from: Date,
): string {
  const due = businessDaysOnly
    ? addBusinessDays(from, afterDays)
    : new Date(from.getFullYear(), from.getMonth(), from.getDate() + afterDays);
  due.setHours(18, 0, 0, 0);
  return due.toISOString();
}

/**
 * このSTEPを完了したときに切り出す確認タスク。
 * どの部品のSTEPでも使える（task-create 専用にしない）。
 */
export function generateFollowUpTasks(input: {
  step: StepDefinition;
  run: WorkRun;
  now: Date;
}): Task[] {
  const { step, run, now } = input;
  return build(step.followUps, step.key, run, now);
}

/**
 * 業務そのものを完了したときに切り出す確認タスク。
 * 分岐でどの道を通っても最後に必ず通るので、
 * 「この業務をやったら、あとでこれを見る」を落とさずに残せる。
 */
export function generateRunFollowUpTasks(input: {
  workflow: Pick<WorkflowDefinition, "followUps">;
  run: WorkRun;
  now: Date;
}): Task[] {
  const { workflow, run, now } = input;
  return build(workflow.followUps, RUN_FOLLOW_UP_KEY, run, now);
}

function build(
  followUps: StepFollowUp[] | undefined, stepKey: string, run: WorkRun, now: Date,
): Task[] {
  const createdAt = now.toISOString();

  return (followUps ?? [])
    .map((f, i) => ({ f, i }))
    // 名前の無いものは作らない。一覧に空行が並ぶだけになる
    .filter(({ f }) => f.label.trim().length > 0)
    .map(({ f, i }) => ({
      id: followUpTaskId(run.id, stepKey, i),
      title: f.label.trim(),
      status: "todo" as const,
      priority: "normal" as const,
      // 業務の担当者を引き継ぐ
      assigneeId: run.assigneeId,
      dueAt: followUpDueAt(f.afterDays, f.businessDaysOnly, now),
      // 由来：どの業務のどのSTEPから出たか
      runId: run.id,
      stepKey,
      source: "flow" as const,
      /*
        作業ではなく確認。一覧では「確認事項」として、
        手を動かすタスクと見分けがつくようにする。
      */
      impactLayer: "check" as const,
      // 人が定義に書いたものなので、承認ゲートは通さない
      confirmationState: "confirmed" as const,
      dependsOn: [],
      createdAt,
    }));
}
