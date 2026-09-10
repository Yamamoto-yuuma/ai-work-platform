/**
 * 業務フローの STEP から実際のタスクを生成する（仕様 §9-1 / §19-2）。
 *
 * 派生タスク（core/derivation/engine.ts）と同じ構造にしてある。
 * ここは Task[] を組み立てるだけの純粋関数で、登録は UI 側が既存の
 * addTasks で行う。Task 型・ストア・派生ロジックには手を入れていない。
 *
 * ID は決定的にする。STEP をやり直して再度完了しても同じ ID になり、
 * 同じタスクが二重に作られない（addTasks は既存 ID を取り込まない）。
 */
import type { StepDefinition, StepRun, Task, TaskPriority, WorkRun } from "../model/types";
import { addBusinessDays } from "../schedule/backward";

/** task-create 部品の設定。seed 側は title / offsetDays / priority だけを書けばよい */
export interface StepTaskTemplate {
  title: string;
  description?: string;
  /** STEP を完了した時点からの日数 */
  offsetDays?: number;
  /** 既定は暦日。営業日で数えたい場合に true */
  businessDaysOnly?: boolean;
  priority?: TaskPriority;
  /** このタスクから開始できる業務フロー */
  startableWorkflowKey?: string;
  /** 同じ STEP で作るタスク同士の依存を張るための参照名 */
  ref?: string;
  dependsOnRefs?: string[];
  /*
    このタスクに付いてくる細目。定例の業務で、毎回やることが決まっている
    ぶら下がりを、業務の定義側に置いておくためのもの。

    名前だけ持つ。期限や見積は親に従う。細目ごとに日付を持たせると、
    定義するときに決めることが増えて、結局書かれなくなる。
  */
  subtasks?: string[];
}

/** チェックが外されたテンプレートは作らない（外し方は TaskCreateRenderer と揃える） */
export function isTemplateSelected(stepRun: StepRun, index: number): boolean {
  return stepRun.checklistState[`task-${index}`] !== false;
}

export function stepTaskId(runId: string, stepKey: string, index: number): string {
  return `task-${runId}-${stepKey}-${index}`;
}

/** 細目の ID。親と同じく決まった形にして、やり直しても二重にしない */
export function stepSubtaskId(runId: string, stepKey: string, index: number, sub: number): string {
  return `${stepTaskId(runId, stepKey, index)}-sub-${sub}`;
}

export function readTemplates(step: StepDefinition): StepTaskTemplate[] {
  const list = step.config.templates;
  return Array.isArray(list) ? (list as StepTaskTemplate[]) : [];
}

/** テンプレートの offsetDays から期限を求める */
export function resolveTemplateDue(tpl: StepTaskTemplate, from: Date): string | undefined {
  if (tpl.offsetDays === undefined) return undefined;
  const due = tpl.businessDaysOnly
    ? addBusinessDays(from, tpl.offsetDays)
    : new Date(from.getTime() + tpl.offsetDays * 24 * 60 * 60 * 1000);
  due.setHours(18, 0, 0, 0);
  return due.toISOString();
}

/**
 * task-create STEP を完了したときに生成すべきタスクを返す。
 * 対象外の部品や、チェックを外されたテンプレートは含まない。
 */
export function generateStepTasks(input: {
  step: StepDefinition;
  stepRun: StepRun;
  run: WorkRun;
  now: Date;
}): Task[] {
  const { step, stepRun, run, now } = input;
  if (step.componentType !== "task-create") return [];

  const templates = readTemplates(step);
  const createdAt = now.toISOString();
  const refToId = new Map<string, string>();
  const tasks: Task[] = [];

  templates.forEach((tpl, i) => {
    if (!isTemplateSelected(stepRun, i)) return;
    const id = stepTaskId(run.id, step.key, i);
    if (tpl.ref) refToId.set(tpl.ref, id);

    tasks.push({
      id,
      title: tpl.title,
      description: tpl.description,
      status: "todo",
      priority: tpl.priority ?? "normal",
      // 業務の担当者を引き継ぐ
      assigneeId: run.assigneeId,
      dueAt: resolveTemplateDue(tpl, now),
      // 由来：どの業務のどの STEP から生まれたか
      runId: run.id,
      stepKey: step.key,
      startableWorkflowKey: tpl.startableWorkflowKey,
      source: "flow",
      // STEP 上でチェックを確認したうえで完了しているため、承認ゲートは通さない
      confirmationState: "confirmed",
      dependsOn: [],
      createdAt,
    });
  });

  /*
    細目を作る。親と同じ期限・同じ担当で、親にぶら下げる。

    一覧のトップレベルには出さない（parentTaskId を持つものは、
    親の中だけで扱う）。出すと、定例業務を1つ始めただけで
    一覧が細目で埋まり、抱えている量が分からなくなる。
  */
  templates.forEach((tpl, i) => {
    if (!isTemplateSelected(stepRun, i)) return;
    const parentId = stepTaskId(run.id, step.key, i);
    const parent = tasks.find((t) => t.id === parentId);
    if (!parent) return;

    (tpl.subtasks ?? [])
      .map((label, j) => ({ label: label.trim(), j }))
      // 名前の無い細目は作らない。一覧に空行が並ぶだけになる
      .filter(({ label }) => label.length > 0)
      .forEach(({ label, j }) => {
        tasks.push({
          id: stepSubtaskId(run.id, step.key, i, j),
          title: label,
          status: "todo",
          priority: parent.priority,
          assigneeId: run.assigneeId,
          dueAt: parent.dueAt,
          runId: run.id,
          stepKey: step.key,
          parentTaskId: parentId,
          source: "flow",
          confirmationState: "confirmed",
          dependsOn: [],
          createdAt,
        });
      });
  });

  // ref による依存を ID に解決する（タイトル文字列では張らない）
  templates.forEach((tpl, i) => {
    if (!tpl.dependsOnRefs?.length) return;
    const task = tasks.find((t) => t.id === stepTaskId(run.id, step.key, i));
    if (!task) return;
    task.dependsOn = tpl.dependsOnRefs
      .map((r) => refToId.get(r))
      .filter((v): v is string => Boolean(v));
  });

  return tasks;
}
