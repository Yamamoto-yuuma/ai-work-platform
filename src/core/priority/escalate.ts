/**
 * 優先度の時間変化（仕様 §28-4）。
 *
 * 優先度は登録したときの値のまま固定されない。期限が近づけば上がる。
 * 「7日前は通常、2日前は高、超過したら緊急」という考え方を、
 * コードではなくデータ（PriorityEscalation）として持つ。
 */
import type { PriorityEscalation, TaskPriority } from "../model/types";

const RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/**
 * 既定の上げ方。定義に指定がなければこれを使う。
 * 業務ごとの事情はデータ側（priorityEscalation）で上書きできる。
 */
export const DEFAULT_ESCALATION: PriorityEscalation = {
  steps: [
    { withinDays: 2, priority: "high" },
    { withinDays: -1, priority: "urgent" },
  ],
};

/** 期限までの残り日数。今日が期限なら 0、昨日が期限なら -1 */
export function remainingDays(dueAt: string, now: Date): number {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return Number.POSITIVE_INFINITY;
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d1 = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.round((d1 - d0) / 86400000);
}

/**
 * 実際に効いている優先度。
 * 登録された優先度より下げることはしない（上がる方向にだけ働く）。
 */
export function escalatedPriority(
  base: TaskPriority,
  dueAt: string | undefined,
  now: Date,
  escalation: PriorityEscalation = DEFAULT_ESCALATION,
): TaskPriority {
  if (!dueAt) return base;
  const left = remainingDays(dueAt, now);
  let result = base;
  for (const step of escalation.steps) {
    if (left <= step.withinDays && RANK[step.priority] > RANK[result]) {
      result = step.priority;
    }
  }
  return result;
}

/** 期限が近いことで優先度が引き上げられているか（画面で理由を示すために使う） */
export function isEscalated(
  base: TaskPriority,
  dueAt: string | undefined,
  now: Date,
  escalation: PriorityEscalation = DEFAULT_ESCALATION,
): boolean {
  return escalatedPriority(base, dueAt, now, escalation) !== base;
}
