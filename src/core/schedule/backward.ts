/** 期限の算出と逆算スケジューリング（仕様 §13） */
import type { DeadlineRule, Task } from "../model/types";

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

export interface ScheduleWarning {
  taskId: string;
  message: string;
}

/**
 * ゴール期限から逆算し、依存関係を考慮して各タスクの期限案を出す。
 * 結果は提案であり、自動確定しない（仕様 §13-7）。
 */
export function backwardSchedule(
  tasks: Task[],
  goalDueAt: string,
): { proposals: { taskId: string; dueAt: string }[]; warnings: ScheduleWarning[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const proposals: { taskId: string; dueAt: string }[] = [];
  const warnings: ScheduleWarning[] = [];
  const goal = new Date(goalDueAt);
  const resolved = new Map<string, Date>();

  // 後続（自分に依存しているタスク）を引く
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), t.id]);
    }
  }

  function latestFinish(id: string, depth = 0): Date {
    if (resolved.has(id)) return resolved.get(id)!;
    if (depth > 50) return goal;

    const deps = dependents.get(id) ?? [];
    // 後続がなければゴール直前。後続があれば、最も早い後続の開始日まで
    const byDependency = deps.length === 0
      ? addBusinessDays(goal, -1)
      : new Date(Math.min(...deps.map((x) => addBusinessDays(latestFinish(x, depth + 1), -1).getTime())));

    // タスク自身の期限ルール（既に算出済みの dueAt）も上限として尊重する。
    // 依存関係とルールの両方を満たす、より早い方を採用する。
    const own = byId.get(id)?.dueAt ? new Date(byId.get(id)!.dueAt!) : null;
    const d = own && !Number.isNaN(own.getTime()) && own < byDependency ? own : byDependency;

    resolved.set(id, d);
    return d;
  }

  const now = new Date();
  for (const t of tasks) {
    const due = latestFinish(t.id);
    proposals.push({ taskId: t.id, dueAt: due.toISOString() });
    if (due < now) {
      warnings.push({ taskId: t.id, message: `「${t.title}」は逆算すると期限が過去になります（間に合いません）` });
    }
  }

  // 同一日への集中を警告
  const byDay = new Map<string, number>();
  for (const p of proposals) {
    const key = p.dueAt.slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  for (const [day, count] of byDay) {
    if (count >= 3) {
      warnings.push({ taskId: "", message: `${day} に ${count} 件の期限が集中しています` });
    }
  }

  return { proposals, warnings };
}
