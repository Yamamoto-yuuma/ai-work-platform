/**
 * メール下書きの解決（純粋関数）。
 *
 * 作成STEP（email-compose）と送信前の確認STEP（approval）の双方から使う。
 * 「作成STEPが何を作ったか」を1か所で決めることで、確認STEP側が
 * 別の文面を表示してしまう事故を防ぐ。実際の送信は行わない。
 */
import type { Customer, EmailTemplate, StepDefinition, StepRun, WorkRun } from "../model/types";

export interface EmailDraft {
  /** 表示用の宛先。外部送信はしないため、あくまで確認用の文字列 */
  recipient: string;
  subject: string;
  body: string;
  templateName: string;
  /** テンプレートの差し込み変数のうち、値が取れなかったもの */
  missingVariables: string[];
  /** ユーザーが編集した内容か（false ならテンプレートの初期値） */
  edited: boolean;
}

export interface EmailDraftInput {
  /** config だけを見る。EffectiveStep / StepDefinition の双方を受け取れる */
  step: Pick<StepDefinition, "config">;
  stepRun: StepRun;
  run: WorkRun;
  templates: EmailTemplate[];
  customers: Customer[];
}

/** 差し込み値。業務データから引くだけで、業務ごとの分岐は持たない */
function fillValues(run: WorkRun, customer: Customer | undefined): Record<string, string> {
  return {
    "customer.contactName": customer?.contactName ?? "",
    "customer.name": customer?.name ?? "",
    "company.name": customer?.name ?? "",
    "company.industry": customer?.industry ?? "",
    "service": String(run.context.service ?? ""),
    "theme": String(run.context.theme ?? ""),
  };
}

export function resolveEmailDraft({
  step, stepRun, run, templates, customers,
}: EmailDraftInput): EmailDraft | null {
  const templateId = String(step.config.templateId ?? "");
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  if (!template) return null;

  const customer = customers.find((c) => c.id === run.context.customerId);
  const values = fillValues(run, customer);
  const fill = (text: string) =>
    text.replace(/\{\{([\w.]+)\}\}/g, (_, k: string) => values[k] || `〔${k} 未設定〕`);

  const subjectOut = stepRun.output.subject;
  const bodyOut = stepRun.output.body;

  return {
    recipient: customer
      ? `${customer.contactName}様（${customer.name}）`
      : "宛先未設定",
    subject: subjectOut === undefined ? fill(template.subject) : String(subjectOut),
    body: bodyOut === undefined ? fill(template.body) : String(bodyOut),
    templateName: template.name,
    missingVariables: template.variables.filter((v) => !values[v]),
    edited: subjectOut !== undefined || bodyOut !== undefined,
  };
}
