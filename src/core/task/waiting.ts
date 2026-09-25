/**
 * 相手ボール（仕様 §11-3 の待ち状態のうち、自分の外に出ているもの）。
 *
 * 待ちには2種類ある。
 *   ブロック中  … 自分の中の順番待ち。先行タスクが終われば動く（core/task/dependency）
 *   相手待ち    … 自分の手を離れている。相手が動くまでこちらは何もできない
 * 前者は自分で順番を詰めれば解ける。後者は催促するしかない。
 * 同じ「待ち」にまとめると、催促すべきものが順番待ちに埋もれる。
 *
 * 状態そのものは既存の TaskStatus "waiting-approval" をそのまま使う。
 * 新しい状態は増やさない。
 *
 * 何日待っているかは保存しない。waitingSince と現在時刻から毎回導く。
 * 保存すると、日をまたぐたびに全件を書き換えることになる。
 */
import type { Task } from "../model/types";

/** 相手ボールを表す状態。値を直接書かずにここを参照する */
export const WAITING_STATUS = "waiting-approval" as const;

/** 何日放っておかれたら催促どきとみなすか。既定は3日（土日を挟んでも1回は返る長さ） */
export const WAITING_STALE_DAYS = 3;

export function isWaiting(task: Task): boolean {
  return task.status === WAITING_STATUS;
}

/**
 * 待ち始めてから何日経ったか。
 * 日付の境目で数える（時刻の差ではない）ので、昨日の夕方に投げたものは
 * 翌朝には「1日」になる。人が「何日待っている」と言うときの数え方に合わせる。
 */
export function waitingDays(task: Task, now: Date): number | undefined {
  if (!isWaiting(task) || !task.waitingSince) return undefined;
  const from = new Date(task.waitingSince);
  if (Number.isNaN(from.getTime())) return undefined;
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** 待ちが長引いているか（催促どき） */
export function isStaleWait(task: Task, now: Date, afterDays = WAITING_STALE_DAYS): boolean {
  const d = waitingDays(task, now);
  return d !== undefined && d >= afterDays;
}

/**
 * 状態の欄に出す短い文字列。「相手待ち」だけでは、
 * さっき投げたものと2週間放置されているものが同じ見た目になる。
 */
export function waitingDayLabel(task: Task, now: Date): string | undefined {
  const d = waitingDays(task, now);
  if (d === undefined) return undefined;
  // 一覧の状態欄は狭い。「今日から」は入らないので今日だけ短く言う
  return d === 0 ? "今日" : `${d}日`;
}

/** 誰を待っているか。書いていなければ聞かずに済ませる */
export function waitingTitle(task: Task, now: Date): string | undefined {
  if (!isWaiting(task)) return undefined;
  const d = waitingDayLabel(task, now);
  const who = task.waitingFor?.trim();
  if (who && d) return `${who} を待っています（${d}）`;
  if (who) return `${who} を待っています`;
  if (d) return `相手の返事を待っています（${d}）`;
  return "相手の返事を待っています";
}

/** 相手ボールだけを、待ちが長い順に返す。催促はふつう古いものからする */
export function waitingTasks(tasks: Task[], now: Date): Task[] {
  return tasks
    .filter((t) => isWaiting(t) && t.status !== "done" && t.status !== "canceled")
    .sort((a, b) => {
      const da = waitingDays(a, now) ?? -1;
      const db = waitingDays(b, now) ?? -1;
      if (da !== db) return db - da;
      return a.createdAt.localeCompare(b.createdAt);
    });
}
