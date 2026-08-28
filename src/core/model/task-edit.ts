/**
 * タスク編集の入力値と検証（仕様 §9-2）。
 *
 * framework 非依存の純粋関数。UI はここが返す結果を表示するだけにする。
 * 生成系（業務フロー由来・派生ルール由来）のロジックには触れない。
 */
import type { Task, TaskPriority, User } from "./types";

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "低" },
  { value: "normal", label: "通常" },
  { value: "high", label: "高" },
  { value: "urgent", label: "緊急" },
];

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 500;

/** 編集フォームが扱う値。すべて文字列で保持し、保存時に Task へ変換する */
export interface TaskEditDraft {
  title: string;
  description: string;
  /** input[type=date] の値（YYYY-MM-DD）。空文字は「期限なし」 */
  dueAt: string;
  assigneeId: string;
  priority: TaskPriority;
}

export interface TaskEditError {
  field: keyof TaskEditDraft;
  message: string;
}

/** ISO 文字列を input[type=date] 用のローカル日付に変換する */
export function toDateInputValue(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * input[type=date] の値を ISO 文字列に戻す。
 * 元の期限が持っていた時刻は維持する（日付だけ変えたつもりが時刻まで動かないように）。
 */
export function fromDateInputValue(value: string, previousIso?: string): string | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;

  let hours = 18;
  let minutes = 0;
  if (previousIso) {
    const prev = new Date(previousIso);
    if (!Number.isNaN(prev.getTime())) {
      hours = prev.getHours();
      minutes = prev.getMinutes();
    }
  }
  const next = new Date(y, m - 1, d, hours, minutes, 0, 0);
  return Number.isNaN(next.getTime()) ? undefined : next.toISOString();
}

export function draftFromTask(task: Task): TaskEditDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    dueAt: toDateInputValue(task.dueAt),
    assigneeId: task.assigneeId,
    priority: task.priority,
  };
}

export function validateTaskEdit(draft: TaskEditDraft, users: User[]): TaskEditError[] {
  const errors: TaskEditError[] = [];
  const title = draft.title.trim();

  if (title.length === 0) {
    errors.push({ field: "title", message: "タスク名を入力してください" });
  } else if (title.length > TITLE_MAX) {
    errors.push({ field: "title", message: `タスク名は${TITLE_MAX}文字以内で入力してください（現在 ${title.length} 文字）` });
  }

  if (draft.description.length > DESCRIPTION_MAX) {
    errors.push({
      field: "description",
      message: `説明は${DESCRIPTION_MAX}文字以内で入力してください（現在 ${draft.description.length} 文字）`,
    });
  }

  if (draft.dueAt) {
    const d = new Date(draft.dueAt);
    if (Number.isNaN(d.getTime())) {
      errors.push({ field: "dueAt", message: "期限の日付が正しくありません" });
    }
  }

  if (!users.some((u) => u.id === draft.assigneeId)) {
    errors.push({ field: "assigneeId", message: "担当者を選択してください" });
  }

  if (!TASK_PRIORITIES.some((p) => p.value === draft.priority)) {
    errors.push({ field: "priority", message: "優先度を選択してください" });
  }

  return errors;
}

/**
 * 検証済みの入力値から、updateTask に渡す差分を作る。
 * 編集対象の5項目だけを返し、由来・依存・業務との紐付けには触れない。
 */
export function patchFromDraft(draft: TaskEditDraft, task: Task): Partial<Task> {
  const description = draft.description.trim();
  return {
    title: draft.title.trim(),
    description: description.length > 0 ? description : undefined,
    dueAt: fromDateInputValue(draft.dueAt, task.dueAt),
    assigneeId: draft.assigneeId,
    priority: draft.priority,
  };
}

/** 入力に変更があるか（保存ボタンの活性判定に使う） */
export function isDirty(draft: TaskEditDraft, task: Task): boolean {
  const base = draftFromTask(task);
  return (
    base.title !== draft.title ||
    base.description !== draft.description ||
    base.dueAt !== draft.dueAt ||
    base.assigneeId !== draft.assigneeId ||
    base.priority !== draft.priority
  );
}
