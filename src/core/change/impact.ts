/**
 * 起票された変更の影響プレビュー（仕様 §10-5 の 3〜6、§12）。
 *
 * ここでは既存のエンジンを組み合わせるだけで、新しい判断ロジックは持たない。
 *   - 派生タスク  : core/derivation/engine.ts（matchRules / generateDerivedTasks）
 *   - 期限の再提案: core/schedule/cascade.ts（B-4 と同じ営業日計算）
 *   - 循環検出    : core/derivation/engine.ts（detectCycle）
 *
 * 戻り値は全て「提案」であり、ストアには一切書き込まない。
 */
import type { ChangeEvent, DerivationRule, Task } from "../model/types";
import { matchRules, generateDerivedTasks, detectCycle } from "../derivation/engine";
import { proposeRunDeadlineShift, type DeadlineProposal } from "../schedule/cascade";
import type { ChangeTarget } from "./targets";

export interface ChangeImpact {
  /** まだ保存していない変更イベント */
  change: ChangeEvent;
  /** マッチした派生ルール。0件なら「ルール未登録」を正直に伝える */
  matchedRules: DerivationRule[];
  /** 新しく発生するタスクの草案（必ず proposed） */
  derivedTasks: Task[];
  /** 既存タスクの期限の再提案 */
  deadlineProposals: DeadlineProposal[];
  /** 依存関係の循環（既存タスク＋草案で判定） */
  cycle: string[] | null;
  /** 影響が1件も無いか */
  isEmpty: boolean;
}

export function analyzeChange(input: {
  change: ChangeEvent;
  target: ChangeTarget;
  workflowKey: string;
  derivationRules: DerivationRule[];
  tasks: Task[];
  assigneeId: string;
}): ChangeImpact {
  const { change, target, workflowKey, derivationRules, tasks, assigneeId } = input;

  // 派生タスク：既存エンジンをそのまま使う
  const matchedRules = matchRules(change, derivationRules, workflowKey);
  const derivedTasks = generateDerivedTasks(change, matchedRules, assigneeId);

  // 期限の再提案：業務全体の期限が動いた場合のみ。既存スケジューラを使う
  const deadlineProposals =
    target.kind === "run-deadline"
      ? proposeRunDeadlineShift({
          runId: change.runId ?? "",
          previousDueAt: String(change.before),
          nextDueAt: String(change.after),
          allTasks: tasks,
        })
      : [];

  const cycle = detectCycle([...tasks, ...derivedTasks]);

  return {
    change,
    matchedRules,
    derivedTasks,
    deadlineProposals,
    cycle,
    isEmpty: derivedTasks.length === 0 && deadlineProposals.length === 0,
  };
}

/** 既に確定済みで、再確定しても新規にならない草案を除く */
export function newDerivedTasks(impact: ChangeImpact, tasks: Task[]): Task[] {
  const existing = new Set(tasks.map((t) => t.id));
  return impact.derivedTasks.filter((t) => !existing.has(t.id));
}
