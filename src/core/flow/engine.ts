/**
 * 業務フローエンジン。純粋関数のみ。
 * STEP の遷移・分岐評価・合流待ち・完了判定を担う（仕様 §7-6 / §7-7）。
 */
import type {
  WorkflowDefinition, WorkRun, StepRun, StepDefinition, FlowEdge, WorkEvent,
} from "../model/types";
import { evaluate, deriveMissingPaths } from "./condition";

export function buildScope(run: WorkRun, stepRuns: StepRun[]): Record<string, unknown> {
  const stepOutputs: Record<string, unknown> = {};
  for (const sr of stepRuns) stepOutputs[sr.stepKey] = sr.output;
  return { context: run.context, steps: stepOutputs, run };
}

export function getStep(def: WorkflowDefinition, key: string): StepDefinition | undefined {
  return def.steps.find((s) => s.key === key);
}

export function outgoingEdges(def: WorkflowDefinition, from: string): FlowEdge[] {
  return def.edges.filter((e) => e.from === from).sort((a, b) => a.priority - b.priority);
}

export function incomingEdges(def: WorkflowDefinition, to: string): FlowEdge[] {
  return def.edges.filter((e) => e.to === to);
}

/**
 * 合流判定。joinPolicy: "all" のエッジで入ってくる STEP は、
 * 先行 STEP が全て done になるまで活性化しない（レビュー指摘 A-1）。
 */
function canActivate(
  def: WorkflowDefinition,
  target: string,
  stepRuns: StepRun[],
  scope: Record<string, unknown>,
  justCompletedKey: string,
): boolean {
  const incoming = incomingEdges(def, target);
  const joinAll = incoming.filter((e) => e.joinPolicy === "all");
  if (joinAll.length === 0) return true;
  return joinAll.every((e) => {
    // 条件付きエッジは、条件が偽なら待たない
    if (e.condition && !evaluate(e.condition, scope)) return true;
    // いま完了させた STEP は done として扱う（stepRuns への反映はこの後のため）
    if (e.from === justCompletedKey) return true;
    const st = stepRuns.find((sr) => sr.stepKey === e.from)?.status;
    return st === "done" || st === "skipped";
  });
}

/** 完了した STEP から次に活性化すべき STEP を決定する */
export function resolveNextSteps(
  def: WorkflowDefinition,
  fromStepKey: string,
  stepRuns: StepRun[],
  scope: Record<string, unknown>,
): { activate: string[]; skipped: string[] } {
  const edges = outgoingEdges(def, fromStepKey);
  const activate: string[] = [];
  const skipped: string[] = [];
  let matched = false;

  for (const edge of edges) {
    const conditionMet = evaluate(edge.condition, scope);
    if (!conditionMet) {
      skipped.push(edge.to);
      continue;
    }
    // 条件なしエッジが複数あれば並列。条件付きは最初に成立したものだけを採用
    if (edge.condition && matched) continue;
    if (edge.condition) matched = true;
    if (canActivate(def, edge.to, stepRuns, scope, fromStepKey)) activate.push(edge.to);
  }
  return { activate: Array.from(new Set(activate)), skipped };
}

export interface MissingItem {
  key: string;
  label: string;
  reason: string;
  /** STEP本来の項目か、一時ルールが追加した項目か（仕様 §14-4） */
  source: "step" | "rule";
}

export interface StepCompletionCheck {
  canComplete: boolean;
  missing: MissingItem[];
}

/** STEP の完了条件を検証する。満たさない場合は「何が足りないか」を返す（仕様 §27-3） */
export function checkStepCompletion(
  step: StepDefinition,
  stepRun: StepRun,
  extraRequiredChecklist: { key: string; label: string; required: boolean }[],
  extraRequiredFields: { key: string; label: string; required: boolean }[],
  scope: Record<string, unknown>,
): StepCompletionCheck {
  const missing: MissingItem[] = [];

  // 部品標準の完了条件
  const cfg = step.config as {
    items?: { key: string; label: string; required?: boolean }[];
    fields?: { key: string; label: string; required?: boolean }[];
    outputVar?: string;
  };

  if (step.componentType === "checklist") {
    for (const item of cfg.items ?? []) {
      if (item.required !== false && !stepRun.checklistState[item.key]) {
        missing.push({ key: item.key, label: item.label, reason: "未チェック", source: "step" });
      }
    }
  }

  if (step.componentType === "input" || step.componentType === "select") {
    for (const f of cfg.fields ?? []) {
      const v = stepRun.output[f.key];
      if (f.required !== false && (v === undefined || v === "" || v === null)) {
        missing.push({ key: f.key, label: f.label, reason: "未入力", source: "step" });
      }
    }
  }

  // 一時ルールが追加したチェック項目
  for (const item of extraRequiredChecklist) {
    if (item.required && !stepRun.checklistState[item.key]) {
      missing.push({ key: item.key, label: item.label, reason: "一時ルールにより必須", source: "rule" });
    }
  }
  for (const f of extraRequiredFields) {
    const v = stepRun.output[f.key];
    if (f.required && (v === undefined || v === "" || v === null)) {
      missing.push({ key: f.key, label: f.label, reason: "一時ルールにより必須", source: "rule" });
    }
  }

  // 明示的な完了条件
  if (step.completionCriteria) {
    for (const path of deriveMissingPaths(step.completionCriteria, scope)) {
      missing.push({ key: path, label: path, reason: "完了条件を満たしていません", source: "step" });
    }
  }

  return { canComplete: missing.length === 0, missing };
}

