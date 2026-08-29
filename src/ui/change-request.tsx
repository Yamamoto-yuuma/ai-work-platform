"use client";

/**
 * 業務ナビゲーターからの変更起票（仕様 §10-3 / §10-5 / §10-6）。
 *
 * 入力 → 影響プレビュー → ユーザー確認 → 確定 の順に進む。
 * 「確定」を押すまでストアには一切書き込まない。
 * 影響の中身は全て既存エンジン（派生ルール／既存スケジューラ）が出したもので、
 * 分からないものを推測して表示することはしない。
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useNow } from "@/ui/use-navigator";
import { Badge, Button, Card, LinkButton } from "./primitives";
import { DeadlineProposalRow } from "./deadline-cascade";
import {
  listChangeTargets, buildChangeEvent, validateChangeDraft,
  type ChangeDraft, type ChangeTarget,
} from "@/core/change/targets";
import { analyzeChange, newDerivedTasks, type ChangeImpact } from "@/core/change/impact";
import type { Task, WorkRun, WorkflowDefinition } from "@/core/model/types";

const IMPACT_LABEL = { direct: "直接影響", indirect: "間接影響", check: "確認事項" } as const;
const IMPACT_TONE = { direct: "danger", indirect: "signal", check: "brand" } as const;

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
}

/** 入力欄の表示形式はブラウザ任せなので、日本語表記を必ず添える */
function formatJaDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}

/** 日付入力を、元の時刻を保った ISO へ戻す */
function fromDateInput(value: string, keepTimeOf?: string): string {
  if (!value) return "";
  const d = new Date(`${value}T00:00:00`);
  const base = keepTimeOf ? new Date(keepTimeOf) : null;
  if (base && !Number.isNaN(base.getTime())) {
    d.setHours(base.getHours(), base.getMinutes(), 0, 0);
  } else {
    d.setHours(18, 0, 0, 0);
  }
  return d.toISOString();
}

type Phase = "closed" | "input" | "preview" | "done";

interface Applied {
  changeLabel: string;
  /** 業務そのものの期限を更新したか */
  runDeadline?: { from: string; to: string };
  createdTasks: Task[];
  updatedDeadlines: { title: string; from: string; to: string }[];
  changeId: string;
}

