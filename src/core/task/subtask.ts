/**
 * タスクの親子。
 *
 * 定例の業務では、1つのタスクに毎回やる細目がぶら下がる。
 * それを業務の定義側に持たせ、タスクが生まれるときに一緒に作る。
 *
 * 決め事は2つ。
 *
 * 1. 細目は一覧のトップレベルに出さない。親の中だけで扱う。
 *    出すと、定例業務を1つ始めただけで一覧が細目で埋まり、
 *    いま抱えている量が分からなくなる。
 * 2. 細目が残っているうちは、親を完了にできない。
 *    親だけ先に閉じられると、細目が宙に浮いて誰も見なくなる。
 *
 * framework 非依存の純粋関数。画面は結果を出すだけにする。
 */
import type { Task } from "../model/types";

/** 一覧に並べるもの。細目は親の中で出すので、ここには含めない */
export function topLevel(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.parentTaskId);
}

/** この親にぶら下がっている細目。定義に書いた順で返す */
export function subtasksOf(parent: Task, all: Task[]): Task[] {
  return all.filter((t) => t.parentTaskId === parent.id);
}

/** まだ済んでいない細目 */
export function openSubtasks(parent: Task, all: Task[]): Task[] {
  return subtasksOf(parent, all).filter((t) => t.status !== "done" && t.status !== "canceled");
}

/**
 * 細目の進み具合。親の行に「2/5」と出すために使う。
 * 細目を持たない親は null（0/0 と出すと、無いものが有るように見える）。
 */
export function subtaskProgress(parent: Task, all: Task[]): { done: number; total: number } | null {
  const subs = subtasksOf(parent, all);
  if (subs.length === 0) return null;
  return {
    done: subs.filter((t) => t.status === "done" || t.status === "canceled").length,
    total: subs.length,
  };
}

/**
 * 細目が残っていて、親を閉じられない状態か。
 * 既にある「先行タスクが終わるまで完了にできない」と同じ扱いにする。
 */
export function blockedBySubtasks(parent: Task, all: Task[]): Task[] {
  if (parent.status === "done") return [];
  return openSubtasks(parent, all);
}
