/**
 * タスクの並び順。
 *
 * 並べないと、登録した順に出る。抱えている量が増えるほど、
 * 一覧は「持っているものの置き場」になり、「次に何をやるか」を
 * 言わなくなる。この道具の役目はそこなので、順番を決める。
 *
 * 並べ方は「実効優先度 → 期限 → 古い順」。
 *
 * 期限より優先度を先に見るのは、優先度が既に期限を織り込んでいるため
 * （priority/escalate.ts が、2日前で高、超過で緊急に上げる）。
 * 期限を先に見ると同じことを二度数えることになり、
 * 「期限は無いが緊急」と決めたものが一番下に沈む。
 *
 * framework 非依存の純粋関数。画面は結果を並べるだけにする。
 */
import type { PriorityEscalation, Task, TaskPriority } from "../model/types";
import { escalatedPriority } from "../priority/escalate";

const RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/** 期限を数値にする。期限なしは一番後ろ */
function dueKey(task: Task): number {
  if (!task.dueAt) return Number.POSITIVE_INFINITY;
  const t = new Date(task.dueAt).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * 抱えているタスクの並び。
 * 同じ優先度・同じ期限なら、古いものを上にする。
 * 新しいものが上に積み上がると、古いものが下に沈んで忘れられる。
 */
export function compareOpenTasks(
  a: Task, b: Task, now: Date, escalation?: PriorityEscalation,
): number {
  const pa = RANK[escalatedPriority(a.priority, a.dueAt, now, escalation)];
  const pb = RANK[escalatedPriority(b.priority, b.dueAt, now, escalation)];
  if (pa !== pb) return pb - pa;

  const da = dueKey(a);
  const db = dueKey(b);
  if (da !== db) return da - db;

  return a.createdAt.localeCompare(b.createdAt);
}

/** 抱えているタスクを並べる。元の配列は触らない */
export function sortOpenTasks(
  tasks: Task[], now: Date, escalation?: PriorityEscalation,
): Task[] {
  return [...tasks].sort((a, b) => compareOpenTasks(a, b, now, escalation));
}

/**
 * 終わったタスクの並び。新しく終えたものを上にする。
 * 見返すのはたいてい直近なので、古い順だと毎回一番下まで送ることになる。
 *
 * completedAt を持たない古いデータは、作られた順で後ろに置く。
 * 位置を推し量って混ぜるより、分からないものは分からない場所に置く。
 */
export function sortDoneTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.completedAt && b.completedAt) return b.completedAt.localeCompare(a.completedAt);
    if (a.completedAt) return -1;
    if (b.completedAt) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
