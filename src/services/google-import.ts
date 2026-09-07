/**
 * Google ToDo リストの取り込み（手順のまとめ）。
 *
 * 「どこから取るか」は adapters/google/tasks.ts、
 * 「取り込むかどうか」は core/integration/google-tasks.ts が持つ。
 * ここはその2つを繋ぐだけ。手で押したときも、自動のときも、同じ道を通す。
 * 経路が2つあると、片方だけ直して食い違う。
 */
import { describeImport, planImport, type ImportPlan } from "@/core/integration/google-tasks";
import { fetchTaskLists, fetchTasks } from "@/adapters/google/tasks";
import { newTaskId } from "@/lib/id";
import type { Task } from "@/core/model/types";

export interface ImportResult {
  plan: ImportPlan;
  /** 画面に出す1文 */
  message: string;
  /** 取り込んだリストの数 */
  lists: number;
  /** 何か変わったか。自動取り込みで、変化が無いときに知らせないため */
  changed: boolean;
}

export async function importGoogleTasks(input: {
  existing: Task[];
  assigneeId: string;
  now: Date;
}): Promise<ImportResult> {
  const lists = await fetchTaskLists();
  const plan: ImportPlan = { created: [], updated: [], untouched: 0, goneOnRemote: [] };

  for (const list of lists) {
    const incoming = await fetchTasks(list.id);
    const one = planImport({
      incoming, listId: list.id, existing: input.existing,
      assigneeId: input.assigneeId, now: input.now, newId: newTaskId,
    });
    plan.created.push(...one.created);
    plan.updated.push(...one.updated);
    plan.untouched += one.untouched;
    plan.goneOnRemote.push(...one.goneOnRemote);
  }

  return {
    plan,
    message: `${lists.length}件のリストから：${describeImport(plan)}`,
    lists: lists.length,
    changed: plan.created.length > 0 || plan.updated.length > 0,
  };
}