export function ChangeRequestPanel({
  run, def, onClose,
}: {
  run: WorkRun;
  def: WorkflowDefinition;
  onClose: () => void;
}) {
  const { state, dispatch, derivationRules } = useStore();
  const now = useNow();

  const targets = useMemo(
    () => listChangeTargets({ run, workflow: def, derivationRules }),
    [run, def, derivationRules],
  );

  const [phase, setPhase] = useState<Phase>("input");
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [entityLabel, setEntityLabel] = useState("");
  const [beforeInput, setBeforeInput] = useState("");
  const [after, setAfter] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [impact, setImpact] = useState<ChangeImpact | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [selectedDeadlines, setSelectedDeadlines] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Applied | null>(null);

  const target: ChangeTarget | undefined = targets.find((t) => t.id === targetId);

  function reset() {
    setPhase("input"); setAfter(""); setReason(""); setEntityLabel(""); setBeforeInput("");
    setErrors([]); setImpact(null); setApplied(null);
  }

  /** 入力 → 影響分析。ここではストアに触れない */
  function analyze() {
    if (!target) return;
    const draft: ChangeDraft = {
      targetId,
      entityLabel: entityLabel || (target.kind === "derivation" ? "" : target.entityLabel),
      before: target.currentValue
        ?? (beforeInput && target.valueType === "date" ? fromDateInput(beforeInput) : beforeInput),
      after: target.valueType === "date" ? fromDateInput(after, target.currentValue) : after,
      reason,
    };
    const found = validateChangeDraft(target, draft);
    if (found.length > 0) { setErrors(found); return; }

    const change = buildChangeEvent({
      target, draft, run, actor: state.currentUserId, now,
    });
    const result = analyzeChange({
      change, target, workflowKey: def.key,
      derivationRules, tasks: state.tasks, assigneeId: state.currentUserId,
    });

    setErrors([]);
    setImpact(result);
    // 既定は全選択。ユーザーが個別に外せる（仕様 §10-6）
    setSelectedTasks(new Set(newDerivedTasks(result, state.tasks).map((t) => t.id)));
    setSelectedDeadlines(new Set(result.deadlineProposals.map((p) => p.taskId)));
    setPhase("preview");
  }

  /** 確定。ここで初めてストアを更新する */
  function confirm() {
    if (!impact || !target) return;

    // 1. 変更イベントを記録（同一IDは既存の store 側で弾かれる）
    dispatch({ type: "addChangeEvent", change: impact.change });

    // 2. 業務の期限そのものを更新
    if (target.kind === "run-deadline") {
      dispatch({ type: "updateRun", runId: run.id, patch: { dueAt: String(impact.change.after) } });
    }

    // 3. 選ばれた派生タスクだけを作成し、確定させる
    const creating = newDerivedTasks(impact, state.tasks).filter((t) => selectedTasks.has(t.id));
    if (creating.length > 0) {
      dispatch({ type: "addTasks", tasks: creating });
      dispatch({ type: "confirmTasks", taskIds: creating.map((t) => t.id) });
    }

    // 4. 選ばれた期限の再提案だけを反映
    const shifting = impact.deadlineProposals.filter((p) => selectedDeadlines.has(p.taskId));
    for (const p of shifting) {
      dispatch({ type: "updateTask", taskId: p.taskId, patch: { dueAt: p.proposedDueAt } });
    }

    setApplied({
      changeLabel: `${impact.change.fieldLabel}：${describeValue(impact.change.before) || "（未登録）"} → ${describeValue(impact.change.after)}`,
      runDeadline: target.kind === "run-deadline"
        ? { from: String(impact.change.before), to: String(impact.change.after) }
        : undefined,
      createdTasks: creating,
      updatedDeadlines: shifting.map((p) => ({
        title: p.title, from: p.currentDueAt, to: p.proposedDueAt,
      })),
      changeId: impact.change.id,
    });
    setPhase("done");
  }

  if (phase === "done" && applied) {
    return <AppliedSummary applied={applied} onAgain={reset} onClose={onClose} />;
  }

  return (
    <Card className="mt-4 border-signal/40">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-5 py-3">
        <div>
          <h3 className="text-[14px] font-bold">業務途中の変更を起票する</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {phase === "input"
              ? "変更内容を入力すると、影響を確認できます。この時点では何も変更されません"
              : "内容を確認してください。確定するまでタスクも期限も変わりません"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>閉じる</Button>
      </header>

      {phase === "input" && (
        <div className="flex flex-col gap-4 p-5">
          {/* 変更対象 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium">
              何が変わりましたか<span className="ml-1.5 text-[11px] text-danger">必須</span>
            </label>
            <div className="flex flex-col gap-1.5">
              {targets.map((t) => (
                <label
                  key={t.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
                    t.id === targetId ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2"
                  }`}
                >
                  <input
                    type="radio" name="change-target" checked={t.id === targetId}
                    onChange={() => {
                      setTargetId(t.id); setAfter(""); setBeforeInput(""); setErrors([]);
                      setEntityLabel(t.kind === "derivation" ? run.subject.label : "");
                    }}
                    className="mt-0.5 h-4 w-4 accent-[#1d5a78]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-snug">{t.label}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-3">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {target && (
            <>
              {/* 変更されたものの名称（派生ルール由来のときだけ） */}
              {target.kind === "derivation" && (
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium" htmlFor="change-entity">
                    何の{target.fieldLabel}が変わりましたか
                    <span className="ml-1.5 text-[11px] text-danger">必須</span>
                  </label>
                  <input
                    id="change-entity" type="text" value={entityLabel}
                    onChange={(e) => setEntityLabel(e.target.value)}
                    placeholder="例：秋の業務効率化キャンペーン"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
                  />
                </div>
              )}

              {/* 変更前 */}
              <div>
                <label className="mb-1.5 block text-[13px] font-medium">変更前</label>
                {target.currentValue ? (
                  <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] tabular-nums">
                    {target.valueType === "date" ? fmtDate(target.currentValue) : target.currentValue}
                  </p>
                ) : (
                  <>
                    {/* 分からない値を推測しない。分かる人に入力してもらう */}
                    {target.valueType === "date" ? (
                      <input
                        type="date" value={beforeInput}
                        onChange={(e) => setBeforeInput(e.target.value)}
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
                      />
                    ) : (
                      <input
                        type="text" value={beforeInput}
                        onChange={(e) => setBeforeInput(e.target.value)}
                        placeholder="変更前の内容"
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
                      />
                    )}
                    <p className="mt-1.5 text-[11.5px] text-ink-3">
                      この値はシステムに登録されていないため、分かる場合は入力してください（任意）。
                    </p>
                  </>
                )}
              </div>

              {/* 変更後 */}
              <div>
                <label className="mb-1.5 block text-[13px] font-medium" htmlFor="change-after">
                  変更後<span className="ml-1.5 text-[11px] text-danger">必須</span>
                </label>
                {target.valueType === "date" ? (
                  <>
                    <input
                      id="change-after" type="date" value={after}
                      onChange={(e) => setAfter(e.target.value)}
                      className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
                    />
                    {after && (
                      <p className="mt-1.5 text-[11.5px] text-ink-3">{formatJaDate(after)}</p>
                    )}
                  </>
                ) : (
                  <input
                    id="change-after" type="text" value={after}
                    onChange={(e) => setAfter(e.target.value)}
                    placeholder="変更後の内容"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
                  />
                )}
              </div>

              {/* 理由（ChangeEvent.reason に保存される） */}
              <div>
                <label className="mb-1.5 block text-[13px] font-medium" htmlFor="change-reason">
                  変更理由<span className="ml-1.5 text-[11px] text-ink-3">任意</span>
                </label>
                <textarea
                  id="change-reason" rows={2} value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="なぜ変更が必要になったかを記録します（後から判断の根拠を追跡するため）"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
                />
              </div>
            </>
          )}

          {errors.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2.5">
              {errors.map((e, i) => (
                <li key={i} className="text-[12.5px] text-danger">・{e}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={analyze}>影響を確認する</Button>
            <Button variant="secondary" onClick={onClose}>やめる</Button>
            <span className="text-[11.5px] text-ink-3">確認しても、まだ何も変更されません</span>
          </div>
        </div>
      )}

      {phase === "preview" && impact && target && (
        <ImpactPreview
          impact={impact} target={target} tasks={state.tasks}
          selectedTasks={selectedTasks} setSelectedTasks={setSelectedTasks}
          selectedDeadlines={selectedDeadlines} setSelectedDeadlines={setSelectedDeadlines}
          onConfirm={confirm}
          onBack={() => { setPhase("input"); setImpact(null); }}
          onCancel={() => { reset(); onClose(); }}
        />
      )}
    </Card>
  );
}

function describeValue(v: unknown): string {
  const s = String(v);
  const d = new Date(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(d.getTime())) return fmtDate(s);
  return s;
}

// --- 影響プレビュー ----------------------------------------------------------
function ImpactPreview({
  impact, target, tasks,
  selectedTasks, setSelectedTasks, selectedDeadlines, setSelectedDeadlines,
  onConfirm, onBack, onCancel,
}: {
  impact: ChangeImpact;
  target: ChangeTarget;
  tasks: Task[];
  selectedTasks: Set<string>;
  setSelectedTasks: (s: Set<string>) => void;
  selectedDeadlines: Set<string>;
  setSelectedDeadlines: (s: Set<string>) => void;
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const creatable = newDerivedTasks(impact, tasks);
  const already = impact.derivedTasks.length - creatable.length;
  const chosenTasks = creatable.filter((t) => selectedTasks.has(t.id)).length;
  const chosenDeadlines = impact.deadlineProposals.filter((p) => selectedDeadlines.has(p.taskId)).length;
  const nothingChosen = chosenTasks === 0 && chosenDeadlines === 0 && target.kind !== "run-deadline";

  const toggle = (set: Set<string>, apply: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    apply(next);
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* 変更内容 */}
      <section className="rounded-lg border border-brand/30 bg-brand-soft px-4 py-3">
        <p className="text-[11px] font-bold tracking-wide text-brand">変更内容</p>
        <p className="mt-1 text-[14px] font-bold text-brand-ink">{impact.change.entityLabel}</p>
        <p className="mt-0.5 text-[13px]">
          {impact.change.fieldLabel}：
          <span className="mx-1.5 line-through opacity-60">{describeValue(impact.change.before) || "（未登録）"}</span>
          →
          <span className="mx-1.5 font-bold">{describeValue(impact.change.after)}</span>
        </p>
        {impact.change.reason && (
          <p className="mt-1.5 text-[12.5px] text-ink-2">理由：{impact.change.reason}</p>
        )}
      </section>

      {/* 業務の期限そのものの更新 */}
      {target.kind === "run-deadline" && (
        <section>
          <h4 className="mb-2 text-[12px] font-bold text-ink-3">この業務の期限</h4>
          <p className="rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[13px]">
            <span className="text-ink-3 line-through tabular-nums">{describeValue(impact.change.before)}</span>
            <span className="mx-2 text-ink-3">→</span>
            <span className="font-bold tabular-nums">{describeValue(impact.change.after)}</span>
            <span className="ml-2 text-[11.5px] text-ink-3">確定すると業務の期限が更新されます</span>
          </p>
        </section>
      )}

      {/* 期限が変わる既存タスク */}
      {impact.deadlineProposals.length > 0 && (
        <section>
          <h4 className="mb-1 text-[12px] font-bold text-ink-3">
            期限が変わるタスク（{impact.deadlineProposals.length}件）
          </h4>
          <p className="mb-2 text-[11.5px] leading-relaxed text-ink-3">
            動いた営業日数だけ後ろ／前へ動かす提案です。必要なものだけ選んでください。
          </p>
          <ul className="flex flex-col gap-1.5">
            {impact.deadlineProposals.map((p) => (
              <DeadlineProposalRow
                key={p.taskId} proposal={p}
                checked={selectedDeadlines.has(p.taskId)}
                onToggle={() => toggle(selectedDeadlines, setSelectedDeadlines, p.taskId)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* 新しく発生するタスク */}
      {creatable.length > 0 && (
        <section>
          <h4 className="mb-1 text-[12px] font-bold text-ink-3">
            新しく発生するタスク（{creatable.length}件）
          </h4>
          <p className="mb-2 text-[11.5px] leading-relaxed text-ink-3">
            登録された派生ルール
            {impact.matchedRules.length > 0 && `「${impact.matchedRules.map((r) => r.name).join("・")}」`}
            により機械的に洗い出したものです。
          </p>
          <ul className="flex flex-col gap-1.5">
            {creatable.map((t) => {
              const checked = selectedTasks.has(t.id);
              return (
                <li key={t.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
                      checked ? "border-signal/50 bg-surface" : "border-line bg-surface-2 opacity-70"
                    }`}
                  >
                    <input
                      type="checkbox" checked={checked}
                      onChange={() => toggle(selectedTasks, setSelectedTasks, t.id)}
                      className="mt-0.5 h-4 w-4 accent-[#1d5a78]"
                      aria-label={`${t.title} を作成する`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-snug">{t.title}</span>
                      {t.description && (
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-3">{t.description}</span>
                      )}
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {t.impactLayer && (
                          <Badge tone={IMPACT_TONE[t.impactLayer]}>{IMPACT_LABEL[t.impactLayer]}</Badge>
                        )}
                        {t.dueAt && <Badge tone="neutral">期限 {fmtDate(t.dueAt)}</Badge>}
                        {t.dependsOn.length > 0 && <Badge tone="neutral">先行 {t.dependsOn.length}件</Badge>}
                        <Badge tone="signal">提案中</Badge>
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {already > 0 && (
        <p className="rounded-lg border border-ok/40 bg-ok-soft px-3.5 py-2.5 text-[12.5px] text-ok">
          この変更による派生タスク {already} 件は作成済みです。重複しては作られません。
        </p>
      )}

      {/* 影響が出せない場合は、正直にそう言う */}
      {impact.isEmpty && (
        <p className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          {target.kind === "run-deadline"
            ? "この業務には期限を持つ未完了タスクがまだ無いため、動かす対象はありません。業務の期限だけを更新します。"
            : impact.matchedRules.length === 0
              ? "この変更に対応する派生ルールは登録されていないため、自動で洗い出せる影響はありません。変更履歴としてのみ記録します。"
              : "この変更によって期限が動くタスクはありませんでした。変更履歴としてのみ記録します。"}
        </p>
      )}

      {impact.cycle && (
        <p className="rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
          依存関係に循環があります：{impact.cycle.join(" → ")}
        </p>
      )}

      {/* 確認ゲート */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button size="lg" onClick={onConfirm}>変更を確定</Button>
        <Button variant="secondary" onClick={onCancel}>今は確定しない</Button>
        <Button variant="ghost" onClick={onBack}>入力へ戻る</Button>
        <span className="text-[11.5px] text-ink-3">
          {nothingChosen
            ? "変更履歴だけが記録されます"
            : `タスク作成 ${chosenTasks}件・期限変更 ${chosenDeadlines}件を反映します`}
        </span>
      </div>
    </div>
  );
}

// --- 確定後のまとめ ----------------------------------------------------------
function AppliedSummary({
  applied, onAgain, onClose,
}: {
  applied: Applied;
  onAgain: () => void;
  onClose: () => void;
}) {
  const total =
    applied.createdTasks.length + applied.updatedDeadlines.length + (applied.runDeadline ? 1 : 0);
  return (
    <Card className="mt-4 border-ok/40">
      <header className="border-b border-line bg-ok-soft px-5 py-3">
        <p className="text-[11px] font-bold tracking-wide text-ok">変更を確定しました</p>
        <p className="mt-0.5 text-[14px] font-bold">{applied.changeLabel}</p>
        <p className="mt-1 text-[12px] text-ink-2">
          影響 {total} 件
          （{applied.runDeadline && "業務の期限 1 件／"}
          タスクの期限変更 {applied.updatedDeadlines.length} 件／新しく発生したタスク {applied.createdTasks.length} 件）
        </p>
      </header>

      <div className="flex flex-col gap-4 p-5">
        {applied.runDeadline && (
          <section>
            <h4 className="mb-2 text-[12px] font-bold text-ink-3">この業務の期限</h4>
            <p className="rounded-lg border border-line bg-surface px-3.5 py-2 text-[12.5px]">
              <span className="tabular-nums text-ink-3 line-through">{fmtDate(applied.runDeadline.from)}</span>
              <span className="mx-2 text-ink-3">→</span>
              <Badge tone="brand">{fmtDate(applied.runDeadline.to)}</Badge>
            </p>
          </section>
        )}

        {applied.updatedDeadlines.length > 0 && (
          <section>
            <h4 className="mb-2 text-[12px] font-bold text-ink-3">期限が変わったタスク</h4>
            <ul className="flex flex-col gap-1">
              {applied.updatedDeadlines.map((d, i) => (
                <li key={i} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="shrink-0 tabular-nums text-ink-3 line-through">{fmtDate(d.from)}</span>
                  <span className="text-ink-3">→</span>
                  <Badge tone="brand">{fmtDate(d.to)}</Badge>
                </li>
              ))}
            </ul>
          </section>
        )}

        {applied.createdTasks.length > 0 && (
          <section>
            <h4 className="mb-2 text-[12px] font-bold text-ink-3">新しく発生したタスク</h4>
            <ul className="flex flex-col gap-1">
              {applied.createdTasks.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tasks/${t.id}`}
                    className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2 text-[12.5px] hover:border-brand hover:bg-brand-soft"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                    {t.impactLayer && <Badge tone={IMPACT_TONE[t.impactLayer]}>{IMPACT_LABEL[t.impactLayer]}</Badge>}
                    {t.dueAt && <Badge tone="neutral">{fmtDate(t.dueAt)}</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {total === 0 && (
          <p className="text-[12.5px] text-ink-2">
            変更履歴として記録しました。作成されたタスクや期限の変更はありません。
          </p>
        )}
        {total > 0 && applied.createdTasks.length === 0 && applied.updatedDeadlines.length === 0 && (
          <p className="text-[12.5px] text-ink-2">
            期限を持つ未完了タスクが無いため、動いたタスクはありません。
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <LinkButton href={`/map/impact/${applied.changeId}`} variant="secondary" size="sm">
            影響を確認
          </LinkButton>
          <LinkButton href="/tasks" variant="secondary" size="sm">タスクを見る</LinkButton>
          <Button size="sm" onClick={onClose}>業務に戻る</Button>
          <Button variant="ghost" size="sm" onClick={onAgain}>続けて別の変更を起票</Button>
        </div>
      </div>
    </Card>
  );
}
