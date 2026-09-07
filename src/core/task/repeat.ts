/**
 * 繰り返しタスク。
 *
 * 「毎週月曜に営業レポートを出す」のように、終わったらまた次が来る仕事を扱う。
 * 業務（Workflow）側の開始スケジュールと同じ語彙（毎日／毎週／毎月）を使う。
 * 画面に出る言葉が2種類あると、同じことを2回覚えることになる。
 *
 * 次の1件は「完了にした時」に作る。前もって何件も並べない。
 * 先の分まで一覧に並ぶと、いま抱えている量が分からなくなる。
 *
 * ここは純粋関数だけ。id の採番も時刻も外から渡してもらう。
 */
import type { StartScheduleRepeat, Task } from "../model/types";
import { matchesDay } from "../workflow/start-schedule";

/** 手動作成の既定と揃える。期限だけ決めたときの時刻 */
const DEFAULT_HOUR = 18;

/**
 * 次の期限。
 *
 * 起点は「前回の期限」と「今」の遅いほう。
 * 期限を過ぎた繰り返しタスクを今日終わらせたとき、起点を前回の期限に取ると
 * 次の1件が最初から期限切れで現れてしまう。それでは終わらない仕事になる。
 *
 * 時刻は前回の期限から引き継ぐ。日付だけ進めたいので時刻は動かさない。
 * 当たる日が1年以内に無い繰り返し（曜日を1つも選んでいない等）は null を返し、
 * 次を作らない。黙って毎日扱いにすると、意図しない仕事が湧く。
 */
export function nextDueAt(
  repeat: StartScheduleRepeat, previousDueAt: string | undefined, now: Date,
): string | null {
  const prev = previousDueAt ? new Date(previousDueAt) : null;
  const valid = prev && !Number.isNaN(prev.getTime()) ? prev : null;
  const from = valid && valid.getTime() > now.getTime() ? valid : now;
  const hours = valid ? valid.getHours() : DEFAULT_HOUR;
  const minutes = valid ? valid.getMinutes() : 0;

  for (let i = 1; i <= 400; i++) {
    const c = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, hours, minutes, 0, 0);
    if (matchesDay(repeat, c)) return c.toISOString();
  }
  return null;
}

/**
 * 完了にしたときに起きること。
 *
 * 呼ぶ側は、返ってきた patch を当てて、created があれば足すだけでよい。
 * 一覧からでも詳細からでも同じ結果になるよう、判断はここに1つだけ置く。
 *
 * 同じタスクから2件目を作らない。すでに次を作ってあれば created は返さない
 * （完了→戻す→完了 を繰り返しても増えない）。
 */
export function completeTaskEffects(input: {
  task: Task; now: Date; newId: () => string;
}): { patch: Partial<Task>; created?: Task } {
  const { task, now, newId } = input;
  const patch: Partial<Task> = { status: "done" };

  if (!task.repeat || task.repeatNextTaskId) return { patch };
  const due = nextDueAt(task.repeat, task.dueAt, now);
  if (!due) return { patch };

  const id = newId();
  const created: Task = {
    ...task,
    id,
    status: "todo",
    dueAt: due,
    createdAt: now.toISOString(),
    // 次の1件は、前の1件から生まれたことだけを引き継ぐ。
    // 依存や派生の系譜は引き継がない。前回の事情は次回の事情ではない。
    dependsOn: [],
    repeatNextTaskId: undefined,
    repeatFromTaskId: task.id,
  };
  return { patch: { ...patch, repeatNextTaskId: id }, created };
}

/**
 * 完了を取り消したときに起きること。
 *
 * 押し間違いで湧いた次の1件は、一緒に消す。残すと、戻したのに
 * 次回分だけが残るという説明のつかない状態になる。
 * ただし、その1件に既に手を付けていたら消さない（下の判定）。
 */
export function reopenTaskEffects(input: {
  task: Task; allTasks: Task[];
}): { patch: Partial<Task>; removeTaskId?: string } {
  const { task, allTasks } = input;
  const patch: Partial<Task> = { status: "todo", repeatNextTaskId: undefined };
  const next = task.repeatNextTaskId
    ? allTasks.find((t) => t.id === task.repeatNextTaskId)
    : undefined;
  // 手つかずのものだけ引き取る。触ったあとなら、それはもう別の仕事
  const untouched = next && next.status === "todo" && next.dependsOn.length === 0;
  return untouched ? { patch, removeTaskId: next.id } : { patch };
}
