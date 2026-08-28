/**
 * タスクの依存関係から状態を導出する（仕様 §11-3 / §26-4）。
 *
 * ブロック状態は保存値ではなく「依存関係からの導出値」とする。
 * HOME・タスク一覧・タスク詳細がこの関数を共有することで、
 * 同じタスクについて画面ごとに違う状態を表示しないようにする。
 */
import type { Task, TaskStatus } from "../model/types";

/** このタスクの完了を妨げている先行タスク（未完了のもの）を返す */
export function blockingPredecessors(task: Task, all: Task[]): Task[] {
  return task.dependsOn
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is Task => Boolean(t))
    .filter((t) => t.status !== "done" && t.status !== "canceled");
}

export function isBlocked(task: Task, all: Task[]): boolean {
  return blockingPredecessors(task, all).length > 0;
}

/**
 * 画面に表示する状態。
 * 未着手のタスクだけが「ブロック中」になる。
 * 既に着手しているタスクは、先行が未完了でも進行中のまま扱う。
 */
export function effectiveStatus(task: Task, all: Task[]): TaskStatus {
  if (task.status === "todo" && isBlocked(task, all)) return "blocked";
  return task.status;
}

/** このタスクに依存している後続タスク（直接のみ） */
export function directDependents(task: Task, all: Task[]): Task[] {
  return all.filter((t) => t.dependsOn.includes(task.id));
}

/**
 * このタスクが完了したら着手可能になるタスク。
 * 「他に待っている先行が無い」ものだけを返す（完了しても他に待ちがあるなら解放されない）。
 */
export function releasedOnComplete(task: Task, all: Task[]): Task[] {
  return directDependents(task, all)
    .filter((t) => t.status !== "done" && t.status !== "canceled")
    .filter((t) => blockingPredecessors(t, all).every((p) => p.id === task.id));
}

/**
 * 推移的な後続タスクを、依存の順に返す。
 * 循環が仕込まれていても停止するよう、訪問済みを記録する。
 */
export function transitiveDependents(task: Task, all: Task[]): Task[] {
  const seen = new Set<string>([task.id]);
  const out: Task[] = [];
  const queue = [task];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of directDependents(current, all)) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      out.push(next);
      queue.push(next);
    }
  }
  return out;
}
