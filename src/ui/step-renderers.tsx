"use client";

/**
 * 業務部品のレンダラ。
 * componentType → UI の対応表であり、業務そのものは一切含まない。
 * 新しい部品を足すときは RENDERERS に1エントリ追加する。
 */
import { useStore } from "@/adapters/memory/store";
import type { EffectiveStep, StepRun, WorkRun } from "@/core/model/types";
import { Badge, Button, NotConnected } from "./primitives";
import { getComponentSpec } from "@/components-registry/registry";
import { readTemplates, isTemplateSelected, resolveTemplateDue } from "@/core/task/from-step";
import { TASK_PRIORITIES } from "@/core/model/task-draft";
import { resolveEmailDraft } from "@/core/message/email-draft";
import { getStep, orderedSteps } from "@/core/flow/engine";

export interface StepRendererProps {
  step: EffectiveStep;
  stepRun: StepRun;
  run: WorkRun;
  onOutput: (patch: Record<string, unknown>) => void;
  onCheck: (patch: Record<string, boolean>) => void;
}

type FieldCfg = { key: string; label: string; required?: boolean; type?: string; options?: { value: unknown; label: string }[] };
type ItemCfg = { key: string; label: string; required?: boolean };

// --- チェックリスト（一時ルールが項目を追加する主戦場）------------------------
function ChecklistRenderer({ step, stepRun, onCheck }: StepRendererProps) {
  const base = (step.config.items ?? []) as ItemCfg[];

  const Row = ({ item, ruleId }: { item: ItemCfg; ruleId?: string }) => {
    const checked = Boolean(stepRun.checklistState[item.key]);
    return (
      <label
        className={`flex cursor-pointer items-start gap-3 rounded-lg px-3.5 py-3 transition-[background-color,border-color,box-shadow] duration-150 ${
          checked
            ? "bg-ok-soft shadow-inset"
            : ruleId ? "bg-signal-soft" : "pick"
        }`}
      >
        <input
          type="checkbox" checked={checked}
          onChange={(e) => onCheck({ [item.key]: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[#1d5a78]"
        />
        <span className="flex-1 text-[13px] leading-relaxed">
          {item.label}
          {item.required !== false && <span className="ml-1.5 text-[11px] text-danger">必須</span>}
          {ruleId && <span className="ml-2 text-[11px] text-signal">一時ルールにより追加</span>}
        </span>
      </label>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {base.map((item) => <Row key={item.key} item={item} />)}
    </div>
  );
}

// --- 入力・選択 --------------------------------------------------------------
function FieldsRenderer({ step, stepRun, run, onOutput }: StepRendererProps) {
  const fields = (step.config.fields ?? []) as FieldCfg[];

  return (
    <div className="flex flex-col gap-4">
      {fields.map((f) => {
        // 既に業務情報として記録されている値（マスタからの導出を含む）
        const recorded = run.context[f.key];
        const value = stepRun.output[f.key] ?? recorded;
        const differs =
          recorded !== undefined && value !== undefined && value !== recorded;
        const recordedLabel = f.options?.find((o) => o.value === recorded)?.label;
        return (
          <div key={f.key}>
            <label className="mb-1.5 block text-[13px] font-medium">
              {f.label}
              {f.required !== false && <span className="ml-1.5 text-[11px] text-danger">必須</span>}
              {recordedLabel && !differs && (
                <span className="ml-2 text-[11px] font-normal text-ink-3">
                  登録内容から初期選択：{recordedLabel}
                </span>
              )}
            </label>
            {f.options ? (
              <div className="flex flex-wrap gap-2">
                {f.options.map((o) => (
                  <button
                    key={String(o.value)} type="button"
                    onClick={() => onOutput({ [f.key]: o.value })}
                    className={`rounded-lg border px-3.5 py-2 text-[13px] transition-colors ${
                      value === o.value ? "border-brand bg-brand text-white" : "pick"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                value={value === undefined || value === null ? "" : String(value).slice(0, f.type === "date" ? 10 : undefined)}
                onChange={(e) => onOutput({ [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })}
                className="field max-w-md"
                placeholder={`${f.label}を入力`}
              />
            )}
            {differs && (
              <p className="mt-1.5 rounded-lg bg-signal-soft px-3 py-2 text-[12px] text-signal">
                登録内容（{recordedLabel ?? String(recorded)}）と異なる選択です。
                この業務ではこちらの内容で進みます。
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- 顧客情報表示 ------------------------------------------------------------
function CustomerViewRenderer({ run }: StepRendererProps) {
  const { customers } = useStore();
  const customer = customers.find((c) => c.id === run.context.customerId);
  if (!customer) {
    return <p className="text-[13px] text-ink-3">対象の顧客情報が見つかりません。上部の対象名から再指定してください。</p>;
  }
  const rows = [
    ["会社名", customer.name],
    ["担当者", customer.contactName],
    ["業界", customer.industry],
    ["従業員数", `${customer.employeeCount}名`],
    ["区分", customer.isExisting ? "既存顧客" : "新規顧客"],
    ["最終接触", customer.lastContactAt ? new Date(customer.lastContactAt).toLocaleDateString("ja-JP") : "—"],
  ] as const;

  return (
    <div>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-line-soft pb-2">
            <dt className="text-[12px] text-ink-3">{k}</dt>
            <dd className="text-[13px] font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {customer.note && (
        <p className="mt-4 rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">{customer.note}</p>
      )}
    </div>
  );
}

// --- 企業検索 / 選定 ---------------------------------------------------------
function CompanySearchRenderer({ step, stepRun, onOutput }: StepRendererProps) {
  const { companies } = useStore();
  const selected = (stepRun.output.selected ?? []) as string[];
  const excluded = (stepRun.output.excluded ?? []) as string[];
  const isSelect = step.componentType === "company-select";

  const toggle = (id: string, list: "selected" | "excluded") => {
    const cur = (stepRun.output[list] ?? []) as string[];
    const other = list === "selected" ? "excluded" : "selected";
    const otherCur = (stepRun.output[other] ?? []) as string[];
    onOutput({
      [list]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
      [other]: otherCur.filter((x) => x !== id),
    });
  };

  return (
    <div>
      <NotConnected label="企業検索API" phase="Phase 7" />
      <p className="mt-3 mb-3 text-[12px] text-ink-3">
        シードデータ {companies.length} 社を表示しています。
        {isSelect && " 最終的な選定は人が行います（AIは候補整理のみを補助します）。"}
      </p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="bg-surface-2 text-[12px] text-ink-2">
            <tr>
              <th className="px-3 py-2 text-left font-medium">企業名</th>
              <th className="px-3 py-2 text-left font-medium">業界</th>
              <th className="px-3 py-2 text-right font-medium">従業員</th>
              <th className="px-3 py-2 text-left font-medium">地域</th>
              <th className="px-3 py-2 text-left font-medium">AI導入</th>
              {isSelect && <th className="px-3 py-2 text-left font-medium">操作</th>}
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => {
              const sel = selected.includes(c.id);
              const exc = excluded.includes(c.id);
              return (
                <tr key={c.id} className={`border-t border-line-soft ${sel ? "bg-ok-soft" : exc ? "opacity-45" : ""}`}>
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-ink-2">{c.industry}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{c.employeeCount}</td>
                  <td className="px-3 py-2 text-ink-2">{c.region}</td>
                  <td className="px-3 py-2">
                    <Badge tone={c.aiAdoption === "none" ? "neutral" : c.aiAdoption === "advanced" ? "ok" : "brand"}>
                      {{ none: "未導入", considering: "検討中", partial: "一部導入", advanced: "積極活用" }[c.aiAdoption]}
                    </Badge>
                  </td>
                  {isSelect && (
                    <td className="px-3 py-2">
                      <div className="flex gap-1.5">
                        <Button size="sm" variant={sel ? "primary" : "secondary"} onClick={() => toggle(c.id, "selected")}>選択</Button>
                        <Button size="sm" variant="ghost" onClick={() => toggle(c.id, "excluded")}>除外</Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isSelect && (
        <div className="mt-4">
          <label className="mb-1.5 block text-[13px] font-medium">
            選定理由<span className="ml-1.5 text-[11px] text-danger">必須</span>
          </label>
          <textarea
            value={String(stepRun.output.reason ?? "")}
            onChange={(e) => onOutput({ reason: e.target.value })}
            rows={3}
            placeholder="なぜこの企業を選定したかを記録してください（後から判断の根拠を追跡するため）"
            className="field"
          />
          <p className="mt-2 text-[12px] text-ink-3">選択 {selected.length} 社 ／ 除外 {excluded.length} 社</p>
        </div>
      )}
    </div>
  );
}

// --- メール作成 --------------------------------------------------------------
function EmailComposeRenderer({ step, stepRun, run, onOutput }: StepRendererProps) {
  const { emailTemplates, customers, workflows } = useStore();
  const workflow =
    workflows.find((w) => w.key === run.workflowKey && w.version === run.workflowVersion) ??
    workflows.find((w) => w.key === run.workflowKey);
  const draft = resolveEmailDraft({ step, stepRun, run, templates: emailTemplates, customers, workflow });
  if (!draft) return <p className="text-[13px] text-ink-3">利用できるテンプレートがありません。</p>;

  const { subject, body, missingVariables: missing } = draft;

  return (
    <div className="flex flex-col gap-4">
      <NotConnected label="Gmail" phase="Phase 7" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-ink-3">テンプレート</span>
        <Badge tone="brand">{draft.templateName}</Badge>
        <span className="text-[12px] text-ink-3">宛先</span>
        <Badge>{draft.recipient}</Badge>
      </div>

      {missing.length > 0 && (
        <div className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
          <strong className="font-bold">差し込み値が不足しています。</strong>
          <span className="ml-1">{missing.join(" / ")} が未設定のため、本文に〔未設定〕と表示されています。</span>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-[13px] font-medium">件名</label>
        <input
          value={subject} onChange={(e) => onOutput({ subject: e.target.value })}
          className="field"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[13px] font-medium">本文</label>
        <textarea
          value={body} onChange={(e) => onOutput({ body: e.target.value })}
          rows={12}
          className="field font-mono text-[12.5px] leading-relaxed"
        />
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-ai/40 bg-ai-soft px-3.5 py-2.5">
        <span className="text-ai">✦</span>
        <span className="text-[12.5px] text-ink-2">AIによる推敲は Phase 8 で接続します。現在はテンプレートをそのまま編集できます。</span>
      </div>
    </div>
  );
}

// --- 文章作成 ----------------------------------------------------------------
function DocumentComposeRenderer({ step, stepRun, run, onOutput }: StepRendererProps) {
  const { emailTemplates } = useStore();
  const template = emailTemplates.find((t) => t.id === String(step.config.templateId ?? ""));
  const body = String(stepRun.output.body ?? template?.body.replace("{{theme}}", String(run.context.theme ?? "")) ?? "");
  return (
    <div className="flex flex-col gap-4">
      {template && (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink-3">テンプレート</span>
          <Badge tone="brand">{template.name}</Badge>
        </div>
      )}
      <textarea
        value={body} onChange={(e) => onOutput({ body: e.target.value })}
        rows={16}
        className="field font-mono text-[12.5px] leading-relaxed"
      />
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-ai/40 bg-ai-soft px-3.5 py-2.5">
        <span className="text-ai">✦</span>
        <span className="text-[12.5px] text-ink-2">AIによる生成・要約は Phase 8 で接続します。</span>
      </div>
    </div>
  );
}

// --- タスク作成 --------------------------------------------------------------
function TaskCreateRenderer({ step, stepRun, run, onCheck }: StepRendererProps) {
  const { users } = useStore();
  const templates = readTemplates(step);
  const assignee = users.find((u) => u.id === run.assigneeId);
  const now = new Date();

  if (templates.length === 0) {
    return <p className="text-[13px] text-ink-3">このSTEPで作成するタスクは定義されていません。</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="mb-1 text-[13px] text-ink-2">
        このSTEPを完了すると、以下のタスクが作成されます。不要なものはチェックを外してください。
      </p>
      {templates.map((t, i) => {
        const key = `task-${i}`;
        const checked = isTemplateSelected(stepRun, i);
        const due = resolveTemplateDue(t, now);
        return (
          <label
            key={key}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors ${
              checked ? "pick" : "border-line bg-surface-2 opacity-60"
            }`}
          >
            <input
              type="checkbox" checked={checked}
              onChange={(e) => onCheck({ [key]: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-[#1d5a78]"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{t.title}</span>
              {t.description && <span className="mt-0.5 block text-[11.5px] text-ink-3">{t.description}</span>}
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                <span>担当 {assignee?.name ?? run.assigneeId}</span>
                <span>優先度 {TASK_PRIORITIES.find((p) => p.value === (t.priority ?? "normal"))?.label}</span>
                {due && (
                  <span>
                    期限 {new Date(due).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" })}
                  </span>
                )}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

// --- Calendar 登録 -----------------------------------------------------------
function CalendarRenderer({ step, run }: StepRendererProps) {
  const dateVar = String(step.config.dateVar ?? "");
  const date = run.context[dateVar];
  return (
    <div className="flex flex-col gap-3">
      <NotConnected label="Google Calendar" phase="Phase 7" />
      <div className="rounded-lg border border-line bg-surface-2 p-4">
        <p className="mb-2 text-[12px] text-ink-3">登録される予定の内容（プレビュー）</p>
        <dl className="flex flex-col gap-1.5 text-[13px]">
          <div className="flex gap-3"><dt className="w-16 text-ink-3">タイトル</dt><dd className="font-medium">{String(step.config.titleTemplate ?? "").replace("{{customer.name}}", run.subject.label)}</dd></div>
          <div className="flex gap-3"><dt className="w-16 text-ink-3">日時</dt><dd className="font-medium">{date ? new Date(String(date)).toLocaleDateString("ja-JP") : "未設定（前STEPで指定）"}</dd></div>
        </dl>
      </div>
      <p className="text-[12.5px] text-ink-3">Phase 1 では実際のカレンダーには登録されません。連携失敗時も業務は継続できる設計です。</p>
    </div>
  );
}

// --- 承認 / 送信確認 ---------------------------------------------------------
/**
 * 確認STEP（approval）で「何を確認するのか」を表示する。
 *
 * どのSTEPの成果物を確認するかは step.config.reviewStepKey で指定する。
 * 未指定の場合は、直前までに完了した email-compose STEP を後ろから探す。
 * ここでは表示のみを行い、メールの実送信は行わない。
 */
function ReviewTarget({ step, run }: { step: EffectiveStep; run: WorkRun }) {
  const { state, workflows, emailTemplates, customers } = useStore();

  const def =
    workflows.find((w) => w.key === run.workflowKey && w.version === run.workflowVersion) ??
    workflows.find((w) => w.key === run.workflowKey);
  if (!def) return null;

  const stepRuns = state.stepRunsByRun[run.id] ?? [];
  const explicitKey = step.config.reviewStepKey ? String(step.config.reviewStepKey) : null;

  const target = explicitKey
    ? getStep(def, explicitKey)
    : [...orderedSteps(def)]
        .reverse()
        .find(
          (s) =>
            s.componentType === "email-compose" &&
            stepRuns.find((sr) => sr.stepKey === s.key)?.status === "done",
        );

  if (!target) {
    return (
      <div className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-ink-2">
        確認対象の成果物が見つかりませんでした。前のSTEPの内容を確認してください。
      </div>
    );
  }

  const targetRun = stepRuns.find((sr) => sr.stepKey === target.key);
  if (target.componentType !== "email-compose" || !targetRun) return null;

  const draft = resolveEmailDraft({
    step: target, stepRun: targetRun, run, templates: emailTemplates, customers, workflow: def,
  });
  if (!draft) return null;

  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-3.5 py-2.5">
        <span className="text-[12px] font-bold text-ink-2">確認する内容</span>
        <Badge tone="brand">{target.title}</Badge>
        <Badge>{draft.edited ? "編集済み" : "テンプレートのまま"}</Badge>
      </header>

      {draft.missingVariables.length > 0 && (
        <div className="border-b border-line bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
          <strong className="font-bold">差し込み値が不足しています。</strong>
          <span className="ml-1">{draft.missingVariables.join(" / ")} が未設定のまま本文に残っています。</span>
        </div>
      )}

      <dl className="flex flex-col gap-2.5 px-3.5 py-3 text-[13px]">
        <div className="flex gap-3">
          <dt className="w-14 shrink-0 text-[12px] text-ink-3">宛先</dt>
          <dd className="min-w-0 flex-1 font-medium">{draft.recipient}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-14 shrink-0 text-[12px] text-ink-3">件名</dt>
          <dd className="min-w-0 flex-1 font-medium">{draft.subject}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-14 shrink-0 text-[12px] text-ink-3">本文</dt>
          <dd className="min-w-0 flex-1">
            <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2.5 font-mono text-[12px] leading-relaxed">
              {draft.body}
            </pre>
          </dd>
        </div>
      </dl>

      <p className="border-t border-line px-3.5 py-2 text-[11.5px] text-ink-3">
        内容を直す場合は、左のSTEPレールから「{target.title}」を開いてやり直してください。
      </p>
    </section>
  );
}

function ApprovalRenderer({ step, stepRun, run, onCheck }: StepRendererProps) {
  const selfConfirm = Boolean(step.config.selfConfirm);
  const label = String(step.config.confirmLabel ?? "承認する");
  const checked = Boolean(stepRun.checklistState.approved);
  return (
    <div className="flex flex-col gap-3">
      {!selfConfirm && (
        <div className="rounded-lg bg-signal-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-signal">
          このSTEPは、確認を依頼した相手の返事を待つ内容です。
          （確認先の目安：{String(step.config.approverRole ?? "manager")}）
          <br />
          返事が来るまで進められない場合は、右の「待ちにする」で確認日を決めて一旦止められます。
        </div>
      )}
      <ReviewTarget step={step} run={run} />
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3.5 hover:bg-surface-2">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck({ approved: e.target.checked })} className="h-4 w-4 accent-[#1d5a78]" />
        <span className="text-[13px] font-medium">{label}</span>
      </label>
    </div>
  );
}

// --- その他 ------------------------------------------------------------------
function KnowledgeViewRenderer({ step }: StepRendererProps) {
  const { knowledge } = useStore();
  const items = knowledge.filter((k) => (step.knowledgeRefs ?? []).includes(k.id));
  return (
    <div className="flex flex-col gap-3">
      {items.map((k) => (
        <div key={k.id} className="rounded-lg border border-line-soft bg-surface p-4 shadow-card">
          <h4 className="mb-1.5 text-[13px] font-bold">{k.title}</h4>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{k.body}</p>
        </div>
      ))}
    </div>
  );
}

function AiAssistRenderer() {
  return (
    <div className="rounded-lg border border-dashed border-ai/40 bg-ai-soft p-5 text-center">
      <p className="text-[13px] font-medium text-ai">AI処理は Phase 8 で接続します</p>
      <p className="mt-1.5 text-[12.5px] text-ink-2">AIが未接続でも、このSTEPは手動で完了できます。</p>
    </div>
  );
}

function CompleteRenderer({ run }: StepRendererProps) {
  return (
    <div className="rounded-lg bg-ok-soft p-6 text-center">
      <p className="text-[15px] font-bold text-ok">この業務を完了します</p>
      <p className="mt-2 text-[13px] text-ink-2">{run.subject.label} の対応内容が記録されます。</p>
    </div>
  );
}

function BranchRenderer({ run }: StepRendererProps) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-5 text-center text-[13px] text-ink-2">
      条件を評価して次のSTEPを決定します。{run.title}
    </div>
  );
}

// --- ディスパッチ表 ----------------------------------------------------------
const RENDERERS: Record<string, (p: StepRendererProps) => React.ReactNode> = {
  "checklist": ChecklistRenderer,
  "input": FieldsRenderer,
  "select": FieldsRenderer,
  "customer-view": CustomerViewRenderer,
  "company-search": CompanySearchRenderer,
  "company-select": CompanySearchRenderer,
  "email-compose": EmailComposeRenderer,
  "document-compose": DocumentComposeRenderer,
  "task-create": TaskCreateRenderer,
  "calendar-create": CalendarRenderer,
  "approval": ApprovalRenderer,
  "knowledge-view": KnowledgeViewRenderer,
  "ai-assist": AiAssistRenderer,
  "complete": CompleteRenderer,
  "branch": BranchRenderer,
};

/**
 * 一時ルールが追加した項目。
 * 部品の種別に関係なく必ず描画する。個々のレンダラ任せにすると、
 * 項目を表示しない部品にルールが刺さった場合に STEP が完了不能になる。
 */
function RuleAdditions({ step, stepRun, onOutput, onCheck }: StepRendererProps) {
  const { extraChecklistItems: items, extraFields: fields } = step;
  if (items.length === 0 && fields.length === 0) return null;

  return (
    <section className="mt-5 rounded-lg bg-signal-soft p-4">
      <h4 className="mb-3 flex items-center gap-1.5 text-[12px] font-bold text-signal">
        <span>⚑</span>一時ルールにより追加された確認項目
      </h4>
      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const checked = Boolean(stepRun.checklistState[item.key]);
          return (
            <label
              key={item.key}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
                checked ? "bg-ok-soft" : "border-signal/30 bg-surface hover:bg-surface-2"
              }`}
            >
              <input
                type="checkbox" checked={checked}
                onChange={(e) => onCheck({ [item.key]: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-[#1d5a78]"
              />
              <span className="flex-1 text-[13px] leading-relaxed">
                {item.label}
                {item.required && <span className="ml-1.5 text-[11px] text-danger">必須</span>}
              </span>
            </label>
          );
        })}
        {fields.map((f) => (
          <div key={f.key} className="rounded-lg border border-signal/30 bg-surface px-3.5 py-2.5">
            <label className="mb-1.5 block text-[13px] font-medium">
              {f.label}
              {f.required && <span className="ml-1.5 text-[11px] text-danger">必須</span>}
            </label>
            <input
              value={String(stepRun.output[f.key] ?? "")}
              onChange={(e) => onOutput({ [f.key]: e.target.value })}
              className="field max-w-md"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function StepRenderer(props: StepRendererProps) {
  const Renderer = RENDERERS[props.step.componentType];
  return (
    <>
      {Renderer
        ? Renderer(props)
        : (
          <p className="text-[13px] text-ink-3">
            部品「{getComponentSpec(props.step.componentType)?.label ?? props.step.componentType}」の表示は未実装です。
          </p>
        )}
      <RuleAdditions {...props} />
    </>
  );
}
