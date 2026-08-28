/**
 * タスクの表示ラベル（仕様 §26-5 用語の統一）。
 * 実装上の値ではなく、ユーザーが認識する言葉を1か所で定義する。
 */
import type { TaskSource, TaskStatus } from "./types";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  "todo": "未着手",
  "doing": "進行中",
  "blocked": "ブロック中",
  "waiting-approval": "承認待ち",
  "done": "完了",
  "canceled": "中止",
};

/** 状態を色でも示す（色のみに頼らないよう、必ずラベルと併記する） */
export const TASK_STATUS_DOT: Record<TaskStatus, string> = {
  "todo": "bg-ink-3",
  "doing": "bg-brand",
  "blocked": "bg-danger",
  "waiting-approval": "bg-signal",
  "done": "bg-ok",
  "canceled": "bg-line",
};

export const TASK_SOURCE_LABEL: Record<TaskSource, string> = {
  "manual": "手動",
  "flow": "業務",
  "derived": "派生",
  "ai": "AI",
  "schedule": "定期",
};
