"use client";

/**
 * 画面から業務エンジンを使うための合成フック。
 * ここでは組み立てのみを行い、判断ロジックは全て src/core/ 側にある。
 */
import { useMemo } from "react";
import { useStore } from "@/adapters/memory/store";
import {
  buildScope, getStep, isRunComplete, orderedSteps, runProgress, resolveNextSteps,
  checkStepCompletion, outgoingEdges,
} from "@/core/flow/engine";
import { detectConflicts, overlayStep, resolveRulesForStep, isRuleActive } from "@/core/rules/resolver";
import { resolveStepContext } from "@/core/context/resolver";
import { rankActions, resolveNextAction, waitingRuns, headlineForStep } from "@/core/context/next-action";
import type { EffectiveStep, StepDefinition, StepRun, WorkRun, WorkflowDefinition } from "@/core/model/types";

/** 現在時刻。設定でデモ用の業務日が指定されていればそれを返す */
export function useNow(): Date {
  const { state } = useStore();
  return useMemo(
    () => (state.simulatedDate ? new Date(state.simulatedDate) : new Date()),
    [state.simulatedDate],
  );
}

export function useWorkflows() {
  const { workflows } = useStore();
  return workflows.filter((w) => w.status === "published");
}

export function useActiveRules() {
  const { state } = useStore();
  const now = useNow();
  return {
    active: state.businessRules.filter((r) => isRuleActive(r, now)),
    all: state.businessRules,
    now,
  };
}

export interface RunView {
  run: WorkRun;
  def: WorkflowDefinition;
  stepRuns: StepRun[];
  ordered: StepDefinition[];
  /** 業務の現在地（表示中のSTEPではない）。全画面で同じ値 */
  progress: { index: number; total: number; done: number };
  scope: Record<string, unknown>;
  statusOf: (key: string) => StepRun["status"];
}

export function useRunView(runId: string | undefined): RunView | null {
  const { state, workflows } = useStore();
  return useMemo(() => {
    if (!runId) return null;
    const run = state.runs.find((r) => r.id === runId);
    if (!run) return null;
    const def =
      workflows.find((w) => w.key === run.workflowKey && w.version === run.workflowVersion) ??
      workflows.find((w) => w.key === run.workflowKey);
    if (!def) return null;
    const stepRuns = state.stepRunsByRun[run.id] ?? [];
    return {
      run, def, stepRuns,
      ordered: orderedSteps(def),
      progress: runProgress(def, run, stepRuns),
      scope: buildScope(run, stepRuns),
      statusOf: (key: string) => stepRuns.find((s) => s.stepKey === key)?.status ?? "pending",
    };
  }, [runId, state.runs, state.stepRunsByRun, workflows]);
}

/** 現在STEPに対する EffectiveStep（ルール合成後）と業務コンテキスト */
export function useStepView(view: RunView | null, stepKey: string | undefined) {
  const { state, knowledge } = useStore();
  const now = useNow();
  return useMemo(() => {
    if (!view || !stepKey) return null;
    const step = getStep(view.def, stepKey);
    if (!step) return null;
    const stepRun =
      view.stepRuns.find((s) => s.stepKey === stepKey) ??
      { stepKey, status: "active" as const, output: {}, checklistState: {}, appliedRuleIds: [] };

    const rules = resolveRulesForStep({
      rules: state.businessRules, workflow: view.def, step, scope: view.scope, now,
    });
    const effective: EffectiveStep = overlayStep(step, rules);
    const conflicts = detectConflicts(rules);

    const context = resolveStepContext({
      workflow: view.def, run: view.run, effectiveStep: effective,
      knowledge, tasks: state.tasks, conflicts, now,
    });

    const completion = checkStepCompletion(
      effective, stepRun, effective.extraChecklistItems, effective.extraFields, view.scope,
    );

    return { step, effective, stepRun, context, completion, rules, headline: headlineForStep(step, view.run) };
  }, [view, stepKey, state.businessRules, state.tasks, knowledge, now]);
}

/**
 * 次に活性化するSTEPの予測。分岐先を事前に表示するために使う。
 * 直後が条件分岐ノードの場合は、その分岐の選択肢まで見通して返す。
 */
export function useNextStepPreview(view: RunView | null, stepKey: string | undefined) {
  return useMemo(() => {
    if (!view || !stepKey) return { activate: [], skipped: [], branches: [] };
    const { activate, skipped } = resolveNextSteps(view.def, stepKey, view.stepRuns, view.scope);

    // 分岐ノードを透過して、実際に分かれる地点のエッジを取る
    let edgeSource = stepKey;
    const direct = outgoingEdges(view.def, stepKey);
    if (direct.length === 1) {
      const only = getStep(view.def, direct[0].to);
      if (only?.componentType === "branch") edgeSource = only.key;
    }

    const taken = edgeSource === stepKey
      ? activate
      : resolveNextSteps(view.def, edgeSource, view.stepRuns, view.scope).activate;

    const branches = outgoingEdges(view.def, edgeSource).map((e) => ({
      to: e.to,
      label: e.label,
      willTake: taken.includes(e.to),
      hasCondition: Boolean(e.condition),
    }));
    return { activate, skipped, branches };
  }, [view, stepKey]);
}

export function useNextAction() {
  const { state, workflows } = useStore();
  const now = useNow();
  return useMemo(() => {
    const input = {
      runs: state.runs, stepRunsByRun: state.stepRunsByRun, workflows,
      tasks: state.tasks, userId: state.currentUserId, now,
    };
    return {
      next: resolveNextAction(input),
      ranked: rankActions(input),
      waiting: waitingRuns(input),
    };
  }, [state, workflows, now]);
}

export { isRunComplete, resolveNextSteps, getStep, orderedSteps };
