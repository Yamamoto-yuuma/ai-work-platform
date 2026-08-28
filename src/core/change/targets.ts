/**
 * 業務実行中に起票できる「変更対象」の一覧（仕様 §10-3）。
 *
 * 変更対象をコードに直書きしない。選べる対象は
 *   - 業務実行そのものが持つ属性（期限）
 *   - 登録済みの派生ルールが監視している項目
 * から機械的に導出する。派生ルールを1件足せば、選択肢も自動的に増える。
 */
import type {
  ChangeEvent, DerivationRule, WorkRun, WorkflowDefinition,
} from "../model/types";

/** 影響の見方が異なるため、対象は種別を持つ */
export type ChangeTargetKind =
  /** 業務実行の期限。既存スケジューラで後続タスクへの影響を出す */
  | "run-deadline"
  /** 派生ルールが監視している項目。既存の派生エンジンで影響を出す */
  | "derivation"
  /** どのルールにも該当しない変更。履歴として記録するだけ */
  | "other";

export interface ChangeTarget {
  /** 選択肢のキー */
  id: string;
  kind: ChangeTargetKind;
  /** 選択肢の見出し */
  label: string;
  /** 何が起きるかの短い説明 */
  hint: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  field: string;
  fieldLabel: string;
  /** 入力欄の種類 */
  valueType: "date" | "text";
  /** 変更前の値が分かる場合のみ埋める。分からないものは undefined のまま */
  currentValue?: string;
  /** 由来した派生ルール（derivation のときだけ） */
  ruleId?: string;
  ruleName?: string;
}

/**
 * この業務実行で起票できる変更対象を返す。
 * 並び順は「期限 → 派生ルール由来 → その他」。
 */
export function listChangeTargets(input: {
  run: WorkRun;
  workflow: WorkflowDefinition;
  derivationRules: DerivationRule[];
}): ChangeTarget[] {
  const { run, workflow, derivationRules } = input;
  const targets: ChangeTarget[] = [];

  // 1. 業務全体の期限
  targets.push({
    id: "run-deadline",
    kind: "run-deadline",
    label: "業務全体の期限",
    hint: "この業務の期限が変わった。関係するタスクの期限を再提案します",
    entityType: "run",
    entityId: run.id,
    entityLabel: run.subject.label,
    field: "dueAt",
    fieldLabel: "業務の期限",
    valueType: "date",
    currentValue: run.dueAt,
  });

  // 2. 登録済みの派生ルールが監視している項目
  //    同じ entityType + field を複数のルールが見ている場合は1つの選択肢にまとめる
  const seen = new Set<string>();
  for (const rule of derivationRules) {
    if (!rule.enabled) continue;
    if (rule.trigger.changeKind !== "updated") continue;
    if (rule.scope.workflowKeys.length > 0 && !rule.scope.workflowKeys.includes(workflow.key)) continue;

    const key = `${rule.trigger.entityType}.${rule.trigger.field}`;
    if (seen.has(key)) continue;
    seen.add(key);

    targets.push({
      id: key,
      kind: "derivation",
      label: rule.name,
      hint: rule.description,
      entityType: rule.trigger.entityType,
      entityId: `${rule.trigger.entityType}-${run.id}`,
      entityLabel: run.subject.label,
      field: rule.trigger.field,
      fieldLabel: rule.trigger.fieldLabel ?? rule.trigger.field,
      // 派生ルールの期限規則は change.after を基準にするため、日付として扱う
      valueType: "date",
      ruleId: rule.id,
      ruleName: rule.name,
    });
  }

  // 3. どのルールにも該当しない変更（履歴のみ）
  targets.push({
    id: "other",
    kind: "other",
    label: "その他の変更",
    hint: "上記以外の変更。内容を変更履歴として記録します",
    entityType: "other",
    entityId: run.id,
    entityLabel: run.subject.label,
    field: "note",
    fieldLabel: "変更内容",
    valueType: "text",
  });

  return targets;
}

/**
 * 変更イベントの ID。内容から決定的に決める。
 *
 * 派生タスクの ID は `task-{changeId}-{ref}`（derivation/engine.ts）なので、
 * 同じ変更を二度確定しても同じ ID になり、ストアの addTasks が重複を弾く。
 */
export function changeEventId(input: {
  runId: string; entityType: string; field: string; before: unknown; after: unknown;
}): string {
  const seed = [input.runId, input.entityType, input.field, String(input.before), String(input.after)].join("|");
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  }
  return `chg-${input.runId}-${input.field}-${hash.toString(36)}`;
}

export interface ChangeDraft {
  targetId: string;
  /** 変更されたものの名称。未入力なら対象の既定値を使う */
  entityLabel?: string;
  before: string;
  after: string;
  reason: string;
}

/** 下書きから ChangeEvent を組み立てる。保存はしない */
export function buildChangeEvent(input: {
  target: ChangeTarget;
  draft: ChangeDraft;
  run: WorkRun;
  actor: string;
  now: Date;
}): ChangeEvent {
  const { target, draft, run, actor, now } = input;
  const before = draft.before || (target.currentValue ?? "");
  return {
    id: changeEventId({
      runId: run.id, entityType: target.entityType, field: target.field,
      before, after: draft.after,
    }),
    entityType: target.entityType,
    entityId: target.entityId,
    entityLabel: draft.entityLabel?.trim() || target.entityLabel,
    field: target.field,
    fieldLabel: target.fieldLabel,
    before,
    after: draft.after,
    reason: draft.reason || undefined,
    actor,
    occurredAt: now.toISOString(),
    runId: run.id,
  };
}

/** 起票できる状態か。理由は任意、変更後の値は必須 */
export function validateChangeDraft(target: ChangeTarget, draft: ChangeDraft): string[] {
  const errors: string[] = [];
  if (target.kind === "derivation" && !(draft.entityLabel ?? "").trim()) {
    errors.push("変更されたものの名称を入力してください");
  }
  if (!draft.after.trim()) errors.push(`「${target.fieldLabel}」の変更後の値を入力してください`);
  if (target.valueType === "date" && draft.after && Number.isNaN(new Date(draft.after).getTime())) {
    errors.push("変更後の日付が正しくありません");
  }
  const before = draft.before || target.currentValue || "";
  if (draft.after.trim() && before && new Date(before).getTime() === new Date(draft.after).getTime()) {
    errors.push("変更前と変更後が同じです");
  }
  return errors;
}
