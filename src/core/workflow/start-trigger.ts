/**
 * 業務の開始条件（仕様 §28-2）。
 *
 * 開始条件が来ても業務を勝手に始めない。「今日開始する業務」として
 * 提示するところまでを担当し、開始するかどうかは自分が決める。
 */
import type { StartTrigger, WorkRun, WorkflowDefinition } from "../model/types";
import { evaluate } from "../flow/condition";

export const WORK_KIND_LABEL = {
  routine: "定型業務",
  reactive: "発生型業務",
  term: "期間限定業務",
  urgent: "緊急対応",
  other: "その他",
} as const;

export const START_TRIGGER_LABEL = {
  manual: "手動で開始",
  date: "日付で開始",
  weekday: "曜日で開始",
  time: "時間で開始",
  event: "出来事が起きたら開始",
  "after-workflow": "他の業務が終わったら開始",
  task: "タスクが発生したら開始",
  condition: "条件が成立したら開始",
} as const;

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** 開始条件を1文にする。画面はこの文字列を出すだけにする */
export function describeStartTrigger(t: StartTrigger | undefined): string {
  if (!t || t.kind === "manual") return "自分で開始する";
  switch (t.kind) {
    case "date":
      return t.date
        ? `${new Date(`${t.date}T00:00:00`).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" })} に開始`
        : "日付で開始";
    case "weekday": {
      const days = (t.weekdays ?? []).map((d) => WEEKDAY[d]).filter(Boolean);
      return days.length > 0 ? `毎週 ${days.join("・")}曜日に開始` : "曜日で開始";
    }
    case "time":
      return t.time ? `毎日 ${t.time} 以降に開始` : "時間で開始";
    case "event":
      return t.eventLabel ? `${t.eventLabel} が起きたら開始` : "出来事が起きたら開始";
    case "after-workflow":
      return t.afterWorkflowKey ? "指定した業務が完了したら開始" : "他の業務が終わったら開始";
    case "task":
      return t.taskLabel ? `${t.taskLabel} が発生したら開始` : "タスクが発生したら開始";
    case "condition":
      return t.note ? `条件成立で開始：${t.note}` : "条件が成立したら開始";
    default:
      return "自分で開始する";
  }
}

/**
 * 今日この業務を開始する日か。
 * 「起きたら／発生したら」のような自分にしか分からない条件は、
 * システムが勝手に判定しない（false を返し、説明だけを出す）。
 */
export function isStartDue(
  def: WorkflowDefinition,
  input: { runs: WorkRun[]; now: Date },
): boolean {
  const t = def.startTrigger;
  if (!t) return false;
  const { now } = input;

  switch (t.kind) {
    case "date": {
      if (!t.date) return false;
      const d = new Date(`${t.date}T00:00:00`);
      // 過ぎていてもまだ開始していないなら出し続ける（取りこぼさないため）
      return !Number.isNaN(d.getTime()) && (sameDay(d, now) || d < now);
    }
    case "weekday":
      return (t.weekdays ?? []).includes(now.getDay());
    case "time": {
      if (!t.time) return false;
      const [h, m] = t.time.split(":").map(Number);
      if (Number.isNaN(h)) return false;
      return now.getHours() * 60 + now.getMinutes() >= h * 60 + (m || 0);
    }
    case "after-workflow": {
      if (!t.afterWorkflowKey) return false;
      return input.runs.some(
        (r) => r.workflowKey === t.afterWorkflowKey && r.status === "done",
      );
    }
    case "condition":
      return t.condition ? evaluate(t.condition, { now: now.toISOString() }) : false;
    default:
      // manual / event / task は自分の判断で始める
      return false;
  }
}

/**
 * 今日開始できる業務。すでに動いている（または今日始めた）ものは出さない。
 * HOME で「今日始める業務」を示すために使う。
 */
export function startableToday(input: {
  workflows: WorkflowDefinition[];
  runs: WorkRun[];
  userId: string;
  now: Date;
}): WorkflowDefinition[] {
  const { workflows, runs, userId, now } = input;
  return workflows.filter((def) => {
    if (def.status !== "published") return false;
    if (!isStartDue(def, { runs, now })) return false;
    // 進行中・待ち中があるなら、それを進めるのが先
    const mine = runs.filter((r) => r.workflowKey === def.key && r.assigneeId === userId);
    if (mine.some((r) => r.status === "active" || r.status === "paused")) return false;
    // 今日すでに開始したものは再提示しない
    return !mine.some((r) => sameDay(new Date(r.startedAt), now));
  });
}
