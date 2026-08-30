/**
 * 業務実行の表示名（仕様 §28-10）。
 *
 * 顧客や案件を対象に持つ業務では、対象名と業務名の両方に意味がある
 * （「どの相手の」「どの手順か」）。一方、自分で登録した業務は対象を持たず、
 * subject.label が業務名そのものになる。そのまま並べると画面のあちこちで
 * 同じ名前が2回・3回と続いてしまう。
 *
 * 判定を1か所に集約して、全画面で同じ規則にする。
 */
import type { WorkRun } from "./types";

/** 業務名と別の対象を持つ実行か */
export function hasSubject(run: Pick<WorkRun, "subject" | "title">): boolean {
  const label = run.subject.label?.trim() ?? "";
  return label.length > 0 && label !== run.title.trim();
}

/** 対象名。業務名と同じ（＝対象を持たない）なら null */
export function subjectOf(run: Pick<WorkRun, "subject" | "title">): string | null {
  return hasSubject(run) ? run.subject.label.trim() : null;
}

/** 一覧・見出しに出す名前。対象があれば対象、なければ業務名 */
export function runLabel(run: Pick<WorkRun, "subject" | "title">): string {
  return subjectOf(run) ?? run.title.trim();
}

/**
 * 「対象の◯◯」という文の頭。対象を持たない実行では空文字を返し、
 * 「業務名の業務名のSTEP名」のような重複を作らない。
 */
export function subjectPrefix(run: Pick<WorkRun, "subject" | "title">): string {
  const s = subjectOf(run);
  return s ? `${s}の` : "";
}
