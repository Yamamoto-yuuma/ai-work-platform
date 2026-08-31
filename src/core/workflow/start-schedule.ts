/**
 * 業務を始める日時のスケジュール（仕様 §28-2 の拡張）。
 *
 * 1つの業務に複数の周期を持たせる。
 * 例：週2回の定例と、月末の締めを、同じ業務に並べて持たせる。
 *
 * 大事なのは二重起動を起こさないこと。
 * 複数のスケジュールが同じ日に重なっても、開始の機会は1つにまとめる。
 * 判定は「どのスケジュールが当たったか」ではなく
 * 「今日この業務を始める機会があるか」を返す形にしてある。
 *
 * ここでも業務を勝手に始めない。提示するところまでを担当する。
 */
import type { StartSchedule, StartScheduleRepeat } from "../model/types";

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

/** その月の最終日 */
function lastDayOfMonth(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

/** 「YYYY-MM-DD」。日をまたいだかの判定に使う */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

/** 繰り返しを1文にする。画面はこの文字列を出すだけにする */
export function describeRepeat(r: StartScheduleRepeat): string {
  switch (r.kind) {
    case "daily":
      return "毎日";
    case "weekly": {
      const days = r.weekdays.slice().sort().map((d) => WEEKDAY[d]).filter(Boolean);
      return days.length > 0 ? `毎週 ${days.join("・")}曜日` : "毎週";
    }
    case "monthly-day":
      return `毎月 ${r.day}日`;
    case "monthly-last":
      return "毎月 月末";
  }
}

/** スケジュール1本を1文にする */
export function describeSchedule(s: StartSchedule): string {
  const body = `${describeRepeat(s.repeat)} ${s.time}`;
  return s.label?.trim() ? `${s.label.trim()}：${body}` : body;
}

/**
 * その日に当たる繰り返しか。時刻はここでは見ない。
 *
 * 毎月の指定日は、その月に無い日なら月末に寄せる。
 * 31日を指定した業務が2月だけ飛ぶと、締めの回が黙って消えてしまう。
 */
export function matchesDay(r: StartScheduleRepeat, now: Date): boolean {
  switch (r.kind) {
    case "daily":
      return true;
    case "weekly":
      return r.weekdays.includes(now.getDay());
    case "monthly-day": {
      const last = lastDayOfMonth(now);
      return now.getDate() === Math.min(r.day, last);
    }
    case "monthly-last":
      return now.getDate() === lastDayOfMonth(now);
  }
}

/** その時刻を過ぎているか。時刻が読めないものは当たらない扱いにする */
function timeReached(time: string, now: Date): boolean {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h)) return false;
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + (Number.isFinite(m) ? m : 0);
}

/** いま成立しているスケジュール。無効にしてあるものは数えない */
export function dueSchedules(schedules: StartSchedule[] | undefined, now: Date): StartSchedule[] {
  return (schedules ?? []).filter(
    (s) => s.enabled && matchesDay(s.repeat, now) && timeReached(s.time, now),
  );
}

/**
 * 今日この業務を始める「機会」。
 *
 * 複数のスケジュールが同じ日に重なっても、返るのは1つだけ。
 * id は業務キーと日付から作るので、月末と木曜が重なっても同じ id になり、
 * 二重に起動する余地が無い。matched には当たった全部を入れておき、
 * 「なぜ今日出ているか」を画面で説明できるようにする。
 */
export interface StartOccasion {
  /** 業務 × 日 で一意。同じ日に何本当たっても同じ値になる */
  id: string;
  matched: StartSchedule[];
}

export function startOccasion(
  input: { workflowKey: string; schedules: StartSchedule[] | undefined; now: Date },
): StartOccasion | null {
  const matched = dueSchedules(input.schedules, input.now);
  if (matched.length === 0) return null;
  return { id: `${input.workflowKey}@${dayKey(input.now)}`, matched };
}
