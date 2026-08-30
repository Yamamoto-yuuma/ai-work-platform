"use client";

/**
 * 業務登録・編集ウィザード（仕様 §28-6）。
 *
 * 一度に全部を聞かない。5つの段階に分け、それぞれで決めることを1つに絞る。
 * ここは入力を集めるだけで、検証と定義への変換は core/workflow/draft.ts が行う。
 * 業務そのものの内容はこのファイルに一切書かない。
 */
import { useMemo, useState } from "react";
import { useStore } from "@/adapters/memory/store";
import { Badge, Button, Card } from "./primitives";
import { getComponentSpec } from "@/components-registry/registry";
import { TASK_PRIORITIES } from "@/core/model/task-draft";
import { describeStartTrigger } from "@/core/workflow/start-trigger";
import {
  DESCRIPTION_MAX, NAME_MAX, REGISTERABLE_COMPONENTS, WORK_KINDS,
  emptyStepDraft, nextFieldKey, nextStepKey, validateWorkflowDraft,
  type DraftError, type FlowDraft, type StepDraft, type WorkflowDraft,
} from "@/core/workflow/draft";
import type { StartTriggerKind, TaskPriority, WorkflowNotes } from "@/core/model/types";

const INPUT =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none transition-colors focus:border-brand";
const SMALL_INPUT =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-brand";

const STAGES = [
  { n: 1, label: "基本情報", hint: "どんな業務か" },
  { n: 2, label: "STEPを並べる", hint: "何を順にやるか" },
  { n: 3, label: "STEPの中身", hint: "各STEPで何を扱うか" },
  { n: 4, label: "進み方と条件", hint: "分岐・期限・開始条件" },
  { n: 5, label: "確認", hint: "登録する" },
] as const;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const TRIGGER_CHOICES: { kind: StartTriggerKind; label: string; hint: string }[] = [
  { kind: "manual", label: "自分で開始する", hint: "業務一覧から手で始めます" },
  { kind: "date", label: "日付が来たら", hint: "指定した日に「今日開始する業務」に出ます" },
  { kind: "weekday", label: "曜日が来たら", hint: "毎週その曜日に出ます" },
  { kind: "time", label: "時間が来たら", hint: "毎日、指定時刻以降に出ます" },
  { kind: "event", label: "出来事が起きたら", hint: "きっかけを記録します。開始は自分で判断します" },
  { kind: "after-workflow", label: "他の業務が終わったら", hint: "先行業務の完了後に出ます" },
  { kind: "task", label: "タスクが発生したら", hint: "きっかけを記録します。開始は自分で判断します" },
  { kind: "condition", label: "条件が成立したら", hint: "条件を書き残します。開始は自分で判断します" },
];

