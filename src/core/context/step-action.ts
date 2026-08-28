/**
 * 「次にやること」の文言を STEP の状態から導出する（仕様 §6-2 の次アクション帯）。
 *
 * STEP の説明文（guidance）を繰り返すのではなく、
 * 「この画面で何を操作すれば次へ進めるのか」を返す。
 * 純粋関数。UI 側に固定文言を持たせない。
 */
import type { EffectiveStep, StepRun, WorkComponentType } from "../model/types";
import type { StepCompletionCheck } from "../flow/engine";

/** 入力を積み上げる部品。満たせば「進めます」と言ってよい */
const INPUT_COMPONENTS: WorkComponentType[] = [
  "checklist", "input", "select", "company-search", "company-select",
];

/** 内容を見て判断する部品。満たしていても「確認してください」と言う */
const REVIEW_MESSAGE: Partial<Record<WorkComponentType, string>> = {
  "customer-view": "顧客情報を確認して、完了して次へ進んでください",
  "email-compose": "件名と本文を確認してください",
  "document-compose": "本文を確認してください",
  "knowledge-view": "内容を確認して、完了して次へ進んでください",
  "calendar-create": "登録内容を確認してください",
  "ai-assist": "内容を確認して、完了して次へ進んでください",
  "task-create": "作成するタスクを確認して完了してください",
  "complete": "完了ボタンを押すと業務が終了します",
};

function joinLabels(labels: string[]): string {
  return labels.join("・");
}

/** 未完了の項目から、その部品に合った指示を作る */
function instructFor(step: EffectiveStep, missing: { label: string }[]): string {
  const labels = missing.map((m) => m.label);
  const n = labels.length;

  switch (step.componentType) {
    case "checklist":
      return n <= 2
        ? `${joinLabels(labels)}を確認してください`
        : `残り${n}項目を確認すると次へ進めます`;

    case "select":
      return n <= 2
        ? `${joinLabels(labels)}を選択してください`
        : `残り${n}項目を選択すると次へ進めます`;

    case "input":
      return n <= 2
        ? `${joinLabels(labels)}を入力してください`
        : `残り${n}項目を入力すると次へ進めます`;

    case "company-search":
      return "条件を指定して企業を検索してください";

    case "company-select":
      return "候補企業を1社以上選び、選定理由を記入してください";

    case "approval":
      return step.config.selfConfirm
        ? "内容を確認して、確認欄にチェックしてください"
        : "承認欄にチェックが入ると次へ進めます";

    default:
      return n === 0
        ? "内容を確認して、完了して次へ進んでください"
        : `${joinLabels(labels)}を確認してください`;
  }
}

export function describeStepAction(
  step: EffectiveStep,
  stepRun: StepRun,
  completion: StepCompletionCheck,
): string {
  // 完了済みの STEP を開き直しているとき
  if (stepRun.status === "done") {
    return "このSTEPは完了済みです。内容を変えるにはやり直してください";
  }

  if (completion.missing.length > 0) return instructFor(step, completion.missing);

  // 完了条件は満たしている。判断が要る部品は、それでも確認を促す
  const review = REVIEW_MESSAGE[step.componentType];
  if (review) return review;

  if (INPUT_COMPONENTS.includes(step.componentType)) {
    return "準備できました。完了して次へ進めます";
  }
  return instructFor(step, []);
}
