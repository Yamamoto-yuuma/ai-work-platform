/**
 * タスクの入力値と検証（仕様 §9-2）。
 *
 * 手動作成と編集の双方が同じ入力ルールを使うための共通モジュール。
 * framework 非依存の純粋関数で、UI はここが返す結果を表示するだけにする。
 * 自動生成系（業務フロー由来・派生ルール由来）のロジックには触れない。
 */
import type { StartScheduleRepeat, Task, TaskPriority, User } from "./types";
import { describeRepeat } from "../workflow/start-schedule";

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "低" },
  { value: "normal", label: "通常" },
  { value: "high", label: "高" },
  { value: "urgent", label: "緊急" },
];

/*
  繰り返しの選び方。業務の開始スケジュールと同じ並び・同じ言葉にする。
  「なし」を先頭に置く。ふだんのタスクは繰り返さないので、既定はここ。
*/
export const TASK_REPEAT_CHOICES: { value: TaskRepeatKind; label: string }[] = [
  { value: "none", label: "なし" },
  { value: "daily", label: "毎日" },
  { value: "weekly", label: "毎週" },
  { value: "monthly-day", label: "毎月（日付）" },
  { value: "monthly-last", label: "毎月（月末）" },
];

export type TaskRepeatKind = "none" | StartScheduleRepeat["kind"];

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 500;

/** フォームが扱う値。すべて文字列で保持し、保存時に Task へ変換する */
export interface TaskDraft {
  title: string;
  description: string;
  /** input[type=date] の値（YYYY-MM-DD）。空文字は「期限なし」 */
  dueAt: string;
  assigneeId: string;
  priority: TaskPriority;
  /* 繰り返し。フォームは選択肢を平らに持ち、保存時に1つの値へ畳む */
  repeatKind: TaskRepeatKind;
  /** 毎週のときだけ使う。0=日 … 6=土 */
  repeatWeekdays: number[];
  /** 毎月（日付）のときだけ使う。入力中は文字列で持つ */
  repeatMonthDay: string;
}

export interface TaskDraftError {
  field: keyof TaskDraft;
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

/** 保存されている繰り返しを、フォームが扱える平らな値にほどく */
export function repeatToDraft(repeat: StartScheduleRepeat | undefined): Pick<
  TaskDraft, "repeatKind" | "repeatWeekdays" | "repeatMonthDay"
> {
  if (!repeat) return { repeatKind: "none", repeatWeekdays: [], repeatMonthDay: "1" };
  switch (repeat.kind) {
    case "weekly":
      return { repeatKind: "weekly", repeatWeekdays: repeat.weekdays, repeatMonthDay: "1" };
    case "monthly-day":
      return { repeatKind: "monthly-day", repeatWeekdays: [], repeatMonthDay: String(repeat.day) };
    default:
      return { repeatKind: repeat.kind, repeatWeekdays: [], repeatMonthDay: "1" };
  }
}

/** フォームの値を、保存する形に畳む。「なし」は undefined にする */
export function repeatFromDraft(draft: TaskDraft): StartScheduleRepeat | undefined {
  switch (draft.repeatKind) {
    case "none": return undefined;
    case "daily": return { kind: "daily" };
    case "weekly": return { kind: "weekly", weekdays: draft.repeatWeekdays.slice().sort() };
    case "monthly-day": return { kind: "monthly-day", day: Number(draft.repeatMonthDay) || 1 };
    case "monthly-last": return { kind: "monthly-last" };
  }
}

/** 繰り返しを1文にする。業務側と同じ言い方に揃える */
export function describeTaskRepeat(repeat: StartScheduleRepeat | undefined): string {
  return repeat ? describeRepeat(repeat) : "繰り返さない";
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    dueAt: toDateInputValue(task.dueAt),
    assigneeId: task.assigneeId,
    priority: task.priority,
    ...repeatToDraft(task.repeat),
  };
}

export function validateTaskDraft(draft: TaskDraft, users: User[]): TaskDraftError[] {
  const errors: TaskDraftError[] = [];
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

  /*
    繰り返しは、次の1件がいつ来るか決まらなければ成立しない。
    曜日を1つも選んでいない「毎週」を通すと、完了しても次が現れず、
    繰り返しているつもりの仕事が黙って途切れる。
  */
  if (draft.repeatKind === "weekly" && draft.repeatWeekdays.length === 0) {
    errors.push({ field: "repeatWeekdays", message: "繰り返す曜日を選んでください" });
  }
  if (draft.repeatKind === "monthly-day") {
    const day = Number(draft.repeatMonthDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      errors.push({ field: "repeatMonthDay", message: "繰り返す日は1〜31で入力してください" });
    }
  }
  // 期限がなければ、次の期限も決めようがない
  if (draft.repeatKind !== "none" && !draft.dueAt) {
    errors.push({ field: "dueAt", message: "繰り返すタスクには期限が必要です" });
  }

  return errors;
}

/**
 * 検証済みの入力値から、updateTask に渡す差分を作る。
 * 編集対象の5項目だけを返し、由来・依存・業務との紐付けには触れない。
 */
export function patchFromDraft(draft: TaskDraft, task: Task): Partial<Task> {
  const description = draft.description.trim();
  return {
    title: draft.title.trim(),
    description: description.length > 0 ? description : undefined,
    dueAt: fromDateInputValue(draft.dueAt, task.dueAt),
    assigneeId: draft.assigneeId,
    priority: draft.priority,
    repeat: repeatFromDraft(draft),
  };
}

/** 入力に変更があるか（保存ボタンの活性判定に使う） */
export function isDirty(draft: TaskDraft, task: Task): boolean {
  const base = draftFromTask(task);
  return (
    base.title !== draft.title ||
    base.description !== draft.description ||
    base.dueAt !== draft.dueAt ||
    base.assigneeId !== draft.assigneeId ||
    base.priority !== draft.priority ||
    base.repeatKind !== draft.repeatKind ||
    base.repeatMonthDay !== draft.repeatMonthDay ||
    base.repeatWeekdays.join(",") !== draft.repeatWeekdays.join(",")
  );
}

/** 新規作成フォームの初期値 */
export function emptyTaskDraft(assigneeId: string): TaskDraft {
  return {
    title: "", description: "", dueAt: "", assigneeId, priority: "normal",
    repeatKind: "none", repeatWeekdays: [], repeatMonthDay: "1",
  };
}

/**
 * 検証済みの入力値から、手動作成タスクを組み立てる。
 * 由来（originEventId / derivationRuleId など）は設定しない。
 * 自動生成タスクと区別するため source は "manual" とし、承認ゲートは通さない
 * （提案中は自動生成タスクのための状態であり、人が意図して作ったものは確定済みとする）。
 */
export function newTaskFromDraft(draft: TaskDraft, id: string): Task {
  const description = draft.description.trim();
  return {
    id,
    title: draft.title.trim(),
    description: description.length > 0 ? description : undefined,
    status: "todo",
    priority: draft.priority,
    assigneeId: draft.assigneeId,
    dueAt: fromDateInputValue(draft.dueAt),
    repeat: repeatFromDraft(draft),
    source: "manual",
    confirmationState: "confirmed",
    dependsOn: [],
    createdAt: new Date().toISOString(),
  };
}
