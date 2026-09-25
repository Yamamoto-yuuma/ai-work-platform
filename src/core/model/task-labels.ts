/**
 * タスクの表示ラベル（仕様 §26-5 用語の統一）。
 * 実装上の値ではなく、ユーザーが認識する言葉を1か所で定義する。
 */
import type { TaskSource, TaskStatus } from "./types";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  "todo": "未着手",
  "doing": "進行中",
  "blocked": "ブロック中",
  /*
    相手ボール。自分から見て「投げてある」状態。
    承認だけでなく、返事・資料待ち・先方の作業待ちも含むので、
    値の名前（waiting-approval）より広い言葉を当てる。
  */
  "waiting-approval": "相手待ち",
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
  // 外から取り込んだもの。どこから来たかは詳細で示す
  "external": "連携",
};
