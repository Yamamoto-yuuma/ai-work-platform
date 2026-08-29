/**
 * 一時ルールの解決とオーバーレイ合成。
 * ルールはフロー定義を書き換えず、描画時に重ねる（仕様 §14-4）。
 * 期間終了後は自動的に対象外になるため、無効化バッチは不要（仕様 §14-5）。
 */
import type {
  BusinessRule, StepDefinition, EffectiveStep, RuleConflict, WorkflowDefinition, RuleType,
} from "../model/types";
import { evaluate } from "../flow/condition";

const TYPE_WEIGHT: Record<RuleType, number> = {
  case: 300,        // 1. 個別案件ルール
  temporary: 200,   // 2. 期間限定ルール
  department: 100,  // 3. 部署ルール
  standard: 0,      // 4. 標準業務フロー
};

export function isRuleActive(rule: BusinessRule, now: Date): boolean {
  if (!rule.enabled) return false;
  const from = new Date(rule.activeFrom);
  if (now < from) return false;
  if (rule.activeTo && now > new Date(rule.activeTo)) return false;
  return true;
}

export function ruleWeight(rule: BusinessRule): number {
  return TYPE_WEIGHT[rule.ruleType] + rule.priority;
}

/** 現在のSTEPに適用されるルールだけを抽出する（仕様 §5-1 スコープ規則） */
/**
 * ルールがこのSTEPに適用されるか（仕様 §14）。
 *
 * 指定された絞り込み条件は「すべて」満たす必要がある（AND）。
 * 未指定の次元は制約なしとして扱う。
 *
 * 実際の適用（resolveRulesForStep）と、管理画面の事前表示（影響STEP数）の
 * 双方がこの1関数を使う。判定を二重に持たない。
 */
export function ruleAppliesToStep(
  rule: BusinessRule,
  workflow: Pick<WorkflowDefinition, "key">,
  step: Pick<StepDefinition, "componentType" | "ruleTags">,
): boolean {
  const s = rule.scope;
  const stepTags = step.ruleTags ?? [];
  if (s.workflowKeys.length > 0 && !s.workflowKeys.includes(workflow.key)) return false;
  if (s.stepRuleTags.length > 0 && !s.stepRuleTags.some((t) => stepTags.includes(t))) return false;
  if (s.componentTypes.length > 0 && !s.componentTypes.includes(step.componentType)) return false;
  return true;
}

export function resolveRulesForStep(input: {
  rules: BusinessRule[];
  workflow: WorkflowDefinition;
  step: StepDefinition;
  scope: Record<string, unknown>;
  now: Date;
}): BusinessRule[] {
  const { rules, workflow, step, scope, now } = input;

  return rules
    .filter((r) => isRuleActive(r, now))
    .filter((r) => ruleAppliesToStep(r, workflow, step))
    .filter((r) => evaluate(r.condition, scope))
    .sort((a, b) => ruleWeight(a) - ruleWeight(b)); // 低優先 → 高優先の順に重ねる
}

/** StepDefinition にルールを重ねて EffectiveStep を作る */
export function overlayStep(step: StepDefinition, rules: BusinessRule[]): EffectiveStep {
  const eff: EffectiveStep = {
    ...step,
    extraChecklistItems: [],
    extraFields: [],
    notices: [],
    extraKnowledgeIds: [],
    appliedRules: rules,
  };

  for (const rule of rules) {
    for (const effect of rule.effects) {
      switch (effect.type) {
        case "addChecklistItems":
          for (const item of effect.items) {
            eff.extraChecklistItems.push({ ...item, ruleId: rule.id });
          }
          break;
        case "addFields":
          for (const f of effect.fields) eff.extraFields.push({ ...f, ruleId: rule.id });
          break;
        case "showNotice":
          eff.notices.push({ ...effect, ruleId: rule.id, ruleName: rule.name });
          break;
        case "attachKnowledge":
          eff.extraKnowledgeIds.push(...effect.knowledgeIds);
          break;
        case "requireConfirmation":
          eff.notices.push({ level: "warn", text: effect.text, ruleId: rule.id, ruleName: rule.name });
          break;
        case "blockCompletion":
          eff.notices.push({ level: "warn", text: effect.message, ruleId: rule.id, ruleName: rule.name });
          break;
      }
    }
  }
  return eff;
}

/** 同一ターゲットに複数ルールが作用している場合を競合として検出する（仕様 §14-7） */
export function detectConflicts(rules: BusinessRule[]): RuleConflict[] {
  const byTarget = new Map<string, BusinessRule[]>();

  for (const rule of rules) {
    for (const effect of rule.effects) {
      const targets: string[] =
        effect.type === "addChecklistItems" ? effect.items.map((i) => `checklist:${i.key}`)
        : effect.type === "addFields" ? effect.fields.map((f) => `field:${f.key}`)
        : [];
      for (const t of targets) {
        byTarget.set(t, [...(byTarget.get(t) ?? []), rule]);
      }
    }
  }

  const conflicts: RuleConflict[] = [];
  for (const [target, rs] of byTarget) {
    if (rs.length < 2) continue;
    const sorted = [...rs].sort((a, b) => ruleWeight(b) - ruleWeight(a));
    const [winner, loser] = sorted;
    conflicts.push({
      severity: winner.ruleType !== loser.ruleType ? "high" : "low",
      target,
      winnerRuleId: winner.id,
      loserRuleId: loser.id,
      message: `「${winner.name}」が「${loser.name}」の設定（${target}）を上書きしています`,
    });
  }
  return conflicts;
}
