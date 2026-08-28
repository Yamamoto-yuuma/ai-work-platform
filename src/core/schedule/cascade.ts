/**
 * 先行タスクの期限変更が後続タスクへ与える影響の算出（仕様 §11-3）。
 *
 * ここが返すのは「提案」であり、確定はしない。
 * 仕様 §11-3 は「後続タスクの期限を再計算して提案 MUST（自動確定はしない）」と
 * 定めており、確定はユーザーの明示的な操作を経る。
 *
 * 計算規則：先行タスクが動いた営業日数だけ、後続タスクも同じだけ動かす。
 * 計画時の間隔を保つのが目的で、期限が土日に落ちないようにするためでもある。
 */
import type { Task } from "../model/types";
import { transitiveDependents } from "../task/dependency";
import { addBusinessDays } from "./backward";

export interface DeadlineProposal {
  taskId: string;
  title: string;
  /** 現在の期限 */
  currentDueAt: string;
  /** 提案する期限 */
  proposedDueAt: string;
  /** 起点からの距離（1 = 直接の後続） */
  hop: number;
}

/** 2つの日付の間の営業日数（土日を除く。前後関係で符号が変わる） */
export function businessDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  if (a.getTime() === b.getTime()) return 0;

  const forward = a < b;
  const start = forward ? a : b;
  const end = forward ? b : a;
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return forward ? count : -count;
}

/**
 * 先行タスクの期限変更によって影響を受ける後続タスクと、その提案期限を返す。
 * 期限を持たない後続、完了・中止済みの後続は対象にしない。
 */
export function proposeDependentDeadlines(input: {
  changedTask: Task;
  previousDueAt?: string;
  allTasks: Task[];
}): DeadlineProposal[] {
  const { changedTask, previousDueAt, allTasks } = input;
  if (!previousDueAt || !changedTask.dueAt) return [];

  const before = new Date(previousDueAt);
  const after = new Date(changedTask.dueAt);
  if (Number.isNaN(before.getTime()) || Number.isNaN(after.getTime())) return [];

  const shift = businessDaysBetween(before, after);
  if (shift === 0) return [];

  // hop を測るため、幅優先で距離を持たせる
  const hops = new Map<string, number>();
  const queue: { task: Task; hop: number }[] = [{ task: changedTask, hop: 0 }];
  const seen = new Set<string>([changedTask.id]);
  while (queue.length > 0) {
    const { task, hop } = queue.shift()!;
    for (const next of allTasks.filter((t) => t.dependsOn.includes(task.id))) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      hops.set(next.id, hop + 1);
      queue.push({ task: next, hop: hop + 1 });
    }
  }

  return transitiveDependents(changedTask, allTasks)
    .filter((t) => t.status !== "done" && t.status !== "canceled")
    .filter((t) => Boolean(t.dueAt))
    .map((t) => {
      const current = new Date(t.dueAt!);
      const proposed = addBusinessDays(current, shift);
      // 時刻は元の期限のものを保つ
      proposed.setHours(current.getHours(), current.getMinutes(), 0, 0);
      return {
        taskId: t.id,
        title: t.title,
        currentDueAt: t.dueAt!,
        proposedDueAt: proposed.toISOString(),
        hop: hops.get(t.id) ?? 1,
      };
    })
    .filter((p) => p.currentDueAt !== p.proposedDueAt)
    .sort((a, b) => a.hop - b.hop || a.currentDueAt.localeCompare(b.currentDueAt));
}

/** 変更の向きを表す文言用の情報 */
export function shiftDirection(previousDueAt: string, nextDueAt: string): "later" | "earlier" | "none" {
  const d = businessDaysBetween(new Date(previousDueAt), new Date(nextDueAt));
  return d > 0 ? "later" : d < 0 ? "earlier" : "none";
}
