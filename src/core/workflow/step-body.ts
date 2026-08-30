/**
 * STEP に「操作するもの」があるかの判定（Phase 12 / P2-2）。
 *
 * P0-2 以降、業務は名前と STEP 名だけで登録できる。中身が未設定なのは
 * エラーではなく通常の状態なので、判定はここ 1 か所に置き、
 * 登録画面（下書き）と実行画面（定義）で同じ規則を使う。
 */
import type { EffectiveStep, WorkComponentType } from "../model/types";

/** 中身が配列ひとつで決まる部品と、その中身の置き場所 */
export type BodySlot = "items" | "fields" | "templates" | "knowledgeRefs";

/**
 * 中身が未設定になり得る部品。
 * ここに無い部品は、設定が空でも必ず何かを描く（説明文・対象の表示など）。
 */
export const BODY_SLOT: Partial<Record<WorkComponentType, BodySlot>> = {
  "checklist": "items",
  "input": "fields",
  "select": "fields",
  "task-create": "templates",
  "knowledge-view": "knowledgeRefs",
};

/**
 * 実行時のこの STEP に、描くものがあるか。
 * 一時ルールが項目を足していれば、元の設定が空でも中身はある。
 */
export function hasStepBody(step: EffectiveStep): boolean {
  if (step.extraChecklistItems.length > 0 || step.extraFields.length > 0) return true;
  const slot = BODY_SLOT[step.componentType];
  if (!slot) return true;
  const list = slot === "knowledgeRefs" ? step.knowledgeRefs : step.config[slot];
  return Array.isArray(list) && list.length > 0;
}