function Field({
  label, required, hint, children,
}: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-baseline gap-1.5 text-[13px] font-medium">
        {label}
        {required && <span className="text-[11px] text-danger">必須</span>}
        {hint && <span className="ml-auto text-[11px] font-normal text-ink-3">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function ErrorList({ errors }: { errors: DraftError[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2.5">
      <p className="text-[12.5px] font-bold text-danger">入力を確認してください</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {errors.map((e, i) => (
          <li key={i} className="text-[12.5px] text-danger">・{e.message}</li>
        ))}
      </ul>
    </div>
  );
}

export interface WorkflowWizardProps {
  initial: WorkflowDraft;
  mode: "create" | "edit";
  /** 編集時、この業務を開始した実行がいくつあるか。影響を伝えるために表示する */
  runCount?: number;
  onSave: (draft: WorkflowDraft) => void;
  onCancel: () => void;
}

export function WorkflowWizard({ initial, mode, runCount = 0, onSave, onCancel }: WorkflowWizardProps) {
  const { knowledge, workflows } = useStore();
  const [draft, setDraft] = useState<WorkflowDraft>(initial);
  const [stage, setStage] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [detailKey, setDetailKey] = useState<string | null>(initial.steps[0]?.key ?? null);
  const [showErrors, setShowErrors] = useState(false);
  const [openNotes, setOpenNotes] = useState(false);

  const allErrors = useMemo(() => validateWorkflowDraft(draft), [draft]);
  const stageErrors = allErrors.filter((e) => e.stage === stage);
  const visibleErrors = showErrors ? stageErrors : [];

  const otherWorkflows = workflows
    .filter((w) => w.key !== draft.key && w.status === "published")
    .filter((w, i, arr) => arr.findIndex((x) => x.key === w.key) === i);

  function patch(next: Partial<WorkflowDraft>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  function patchStep(key: string, next: Partial<StepDraft>) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => (s.key === key ? { ...s, ...next } : s)),
    }));
  }

  function setFlow(key: string, f: FlowDraft) {
    setDraft((d) => ({ ...d, flow: { ...d.flow, [key]: f } }));
  }

  function addStep() {
    setDraft((d) => {
      const s = { ...emptyStepDraft(d.steps.length + 1), key: nextStepKey(d.steps) };
      return { ...d, steps: [...d.steps, s], flow: { ...d.flow, [s.key]: { kind: "next" } } };
    });
  }

  function removeStep(key: string) {
    setDraft((d) => {
      const flow = { ...d.flow };
      delete flow[key];
      // 消したSTEPを指していた進み方は一本道に戻す
      for (const [k, f] of Object.entries(flow)) {
        if (f.kind === "branch" && (f.paths.some((p) => p.toStepKey === key) || f.elseToStepKey === key)) {
          flow[k] = { kind: "next" };
        }
        if (f.kind === "parallel" && (f.toStepKeys.includes(key) || f.joinStepKey === key)) {
          flow[k] = { kind: "next" };
        }
      }
      return { ...d, steps: d.steps.filter((s) => s.key !== key), flow };
    });
    if (detailKey === key) setDetailKey(null);
  }

  function moveStep(index: number, delta: number) {
    setDraft((d) => {
      const next = [...d.steps];
      const target = index + delta;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...d, steps: next };
    });
  }

  function go(next: 1 | 2 | 3 | 4 | 5) {
    // 前に進むときだけ、その段階の入力を確認する
    if (next > stage) {
      const blocking = allErrors.filter((e) => e.stage <= stage);
      if (blocking.length > 0) {
        setShowErrors(true);
        return;
      }
    }
    setShowErrors(false);
    if (next === 3 && !detailKey) setDetailKey(draft.steps[0]?.key ?? null);
    setStage(next);
  }

  function save() {
    if (allErrors.length > 0) {
      setShowErrors(true);
      setStage(allErrors[0].stage);
      return;
    }
    onSave(draft);
  }

  const detail = draft.steps.find((s) => s.key === detailKey) ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* 進行状況 */}
      <ol className="flex flex-wrap gap-1.5">
        {STAGES.map((s) => {
          const state = s.n === stage ? "current" : s.n < stage ? "done" : "todo";
          return (
            <li key={s.n} className="flex-1 min-w-[120px]">
              <button
                type="button"
                onClick={() => go(s.n as 1 | 2 | 3 | 4 | 5)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  state === "current"
                    ? "border-brand bg-brand-soft"
                    : state === "done"
                      ? "border-line bg-surface hover:border-brand"
                      : "border-line-soft bg-surface-2"
                }`}
              >
                <p className={`text-[11px] tabular-nums ${state === "todo" ? "text-ink-3" : "text-brand"}`}>
                  STEP {s.n}
                </p>
                <p className={`text-[12.5px] font-bold ${state === "todo" ? "text-ink-3" : ""}`}>{s.label}</p>
                <p className="text-[11px] text-ink-3">{s.hint}</p>
              </button>
            </li>
          );
        })}
      </ol>

      {mode === "edit" && runCount > 0 && (
        <div className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          この業務はすでに <span className="font-bold">{runCount}件</span> 実行されています。
          保存すると新しいバージョンとして登録され、
          <span className="font-medium">進行中の実行はいまのバージョンのまま進みます</span>。
          過去の実行記録・タスク・依存関係は変化しません。
        </div>
      )}

      <ErrorList errors={visibleErrors} />

      {/* ---------------- STEP1 基本情報 ---------------- */}
      {stage === 1 && (
        <Card className="flex flex-col gap-4 p-5">
          <Field label="業務名" required hint={`${draft.name.length} / ${NAME_MAX}`}>
            <input
              className={INPUT} value={draft.name} autoFocus
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="例：月次の実績まとめ"
            />
          </Field>
          <Field label="この業務は何をするものか" hint={`${draft.description.length} / ${DESCRIPTION_MAX}`}>
            <textarea
              className={INPUT} rows={3} value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="あとから自分が読んで思い出せる程度で構いません"
            />
          </Field>
          <Field label="カテゴリ" required hint="業務一覧の見出しになります">
            <input
              className={INPUT} value={draft.category} list="wf-categories"
              onChange={(e) => patch({ category: e.target.value })}
              placeholder="例：定例"
            />
            <datalist id="wf-categories">
              {Array.from(new Set(workflows.map((w) => w.category))).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="業務タイプ" required>
            <div className="grid gap-2 sm:grid-cols-2">
              {WORK_KINDS.map((k) => (
                <button
                  key={k.value} type="button"
                  onClick={() => patch({ workKind: k.value })}
                  className={`rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
                    draft.workKind === k.value ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand"
                  }`}
                >
                  <p className="text-[13px] font-bold">{k.label}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-3">{k.hint}</p>
                </button>
              ))}
            </div>
          </Field>
        </Card>
      )}

      {/* ---------------- STEP2 STEPを並べる ---------------- */}
      {stage === 2 && (
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-[13.5px] font-bold">この業務でやることを、順に並べます</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
              いまは名前だけで構いません。中身は次の画面で詰めます。並び順がそのまま進む順になります。
            </p>
          </div>

          {draft.flowLocked && (
            <p className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
              この業務は、登録画面では組み立てられない流れ（条件分岐ノード）を持っています。
              <span className="font-medium">STEPの並びと分岐はそのまま引き継ぎます。</span>
              各STEPの中身・期限・優先度・開始条件は次の画面から編集できます。
            </p>
          )}

          <ol className="flex flex-col gap-2">
            {draft.steps.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[11px] font-bold tabular-nums text-ink-3">
                  {i + 1}
                </span>
                <input
                  className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none"
                  value={s.title}
                  onChange={(e) => patchStep(s.key, { title: e.target.value })}
                  placeholder="STEP名"
                />
                {!draft.flowLocked && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</Button>
                    <Button variant="ghost" size="sm" onClick={() => moveStep(i, 1)} disabled={i === draft.steps.length - 1}>↓</Button>
                    <Button variant="ghost" size="sm" onClick={() => removeStep(s.key)}>削除</Button>
                  </div>
                )}
              </li>
            ))}
          </ol>

          {!draft.flowLocked && (
            <>
              <Button variant="secondary" onClick={addStep} className="self-start">＋ STEPを追加</Button>
              <p className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-3">
                最後の「完了」は自動で付きます。自分で追加する必要はありません。
              </p>
            </>
          )}
        </Card>
      )}

      {/* ---------------- STEP3 STEPの中身 ---------------- */}
      {stage === 3 && (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Card className="p-2">
            <ul className="flex flex-col gap-0.5">
              {draft.steps.map((s, i) => {
                const bad = allErrors.some((e) => e.stepKey === s.key && e.stage === 3);
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => setDetailKey(s.key)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                        detailKey === s.key ? "bg-brand-soft text-brand-ink" : "hover:bg-surface-2"
                      }`}
                    >
                      <span className="tabular-nums text-ink-3">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{s.title || "（名称未設定）"}</span>
                      {bad && <span className="text-danger">●</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {detail ? (
            <StepDetailEditor
              step={detail}
              knowledge={knowledge.map((k) => ({ id: k.id, title: k.title }))}
              onChange={(next) => patchStep(detail.key, next)}
            />
          ) : (
            <Card className="p-5 text-[13px] text-ink-3">左のSTEPを選んでください。</Card>
          )}
        </div>
      )}

      {/* ---------------- STEP4 進み方と条件 ---------------- */}
      {stage === 4 && (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4 p-5">
            <div>
              <h3 className="text-[13.5px] font-bold">STEPを終えたあと、どう進むか</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                {draft.flowLocked
                  ? "この業務の分岐・並列は、いまの構成をそのまま引き継ぎます。ここでは変更しません。"
                  : "既定は上から順の一本道です。分かれる場所・同時に進める場所だけ変えてください。"}
              </p>
            </div>
            {!draft.flowLocked && (
              <ul className="flex flex-col gap-2">
                {draft.steps.map((s, i) => (
                  <FlowEditor
                    key={s.key}
                    step={s}
                    index={i}
                    steps={draft.steps}
                    flow={draft.flow[s.key] ?? { kind: "next" }}
                    onChange={(f) => setFlow(s.key, f)}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <h3 className="text-[13.5px] font-bold">期限・所要時間・優先度</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="業務の期限" hint="開始日からの日数。空欄なら期限なし">
                <div className="flex items-center gap-2">
                  <input
                    className={`${INPUT} w-24`} value={draft.deadlineDays} inputMode="numeric"
                    onChange={(e) => patch({ deadlineDays: e.target.value })}
                  />
                  <span className="text-[12.5px] text-ink-2">日以内</span>
                  <label className="ml-1 flex items-center gap-1.5 text-[12px] text-ink-2">
                    <input
                      type="checkbox" checked={draft.deadlineBusinessDaysOnly}
                      onChange={(e) => patch({ deadlineBusinessDaysOnly: e.target.checked })}
                    />
                    営業日で数える
                  </label>
                </div>
              </Field>
              <Field label="想定所要時間" hint="空欄ならSTEPの合計を使います">
                <div className="flex items-center gap-2">
                  <input
                    className={`${INPUT} w-24`} value={draft.estimatedMinutes} inputMode="numeric"
                    onChange={(e) => patch({ estimatedMinutes: e.target.value })}
                  />
                  <span className="text-[12.5px] text-ink-2">分</span>
                </div>
              </Field>
            </div>
            <Field label="優先度" hint="期限が近づくと自動で引き上がります">
              <div className="flex flex-wrap gap-1.5">
                {TASK_PRIORITIES.map((p) => (
                  <button
                    key={p.value} type="button"
                    onClick={() => patch({ defaultPriority: p.value as TaskPriority })}
                    className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
                      draft.defaultPriority === p.value ? "border-brand bg-brand-soft font-bold" : "border-line bg-surface hover:border-brand"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11.5px] text-ink-3">
                期限の2日前になると「高」、期限を過ぎると「緊急」として扱われます。
              </p>
            </Field>
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <div>
              <h3 className="text-[13.5px] font-bold">いつ始める業務か</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                条件が来たらHOMEの「今日開始する業務」に出ます。勝手には始まりません。
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {TRIGGER_CHOICES.map((c) => (
                <button
                  key={c.kind} type="button"
                  onClick={() => patch({ startTrigger: { ...draft.startTrigger, kind: c.kind } })}
                  className={`rounded-lg border px-3.5 py-2 text-left transition-colors ${
                    draft.startTrigger.kind === c.kind ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand"
                  }`}
                >
                  <p className="text-[12.5px] font-bold">{c.label}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{c.hint}</p>
                </button>
              ))}
            </div>

            {draft.startTrigger.kind === "date" && (
              <Field label="開始する日">
                <input
                  type="date" className={INPUT} value={draft.startTrigger.date}
                  onChange={(e) => patch({ startTrigger: { ...draft.startTrigger, date: e.target.value } })}
                />
              </Field>
            )}
            {draft.startTrigger.kind === "weekday" && (
              <Field label="開始する曜日">
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((w, i) => {
                    const on = draft.startTrigger.weekdays.includes(i);
                    return (
                      <button
                        key={i} type="button"
                        onClick={() => patch({
                          startTrigger: {
                            ...draft.startTrigger,
                            weekdays: on
                              ? draft.startTrigger.weekdays.filter((x) => x !== i)
                              : [...draft.startTrigger.weekdays, i],
                          },
                        })}
                        className={`h-9 w-9 rounded-lg border text-[12.5px] font-medium transition-colors ${
                          on ? "border-brand bg-brand text-white" : "border-line bg-surface hover:border-brand"
                        }`}
                      >
                        {w}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
            {draft.startTrigger.kind === "time" && (
              <Field label="開始する時刻">
                <input
                  type="time" className={`${INPUT} w-40`} value={draft.startTrigger.time}
                  onChange={(e) => patch({ startTrigger: { ...draft.startTrigger, time: e.target.value } })}
                />
              </Field>
            )}
            {draft.startTrigger.kind === "event" && (
              <Field label="きっかけになる出来事">
                <input
                  className={INPUT} value={draft.startTrigger.eventLabel}
                  onChange={(e) => patch({ startTrigger: { ...draft.startTrigger, eventLabel: e.target.value } })}
                  placeholder="自分の言葉で書いてください"
                />
              </Field>
            )}
            {draft.startTrigger.kind === "task" && (
              <Field label="きっかけになるタスク">
                <input
                  className={INPUT} value={draft.startTrigger.taskLabel}
                  onChange={(e) => patch({ startTrigger: { ...draft.startTrigger, taskLabel: e.target.value } })}
                />
              </Field>
            )}
            {draft.startTrigger.kind === "after-workflow" && (
              <Field label="先に完了する業務">
                <select
                  className={INPUT} value={draft.startTrigger.afterWorkflowKey}
                  onChange={(e) => patch({ startTrigger: { ...draft.startTrigger, afterWorkflowKey: e.target.value } })}
                >
                  <option value="">選択してください</option>
                  {otherWorkflows.map((w) => (
                    <option key={w.key} value={w.key}>{w.name}</option>
                  ))}
                </select>
              </Field>
            )}
            {draft.startTrigger.kind === "condition" && (
              <Field label="成立させたい条件">
                <input
                  className={INPUT} value={draft.startTrigger.note}
                  onChange={(e) => patch({ startTrigger: { ...draft.startTrigger, note: e.target.value } })}
                  placeholder="判定は自分で行います。条件を書き残しておくためのものです"
                />
              </Field>
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <label className="flex items-center gap-2 text-[13.5px] font-bold">
              <input
                type="checkbox" checked={draft.quota.enabled}
                onChange={(e) => patch({ quota: { ...draft.quota, enabled: e.target.checked } })}
              />
              この業務に目標・ノルマを置く
            </label>
            {draft.quota.enabled && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <select
                  className={SMALL_INPUT} value={draft.quota.period}
                  onChange={(e) => patch({ quota: { ...draft.quota, period: e.target.value as typeof draft.quota.period } })}
                >
                  <option value="day">1日</option>
                  <option value="week">1週</option>
                  <option value="month">1か月</option>
                  <option value="quarter">四半期</option>
                  <option value="year">1年</option>
                </select>
                <span>あたり</span>
                <input
                  className={`${SMALL_INPUT} w-20`} value={draft.quota.target} inputMode="numeric"
                  onChange={(e) => patch({ quota: { ...draft.quota, target: e.target.value } })}
                />
                <select
                  className={SMALL_INPUT} value={draft.quota.metric}
                  onChange={(e) => patch({ quota: { ...draft.quota, metric: e.target.value as typeof draft.quota.metric } })}
                >
                  <option value="count">件</option>
                  <option value="hours">時間</option>
                </select>
                <select
                  className={SMALL_INPUT} value={draft.quota.direction}
                  onChange={(e) => patch({ quota: { ...draft.quota, direction: e.target.value as typeof draft.quota.direction } })}
                >
                  <option value="atLeast">以上こなす</option>
                  <option value="atMost">以内に収める</option>
                </select>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ---------------- STEP5 確認 ---------------- */}
      {stage === 5 && (
        <div className="flex flex-col gap-4">
          <ErrorList errors={allErrors} />
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[16px] font-bold">{draft.name || "（名称未設定）"}</h3>
              <Badge tone="brand">{WORK_KINDS.find((k) => k.value === draft.workKind)?.label}</Badge>
              <Badge tone="neutral">{draft.category || "カテゴリ未設定"}</Badge>
            </div>
            {draft.description && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{draft.description}</p>
            )}
            <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
              <div className="flex justify-between gap-3 border-b border-line-soft pb-1.5">
                <dt className="text-ink-3">STEP数</dt><dd>{draft.steps.length}（＋完了）</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line-soft pb-1.5">
                <dt className="text-ink-3">開始条件</dt>
                <dd className="text-right">{describeStartTrigger({
                  kind: draft.startTrigger.kind,
                  date: draft.startTrigger.date || undefined,
                  weekdays: draft.startTrigger.weekdays,
                  time: draft.startTrigger.time || undefined,
                  eventLabel: draft.startTrigger.eventLabel || undefined,
                  taskLabel: draft.startTrigger.taskLabel || undefined,
                  afterWorkflowKey: draft.startTrigger.afterWorkflowKey || undefined,
                  note: draft.startTrigger.note || undefined,
                })}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line-soft pb-1.5">
                <dt className="text-ink-3">期限</dt>
                <dd>{draft.deadlineDays ? `開始から${draft.deadlineDays}${draft.deadlineBusinessDaysOnly ? "営業" : ""}日` : "なし"}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line-soft pb-1.5">
                <dt className="text-ink-3">優先度</dt>
                <dd>{TASK_PRIORITIES.find((p) => p.value === draft.defaultPriority)?.label}</dd>
              </div>
              {draft.quota.enabled && (
                <div className="flex justify-between gap-3 border-b border-line-soft pb-1.5">
                  <dt className="text-ink-3">目標</dt>
                  <dd>
                    {{ day: "1日", week: "1週", month: "1か月", quarter: "四半期", year: "1年" }[draft.quota.period]}
                    あたり {draft.quota.target}
                    {draft.quota.metric === "count" ? "件" : "時間"}
                    {draft.quota.direction === "atLeast" ? "以上" : "以内"}
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          <Card className="p-5">
            <h4 className="mb-3 text-[13px] font-bold">STEPの流れ</h4>
            <ol className="flex flex-col gap-1.5">
              {draft.steps.map((s, i) => {
                const f = draft.flow[s.key] ?? { kind: "next" as const };
                const spec = getComponentSpec(s.componentType);
                return (
                  <li key={s.key} className="rounded-lg border border-line bg-surface px-3.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums text-[11px] text-ink-3">{i + 1}</span>
                      <span className="text-[13px] font-medium">{s.title || "（名称未設定）"}</span>
                      <Badge tone="brand">{spec.icon} {spec.label}</Badge>
                      {!s.required && <Badge tone="neutral">任意</Badge>}
                      {s.estimatedMinutes && <span className="text-[11px] text-ink-3">{s.estimatedMinutes}分</span>}
                    </div>
                    {f.kind === "branch" && (
                      <p className="mt-1 text-[11.5px] text-brand">
                        ⑂ 選んだ内容で {f.paths.length} 通りに分かれます
                      </p>
                    )}
                    {f.kind === "parallel" && (
                      <p className="mt-1 text-[11.5px] text-brand">
                        ⇉ {f.toStepKeys.length} 件を同時に進め、そろってから合流します
                      </p>
                    )}
                  </li>
                );
              })}
              <li className="rounded-lg border border-ok/40 bg-ok-soft px-3.5 py-2 text-[13px] font-medium text-ok">
                完了
              </li>
              {draft.flowLocked && (
                <li className="px-1 pt-1 text-[11.5px] text-ink-3">
                  分岐・並列はいまの構成のまま引き継がれます
                </li>
              )}
            </ol>
          </Card>

          <Card className="p-5">
            <button
              type="button"
              onClick={() => setOpenNotes((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span>
                <span className="text-[13px] font-bold">後から追加できる項目</span>
                <span className="ml-2 text-[11.5px] text-ink-3">すべて任意。あとで編集からでも足せます</span>
              </span>
              <span className="text-[12px] text-ink-3">{openNotes ? "閉じる" : "開く"}</span>
            </button>
            {openNotes && (
              <NotesEditor notes={draft.notes} onChange={(notes) => patch({ notes })} />
            )}
          </Card>
        </div>
      )}

      {/* ---------------- 操作 ---------------- */}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-1 py-3">
        <Button variant="ghost" onClick={onCancel}>やめる</Button>
        <div className="ml-auto flex items-center gap-2">
          {stage > 1 && (
            <Button variant="secondary" onClick={() => go((stage - 1) as 1 | 2 | 3 | 4)}>戻る</Button>
          )}
          {stage < 5 ? (
            <Button onClick={() => go((stage + 1) as 2 | 3 | 4 | 5)}>次へ</Button>
          ) : (
            <Button size="lg" onClick={save} disabled={allErrors.length > 0}>
              {mode === "create" ? "この内容で登録する" : "この内容で保存する"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STEPの中身
// ---------------------------------------------------------------------------

function StepDetailEditor({
  step, knowledge, onChange,
}: {
  step: StepDraft;
  knowledge: { id: string; title: string }[];
  onChange: (next: Partial<StepDraft>) => void;
}) {
  function addField() {
    onChange({
      fields: [...step.fields, { key: nextFieldKey(step), label: "", required: true, options: [] }],
    });
  }
  function patchField(key: string, next: Partial<StepDraft["fields"][number]>) {
    onChange({ fields: step.fields.map((f) => (f.key === key ? { ...f, ...next } : f)) });
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <Field label="STEP名" required>
        <input className={INPUT} value={step.title} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>

      <Field label="このSTEPで何をするか" hint="ナビゲーターに常に表示されます">
        <textarea
          className={INPUT} rows={2} value={step.guidance}
          onChange={(e) => onChange({ guidance: e.target.value })}
          placeholder="空欄ならSTEP名がそのまま表示されます"
        />
      </Field>

      <Field label="このSTEPの前提" hint="任意">
        <input
          className={INPUT} value={step.preconditions}
          onChange={(e) => onChange({ preconditions: e.target.value })}
          placeholder="始める前に済んでいるべきこと"
        />
      </Field>

      <Field label="STEPの種類" required>
        {step.locked ? (
          <div className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5">
            <p className="text-[12.5px] font-bold">
              {getComponentSpec(step.componentType).icon} {getComponentSpec(step.componentType).label}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
              この種類は登録画面では設定を組み立てられません。種類と設定はそのまま引き継ぎ、
              STEP名・説明・所要時間・必須／任意だけをここで編集できます。
            </p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {REGISTERABLE_COMPONENTS.map((c) => (
              <button
                key={c.type} type="button"
                onClick={() => onChange({ componentType: c.type })}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  step.componentType === c.type ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand"
                }`}
              >
                <p className="text-[12.5px] font-bold">{getComponentSpec(c.type).icon} {c.label}</p>
                <p className="mt-0.5 text-[11px] text-ink-3">{c.hint}</p>
              </button>
            ))}
          </div>
        )}
      </Field>

      <div className="flex flex-wrap items-end gap-5">
        <Field label="想定所要時間" hint="任意">
          <div className="flex items-center gap-2">
            <input
              className={`${INPUT} w-24`} value={step.estimatedMinutes} inputMode="numeric"
              onChange={(e) => onChange({ estimatedMinutes: e.target.value })}
            />
            <span className="text-[12.5px] text-ink-2">分</span>
          </div>
        </Field>
        <label className="flex items-center gap-2 pb-2 text-[13px]">
          <input
            type="checkbox" checked={step.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          このSTEPは必須
        </label>
      </div>

      {/* --- 種類ごとの設定。引き継ぐSTEPには出さない --- */}
      {!step.locked && step.componentType === "checklist" && (
        <Field label="チェック項目" required>
          <ul className="flex flex-col gap-1.5">
            {step.items.map((item, i) => (
              <li key={item.key} className="flex items-center gap-2">
                <input
                  className={INPUT} value={item.label}
                  onChange={(e) => onChange({
                    items: step.items.map((x) => (x.key === item.key ? { ...x, label: e.target.value } : x)),
                  })}
                  placeholder={`確認すること ${i + 1}`}
                />
                <Button variant="ghost" size="sm" onClick={() => onChange({ items: step.items.filter((x) => x.key !== item.key) })}>
                  削除
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary" size="sm" className="mt-2"
            onClick={() => onChange({
              items: [...step.items, { key: `${step.key}-c${step.items.length + 1}-${Math.random().toString(36).slice(2, 6)}`, label: "" }],
            })}
          >
            ＋ 項目を追加
          </Button>
        </Field>
      )}

      {!step.locked && (step.componentType === "input" || step.componentType === "select") && (
        <Field label={step.componentType === "select" ? "選ぶ項目" : "入力する項目"} required>
          <ul className="flex flex-col gap-3">
            {step.fields.map((f) => (
              <li key={f.key} className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <input
                    className={INPUT} value={f.label}
                    onChange={(e) => patchField(f.key, { label: e.target.value })}
                    placeholder="項目名"
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2">
                    <input
                      type="checkbox" checked={f.required}
                      onChange={(e) => patchField(f.key, { required: e.target.checked })}
                    />
                    必須
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => onChange({ fields: step.fields.filter((x) => x.key !== f.key) })}>
                    削除
                  </Button>
                </div>

                {step.componentType === "select" && (
                  <div className="mt-2.5 border-t border-line pt-2.5">
                    <p className="mb-1.5 text-[11.5px] text-ink-3">選択肢（この選択は分岐の判定に使えます）</p>
                    <ul className="flex flex-col gap-1.5">
                      {f.options.map((o, j) => (
                        <li key={j} className="flex items-center gap-2">
                          <input
                            className={INPUT} value={o.label}
                            onChange={(e) => patchField(f.key, {
                              options: f.options.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)),
                            })}
                            placeholder={`選択肢 ${j + 1}`}
                          />
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => patchField(f.key, { options: f.options.filter((_, k) => k !== j) })}
                          >
                            削除
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant="secondary" size="sm" className="mt-2"
                      onClick={() => patchField(f.key, {
                        options: [...f.options, { value: `opt-${f.options.length + 1}`, label: "" }],
                      })}
                    >
                      ＋ 選択肢を追加
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="mt-2" onClick={addField}>＋ 項目を追加</Button>
        </Field>
      )}

      {!step.locked && step.componentType === "task-create" && (
        <Field label="このSTEPを終えたら作るタスク" required>
          <ul className="flex flex-col gap-1.5">
            {step.templates.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <input
                  className={`${INPUT} min-w-[180px] flex-1`} value={t.title}
                  onChange={(e) => onChange({
                    templates: step.templates.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)),
                  })}
                  placeholder="タスク名"
                />
                <span className="text-[12px] text-ink-3">完了から</span>
                <input
                  className={`${SMALL_INPUT} w-16`} value={t.offsetDays} inputMode="numeric"
                  onChange={(e) => onChange({
                    templates: step.templates.map((x, k) => (k === i ? { ...x, offsetDays: e.target.value } : x)),
                  })}
                />
                <span className="text-[12px] text-ink-3">営業日後</span>
                <Button variant="ghost" size="sm" onClick={() => onChange({ templates: step.templates.filter((_, k) => k !== i) })}>
                  削除
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary" size="sm" className="mt-2"
            onClick={() => onChange({ templates: [...step.templates, { title: "", offsetDays: "" }] })}
          >
            ＋ タスクを追加
          </Button>
        </Field>
      )}

      {!step.locked && step.componentType === "knowledge-view" && (
        <Field label="このSTEPで見る資料">
          {knowledge.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">登録されているナレッジがありません。</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {knowledge.map((k) => (
                <li key={k.id}>
                  <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-surface-2">
                    <input
                      type="checkbox" checked={step.knowledgeRefs.includes(k.id)}
                      onChange={(e) => onChange({
                        knowledgeRefs: e.target.checked
                          ? [...step.knowledgeRefs, k.id]
                          : step.knowledgeRefs.filter((x) => x !== k.id),
                      })}
                    />
                    {k.title}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Field>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 進み方
// ---------------------------------------------------------------------------

function FlowEditor({
  step, index, steps, flow, onChange,
}: {
  step: StepDraft;
  index: number;
  steps: StepDraft[];
  flow: FlowDraft;
  onChange: (f: FlowDraft) => void;
}) {
  const later = steps.slice(index + 1);
  // 分岐の判定に使えるのは、ここまでに選択・入力した項目
  const usableFields = steps
    .slice(0, index + 1)
    .filter((s) => s.componentType === "select" || s.componentType === "input")
    .flatMap((s) => s.fields.map((f) => ({ ...f, stepTitle: s.title })));

  const branchField = flow.kind === "branch"
    ? usableFields.find((f) => f.key === flow.fieldKey)
    : undefined;

  return (
    <li className="rounded-lg border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums text-[11px] text-ink-3">{index + 1}</span>
        <span className="text-[13px] font-medium">{step.title || "（名称未設定）"}</span>
        <span className="text-[11.5px] text-ink-3">のあと</span>
        <select
          className={`${SMALL_INPUT} ml-auto`}
          value={flow.kind}
          onChange={(e) => {
            const kind = e.target.value as FlowDraft["kind"];
            if (kind === "branch") {
              onChange({ kind: "branch", fieldKey: usableFields[0]?.key ?? "", paths: [], elseToStepKey: "" });
            } else if (kind === "parallel") {
              onChange({ kind: "parallel", toStepKeys: [], joinStepKey: "" });
            } else {
              onChange({ kind });
            }
          }}
        >
          <option value="next">次のSTEPへ進む</option>
          <option value="branch" disabled={usableFields.length === 0 || later.length === 0}>
            条件で分かれる
          </option>
          <option value="parallel" disabled={later.length < 3}>複数を同時に進める</option>
          <option value="end">ここで完了する</option>
        </select>
      </div>

      {flow.kind === "branch" && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-ink-3">判定に使う項目</span>
            <select
              className={SMALL_INPUT} value={flow.fieldKey}
              onChange={(e) => onChange({ ...flow, fieldKey: e.target.value, paths: [] })}
            >
              <option value="">選択してください</option>
              {usableFields.map((f) => (
                <option key={f.key} value={f.key}>{f.label || f.key}（{f.stepTitle}）</option>
              ))}
            </select>
          </div>

          {branchField && branchField.options.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {branchField.options.map((o) => {
                const path = flow.paths.find((p) => p.value === o.value);
                return (
                  <li key={o.value} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <span className="min-w-[140px] rounded bg-surface-2 px-2 py-1">{o.label || o.value}</span>
                    <span className="text-ink-3">なら</span>
                    <select
                      className={SMALL_INPUT}
                      value={path?.toStepKey ?? ""}
                      onChange={(e) => {
                        const to = e.target.value;
                        const rest = flow.paths.filter((p) => p.value !== o.value);
                        onChange({
                          ...flow,
                          paths: to ? [...rest, { value: o.value, label: o.label, toStepKey: to }] : rest,
                        });
                      }}
                    >
                      <option value="">（分けない）</option>
                      {later.map((s) => (
                        <option key={s.key} value={s.key}>{s.title || s.key}</option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          )}

          {branchField && branchField.options.length === 0 && (
            <p className="mt-2 text-[12px] text-ink-3">
              この項目には選択肢がありません。STEP3で選択肢を追加してください。
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-ink-3">どれにも当てはまらないとき</span>
            <select
              className={SMALL_INPUT} value={flow.elseToStepKey}
              onChange={(e) => onChange({ ...flow, elseToStepKey: e.target.value })}
            >
              <option value="">次のSTEPへ</option>
              {later.map((s) => (
                <option key={s.key} value={s.key}>{s.title || s.key}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {flow.kind === "parallel" && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1.5 text-[12px] text-ink-3">同時に進めるSTEP（2つ以上）</p>
          <ul className="flex flex-wrap gap-1.5">
            {later.filter((s) => s.key !== flow.joinStepKey).map((s) => {
              const on = flow.toStepKeys.includes(s.key);
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => onChange({
                      ...flow,
                      toStepKeys: on
                        ? flow.toStepKeys.filter((x) => x !== s.key)
                        : [...flow.toStepKeys, s.key],
                    })}
                    className={`rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
                      on ? "border-brand bg-brand-soft font-medium" : "border-line bg-surface hover:border-brand"
                    }`}
                  >
                    {s.title || s.key}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-ink-3">全部そろったら</span>
            <select
              className={SMALL_INPUT} value={flow.joinStepKey}
              onChange={(e) => onChange({ ...flow, joinStepKey: e.target.value })}
            >
              <option value="">選択してください</option>
              {later.filter((s) => !flow.toStepKeys.includes(s.key)).map((s) => (
                <option key={s.key} value={s.key}>{s.title || s.key}</option>
              ))}
            </select>
            <span className="text-ink-3">へ合流</span>
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 後から追加できる項目
// ---------------------------------------------------------------------------

const NOTE_TEXTS: { key: keyof WorkflowNotes; label: string; placeholder: string }[] = [
  { key: "cautions", label: "注意事項", placeholder: "気をつけていること" },
  { key: "specialRules", label: "特殊ルール", placeholder: "この業務だけの決まり" },
  { key: "exceptions", label: "よくある例外", placeholder: "たまに起きるパターン" },
  { key: "emergency", label: "緊急時の対応", placeholder: "うまくいかないときにやること" },
  { key: "criteria", label: "判断基準", placeholder: "迷ったときの決め方" },
  { key: "aiInstruction", label: "AIへの指示", placeholder: "AIに任せたいこと（接続は今後）" },
  { key: "memo", label: "メモ", placeholder: "自由に" },
];

const NOTE_LISTS: { key: keyof WorkflowNotes; label: string; placeholder: string }[] = [
  { key: "tools", label: "関連ツール", placeholder: "1行に1つ" },
  { key: "materials", label: "関連資料", placeholder: "1行に1つ" },
  { key: "companies", label: "関連企業", placeholder: "1行に1つ" },
  { key: "checkItems", label: "チェック項目", placeholder: "1行に1つ" },
];

export function NotesEditor({
  notes, onChange,
}: {
  notes: WorkflowNotes;
  onChange: (next: WorkflowNotes) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
      {NOTE_TEXTS.map((n) => (
        <Field key={n.key} label={n.label}>
          <textarea
            className={INPUT} rows={2}
            value={(notes[n.key] as string) ?? ""}
            onChange={(e) => onChange({ ...notes, [n.key]: e.target.value })}
            placeholder={n.placeholder}
          />
        </Field>
      ))}
      {NOTE_LISTS.map((n) => (
        <Field key={n.key} label={n.label} hint="1行に1つ">
          <textarea
            className={INPUT} rows={2}
            value={((notes[n.key] as string[]) ?? []).join("\n")}
            onChange={(e) => onChange({
              ...notes,
              [n.key]: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean),
            })}
            placeholder={n.placeholder}
          />
        </Field>
      ))}
      <Field label="よくある質問" hint="1行に1件。「質問｜答え」の形で書きます">
        <textarea
          className={INPUT} rows={3}
          value={(notes.faq ?? []).map((f) => `${f.q}｜${f.a}`).join("\n")}
          onChange={(e) => onChange({
            ...notes,
            faq: e.target.value
              .split("\n")
              .map((line) => line.split("｜"))
              .filter((parts) => parts[0]?.trim())
              .map((parts) => ({ q: parts[0].trim(), a: (parts[1] ?? "").trim() })),
          })}
        />
      </Field>
    </div>
  );
}
