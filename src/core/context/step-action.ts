/**
 * 「次にやること」の文言を STEP の状態から導出する（仕様 §6-2 の次アクション帯）。
 *
 * STEP の説明文（guidance）を繰り返すのではなく、
 * 「この画面で何を操作すれば次へ進めるのか」を返す。
 * 純粋関数。UI 側に固定文言を持たせない。
 */
import type { EffectiveStep, StepRun, WorkComponentType } from "../model/types";
import type { MissingItem, StepCompletionCheck } from "../flow/engine";

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

/**
 * 項目名の末尾がサ変名詞（「〜を確認」など）かどうか。
 *
 * 「過去の提案内容を確認」に「を確認してください」を足すと
 * 「〜を確認を確認してください」になる。末尾を見て助詞を切り替える。
 */
const SURU_ENDINGS = [
  "確認", "チェック", "連携", "共有", "入力", "選択", "記入", "作成",
  "送付", "送信", "登録", "依頼", "更新", "設定", "手配", "準備", "実施",
];

function endsWithSuruNoun(label: string): boolean {
  return SURU_ENDINGS.some((e) => label.endsWith(e));
}

/**
 * 項目名の並びに動作をつなぐ。
 * 全部がサ変名詞なら「〜してください」、全部が名詞なら「〜を{動作}してください」、
 * 混在しているときはどちらにも寄せず「〜が未完了です」と言う。
 */
function phrase(labels: string[], verb: string): string {
  const joined = joinLabels(labels);
  const suru = labels.filter(endsWithSuruNoun).length;
  if (suru === labels.length) return `${joined}してください`;
  if (suru === 0) return `${joined}を${verb}してください`;
  return `${joined}が未完了です`;
}

/** 未完了の項目から、その部品に合った指示を作る */
function instructFor(step: EffectiveStep, missing: { label: string }[]): string {
  const labels = missing.map((m) => m.label);
  const n = labels.length;

  switch (step.componentType) {
    case "checklist":
      return n <= 2
        ? phrase(labels, "確認")
        : `残り${n}項目を確認すると次へ進めます`;

    case "select":
      return n <= 2
        ? phrase(labels, "選択")
        : `残り${n}項目を選択すると次へ進めます`;

    case "input":
      return n <= 2
        ? phrase(labels, "入力")
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
        : phrase(labels, "確認");
  }
}

/**
 * 次にやることの本文と、一時ルールによる追加確認の件数。
 *
 * 一時ルールが追加した項目は補足であって、STEP本来の目的ではない。
 * ルール項目が本文を乗っ取らないよう、優先順位を分けて返す（仕様 §14-4）。
 */
export interface StepActionMessage {
  /** 次にやること本文 */
  text: string;
  /** まだ済んでいない一時ルールの確認項目 */
  ruleItems: MissingItem[];
}

export function describeStepActionDetail(
  step: EffectiveStep,
  stepRun: StepRun,
  completion: StepCompletionCheck,
): StepActionMessage {
  const ruleItems = completion.missing.filter((m) => m.source === "rule");
  const stepItems = completion.missing.filter((m) => m.source !== "rule");

  // 完了済みの STEP を開き直しているとき
  if (stepRun.status === "done") {
    return { text: "このSTEPは完了済みです。内容を変えるにはやり直してください", ruleItems: [] };
  }

  // 1. STEP本来の未完了作業が最優先
  if (stepItems.length > 0) return { text: instructFor(step, stepItems), ruleItems };

  // 2. 本来の作業は終わっている。判断が要る部品は、それでも確認を促す
  const review = REVIEW_MESSAGE[step.componentType];
  if (review) return { text: review, ruleItems };

  if (INPUT_COMPONENTS.includes(step.componentType)) {
    // 3. 残っているのが一時ルールの項目だけなら、それを指す
    if (ruleItems.length > 0) return { text: instructFor(step, ruleItems), ruleItems };
    return { text: "準備できました。完了して次へ進めます", ruleItems };
  }
  return { text: instructFor(step, ruleItems), ruleItems };
}

export function describeStepAction(
  step: EffectiveStep,
  stepRun: StepRun,
  completion: StepCompletionCheck,
): string {
  return describeStepActionDetail(step, stepRun, completion).text;
}
