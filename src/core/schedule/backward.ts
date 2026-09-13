/** 期限の算出（仕様 §13） */
import type { DeadlineRule } from "../model/types";

const DAY = 24 * 60 * 60 * 1000;

export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d;
}

export function resolveDeadline(
  rule: DeadlineRule,
  anchors: { runStartedAt?: string; runDueAt?: string; changeAfter?: unknown },
): string | undefined {
  let base: Date;
  switch (rule.from) {
    case "run.startedAt":
      if (!anchors.runStartedAt) return undefined;
      base = new Date(anchors.runStartedAt);
      break;
    case "run.dueAt":
      if (!anchors.runDueAt) return undefined;
      base = new Date(anchors.runDueAt);
      break;
    case "change.after":
      if (typeof anchors.changeAfter !== "string") return undefined;
      base = new Date(anchors.changeAfter);
      break;
    case "now":
      base = new Date();
      break;
  }
  if (Number.isNaN(base.getTime())) return undefined;

  if (rule.offsetHours) base = new Date(base.getTime() + rule.offsetHours * 60 * 60 * 1000);
  if (rule.offsetDays) {
    base = rule.businessDaysOnly
      ? addBusinessDays(base, rule.offsetDays)
      : new Date(base.getTime() + rule.offsetDays * DAY);
  }
  return base.toISOString();
}