export function isRunComplete(def: WorkflowDefinition, stepRuns: StepRun[]): boolean {
  if (!def.completionPolicy.requireAllRequiredSteps) return false;
  return def.steps
    .filter((s) => s.required)
    .every((s) => {
      const sr = stepRuns.find((r) => r.stepKey === s.key);
      return sr?.status === "done" || sr?.status === "skipped";
    });
}

/** 進捗率（完了STEP数 / 到達可能な必須STEP数） */
/**
 * 業務実行の現在地。全画面でこの1関数だけを使う。
 *
 * 「表示中のSTEP」ではなく「業務の現在STEP」を基準にする。
 * 過去のSTEPを開いて眺めても業務の現在地は動かない。
 */
export function runProgress(
  def: WorkflowDefinition,
  run: Pick<WorkRun, "status" | "currentStepKeys">,
  stepRuns: StepRun[],
): { index: number; total: number; done: number } {
  const planned = plannedSteps(def);
  const total = planned.length;
  const done = planned.filter(
    (s) => stepRuns.find((sr) => sr.stepKey === s.key)?.status === "done",
  ).length;

  if (total === 0) return { index: 0, total: 0, done: 0 };
  // 終わった業務・中止した業務は、これ以上進まない
  if (run.status === "done") return { index: total, total, done: total };
  if (run.status === "canceled") return { index: Math.min(done + 1, total), total, done };

  return { ...stepPosition(def, stepRuns, run.currentStepKeys[0]), done };
}

/**
 * 進捗「n / N」の分母になる STEP（仕様 §6-2）。
 *
 * 業務定義の全 STEP を基準にする。分岐でどのルートを通っても分母は変わらない。
 * 実行中に分母が動くと「全体で何ステップなのか」が分からなくなるため、
 * スキップされた STEP も数に含める（業務フロー詳細の「n ステップ」と同じ数）。
 * 分岐ノードは人が実行するものではないので数えない。
 */
export function plannedSteps(def: WorkflowDefinition): StepDefinition[] {
  return orderedSteps(def).filter((s) => s.componentType !== "branch");
}

/**
 * 実行予定 STEP の中での現在位置（1 始まり）と総数。
 * 現在 STEP が実行予定に含まれない場合は、完了済み数 + 1 を位置とする。
 */
export function stepPosition(
  def: WorkflowDefinition,
  stepRuns: StepRun[],
  currentStepKey: string | null | undefined,
): { index: number; total: number } {
  const planned = plannedSteps(def);
  const total = planned.length;
  if (total === 0) return { index: 0, total: 0 };

  const at = currentStepKey ? planned.findIndex((s) => s.key === currentStepKey) : -1;
  if (at >= 0) return { index: at + 1, total };

  const settled = planned.filter((s) => {
    const st = stepRuns.find((sr) => sr.stepKey === s.key)?.status;
    return st === "done" || st === "skipped";
  }).length;
  return { index: Math.min(settled + 1, total), total };
}

/** STEP を並び順（トポロジカル順）に整列する。マップ描画とレール表示に使う */
export function orderedSteps(def: WorkflowDefinition): StepDefinition[] {
  const indeg = new Map<string, number>();
  for (const s of def.steps) indeg.set(s.key, 0);
  for (const e of def.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);

  const queue = def.steps.filter((s) => (indeg.get(s.key) ?? 0) === 0).map((s) => s.key);
  const out: string[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    for (const e of outgoingEdges(def, key)) {
      indeg.set(e.to, (indeg.get(e.to) ?? 1) - 1);
      if ((indeg.get(e.to) ?? 0) <= 0) queue.push(e.to);
    }
  }
  for (const s of def.steps) if (!seen.has(s.key)) out.push(s.key);
  return out.map((k) => def.steps.find((s) => s.key === k)!).filter(Boolean);
}

/** 階層（ゴールまでの深さ）を算出する。業務マップのレイアウトに使う */
export function stepDepths(def: WorkflowDefinition): Map<string, number> {
  const depth = new Map<string, number>();
  for (const s of orderedSteps(def)) {
    const incoming = incomingEdges(def, s.key);
    const d = incoming.length === 0
      ? 0
      : Math.max(...incoming.map((e) => (depth.get(e.from) ?? 0) + 1));
    depth.set(s.key, d);
  }
  return depth;
}

export function makeEvent(
  type: WorkEvent["type"],
  actor: string,
  payload: Record<string, unknown>,
  runId?: string,
): WorkEvent {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 10)}`,
    runId, type, actor, payload,
    createdAt: new Date().toISOString(),
  };
}
