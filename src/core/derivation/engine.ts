/**
 * 派生タスクエンジン。
 * ChangeEvent を唯一の入力とし、決定的なルールでタスク草案を生成する（仕様 §10）。
 * 生成物は必ず confirmationState: "proposed" とする（自動確定しない）。
 */
import type { ChangeEvent, DerivationRule, Task, ImpactLayer } from "../model/types";
import { evaluate } from "../flow/condition";
import { resolveDeadline } from "../schedule/backward";

export function matchRules(change: ChangeEvent, rules: DerivationRule[], workflowKey?: string): DerivationRule[] {
  const scope = { change: { before: change.before, after: change.after, field: change.field } };
  return rules
    .filter((r) => r.enabled)
    .filter((r) => r.trigger.entityType === change.entityType)
    .filter((r) => r.trigger.field === change.field)
    .filter((r) => r.trigger.changeKind === "updated")
    .filter((r) => r.scope.workflowKeys.length === 0 || !workflowKey || r.scope.workflowKeys.includes(workflowKey))
    .filter((r) => evaluate(r.trigger.condition, scope))
    .sort((a, b) => b.priority - a.priority);
}

/** マッチしたルールから派生タスク草案を生成する。ref による依存解決も行う */
export function generateDerivedTasks(
  change: ChangeEvent,
  rules: DerivationRule[],
  assigneeId: string,
): Task[] {
  const now = new Date().toISOString();
  const created: Task[] = [];
  const refToId = new Map<string, string>();

  for (const rule of rules) {
    for (const tpl of rule.effects) {
      const id = `task-${change.id}-${tpl.ref}`;
      refToId.set(tpl.ref, id);
      created.push({
        id,
        title: tpl.title,
        description: tpl.description,
        status: "todo",
        priority: tpl.priority ?? "normal",
        assigneeId,
        dueAt: tpl.deadline ? resolveDeadline(tpl.deadline, { changeAfter: change.after }) : undefined,
        runId: change.runId,
        startableWorkflowKey: tpl.startableWorkflowKey,
        originEventId: change.id,
        derivationRuleId: rule.id,
        source: "derived",
        confirmationState: "proposed", // 必ず提案中で作る（仕様 §10-6）
        impactLayer: tpl.impact,
        dependsOn: [],
        createdAt: now,
      });
    }
  }

  // ref による依存を ID に解決する（タイトル文字列では張らない）
  for (const rule of rules) {
    for (const tpl of rule.effects) {
      if (!tpl.dependsOnRefs?.length) continue;
      const task = created.find((t) => t.id === refToId.get(tpl.ref));
      if (!task) continue;
      task.dependsOn = tpl.dependsOnRefs
        .map((r) => refToId.get(r))
        .filter((v): v is string => Boolean(v));
    }
  }
  return created;
}

export interface ImpactNode {
  id: string;
  label: string;
  layer: ImpactLayer;
  taskId: string;
  status: Task["status"];
  confirmationState: Task["confirmationState"];
  dependsOn: string[];
}

/** 派生タスク群から影響グラフを構築する（仕様 §12-2） */
export function buildImpactGraph(change: ChangeEvent, tasks: Task[]) {
  const nodes: ImpactNode[] = tasks
    .filter((t) => t.originEventId === change.id)
    .map((t) => ({
      id: t.id,
      label: t.title,
      layer: t.impactLayer ?? "indirect",
      taskId: t.id,
      status: t.status,
      confirmationState: t.confirmationState,
      dependsOn: t.dependsOn,
    }));

  return {
    root: {
      changeEventId: change.id,
      label: `${change.entityLabel} ${change.fieldLabel} ${formatValue(change.before)} → ${formatValue(change.after)}`,
    },
    nodes,
    layers: {
      direct: nodes.filter((n) => n.layer === "direct"),
      indirect: nodes.filter((n) => n.layer === "indirect"),
      check: nodes.filter((n) => n.layer === "check"),
    },
  };
}

function formatValue(v: unknown): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return String(v);
}

/** 依存関係の循環を検出する（仕様 §11-4） */
export function detectCycle(tasks: Task[]): string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    if (state.get(id) === 1) return [...stack, id];
    if (state.get(id) === 2) return null;
    state.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  }

  for (const t of tasks) {
    const cycle = visit(t.id);
    if (cycle) return cycle;
  }
  return null;
}
