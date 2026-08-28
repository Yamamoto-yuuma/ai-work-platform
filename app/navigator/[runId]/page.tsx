"use client";

/**
 * 業務ナビゲーター（仕様 §6）。本プロダクトの中心画面。
 * 左：STEPレール／中央：現在STEPの部品UI（最も目立たせる）／右：コンテキストパネル
 * 下部：「次にやること」1文＋主要CTA
 */
import { use, useState } from "react";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useRunView, useStepView, useNextStepPreview, useNow } from "@/ui/use-navigator";
import { resolveNextSteps, getStep, isRunComplete, stepPosition } from "@/core/flow/engine";
import { describeStepAction } from "@/core/context/step-action";
import { StepRenderer } from "@/ui/step-renderers";
import { ContextPanel } from "@/ui/context-panel";
import { Badge, Button, Card, LinkButton } from "@/ui/primitives";
import { getComponentSpec } from "@/components-registry/registry";
import { generateStepTasks } from "@/core/task/from-step";
import { RunCompletion } from "@/ui/run-completion";
import type { StepRunStatus } from "@/core/model/types";

const STATUS_MARK: Record<StepRunStatus, { mark: string; cls: string }> = {
  done: { mark: "✓", cls: "border-ok bg-ok text-white" },
  active: { mark: "→", cls: "border-brand bg-brand text-white" },
  pending: { mark: "○", cls: "border-line bg-surface text-ink-3" },
  skipped: { mark: "–", cls: "border-line bg-surface-2 text-ink-3" },
  blocked: { mark: "⛔", cls: "border-danger bg-danger-soft text-danger" },
};

export default function NavigatorPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const { dispatch, users, currentUser } = useStore();
  const now = useNow();
  const view = useRunView(runId);

  // 表示中のSTEP（現在STEPが複数ある場合は切り替えられる）
  const [selected, setSelected] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);

  const activeKey = selected ?? view?.run.currentStepKeys[0] ?? null;
  const stepView = useStepView(view, activeKey ?? undefined);
  const preview = useNextStepPreview(view, activeKey ?? undefined);

  if (!view) {
    return (
      <div className="p-8">
        <p className="text-[13px] text-ink-2">業務が見つかりません。</p>
        <LinkButton href="/" variant="secondary">HOMEへ戻る</LinkButton>
      </div>
    );
  }

  const { run, def, ordered, statusOf } = view;
  const isDone = run.status === "done";
  // 進捗は「実行予定のSTEP」を母数にする（分岐ノード・スキップ済みを除く／仕様 §6-2）
  const position = stepPosition(def, view.stepRuns, isDone ? null : activeKey);
  const assignee = users.find((u) => u.id === run.assigneeId);

  function complete() {
    if (!stepView || !activeKey || !view) return;
    if (!stepView.completion.canComplete) {
      setShowMissing(true);
      return;
    }
    const contextPatch = { ...stepView.stepRun.output };
    const nextScope = {
      ...view.scope,
      context: { ...run.context, ...contextPatch },
    };
    const { activate, skipped } = resolveNextSteps(def, activeKey, view.stepRuns, nextScope);

    // 分岐STEPは自動的に通過させる
    const finalActivate: string[] = [];
    const finalSkipped = [...skipped];
    const queue = [...activate];
    while (queue.length > 0) {
      const key = queue.shift()!;
      const step = getStep(def, key);
      if (step?.componentType === "branch") {
        const r = resolveNextSteps(def, key, view.stepRuns, nextScope);
        queue.push(...r.activate);
        finalSkipped.push(...r.skipped);
      } else {
        finalActivate.push(key);
      }
    }

    const remaining = view.stepRuns.filter(
      (sr) => sr.stepKey !== activeKey && sr.status === "active",
    );
    const willBeDone =
      finalActivate.length === 0 && remaining.length === 0 &&
      isRunComplete(def, view.stepRuns.map((sr) => sr.stepKey === activeKey ? { ...sr, status: "done" as const } : sr));

    dispatch({
      type: "advanceStep", runId: run.id, stepKey: activeKey,
      nextKeys: finalActivate, skipped: Array.from(new Set(finalSkipped)),
      output: stepView.stepRun.output, checklist: stepView.stepRun.checklistState,
      appliedRuleIds: stepView.rules.map((r) => r.id),
      contextPatch, runDone: willBeDone,
    });

    // STEP の定義に沿って実際のタスクを作る。ID は決定的なので再完了しても重複しない
    const generated = generateStepTasks({
      step: stepView.step, stepRun: stepView.stepRun, run, now,
    });
    if (generated.length > 0) dispatch({ type: "addTasks", tasks: generated });

    setShowMissing(false);
    setSelected(finalActivate[0] ?? null);
  }

  const spec = stepView ? getComponentSpec(stepView.step.componentType) : null;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      {/* 業務ヘッダー：対象・業務名・進捗・期限 */}
      <header className="mb-5">
        <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-3">
          <Link href="/workflows" className="hover:text-brand">業務</Link>
          <span>/</span>
          <Link href={`/workflows/${def.key}`} className="hover:text-brand">{def.name}</Link>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">{run.subject.label}</h1>
            <p className="mt-0.5 text-[13px] text-ink-2">{def.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12.5px] text-ink-2">
              担当：{assignee ? assignee.name : "未割当"}
              {assignee && assignee.id === currentUser.id && (
                <span className="ml-1 text-[11px] font-bold text-brand">（自分）</span>
              )}
            </span>
            {run.dueAt && (
              <Badge tone={new Date(run.dueAt) < now ? "danger" : "brand"}>
                期限 {new Date(run.dueAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                {new Date(run.dueAt) < now && "（超過）"}
              </Badge>
            )}
            <span className="text-[13px] font-medium tabular-nums">
              STEP {position.index} / {position.total}
            </span>
            <LinkButton href={`/map/${run.id}`} variant="secondary" size="sm">業務マップ</LinkButton>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${position.total === 0 ? 0 : ((isDone ? position.total : position.index - 1) / position.total) * 100}%` }} />
        </div>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* STEPレール */}
        <div className="w-full shrink-0 lg:w-[236px]">
          <ol className="flex flex-col gap-0.5">
            {ordered.filter((s) => s.componentType !== "branch").map((s) => {
              const st = statusOf(s.key);
              const isCurrent = s.key === activeKey;
              const m = STATUS_MARK[st];
              return (
                <li key={s.key} className="relative">
                  <button
                    onClick={() => (st !== "pending" ? setSelected(s.key) : undefined)}
                    disabled={st === "pending"}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${
                      isCurrent ? "bg-brand-soft" : st === "pending" ? "cursor-default" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${m.cls}`}>
                      {m.mark}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] leading-snug ${isCurrent ? "font-bold text-brand-ink" : st === "done" ? "text-ink-3" : "font-medium"}`}>
                        {s.title}
                      </span>
                      {st === "skipped" && <span className="text-[11px] text-ink-3">条件によりスキップ</span>}
                      {st === "active" && !isCurrent && <span className="text-[11px] text-brand">並行して進行中</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {run.currentStepKeys.length > 1 && (
            <p className="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-[11.5px] leading-relaxed text-brand-ink">
              このフローは {run.currentStepKeys.length} 件のSTEPが並行して進行中です。両方が完了すると次に進みます。
            </p>
          )}
        </div>

        {/* 現在STEP（画面内で最大面積・最高コントラスト） */}
        <div className="min-w-0 flex-1">
          {isDone ? (
            <RunCompletion run={run} def={def} view={view} />
          ) : stepView ? (
            <>
              <Card className="overflow-hidden">
                <div className="border-b border-line bg-surface-2 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{spec?.icon} {spec?.label}</Badge>
                    {statusOf(stepView.step.key) === "done" && <Badge tone="ok">完了済み（再編集中）</Badge>}
                  </div>
                  <h2 className="mt-2 text-[17px] font-bold tracking-tight">{stepView.step.title}</h2>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{stepView.step.guidance}</p>
                  {stepView.context.stepDeadline && (
                    <p className={`mt-1.5 text-[12.5px] font-medium ${stepView.context.stepDeadline.isOverdue ? "text-danger" : "text-ink-2"}`}>
                      このSTEPの期限：
                      {new Date(stepView.context.stepDeadline.dueAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                      （{stepView.context.stepDeadline.remainingLabel}）
                    </p>
                  )}
                </div>
                <div className="p-5">
                  <StepRenderer
                    step={stepView.effective}
                    stepRun={stepView.stepRun}
                    run={run}
                    onOutput={(patch) => dispatch({ type: "setStepDraft", runId: run.id, stepKey: stepView.step.key, output: patch })}
                    onCheck={(patch) => dispatch({ type: "setStepDraft", runId: run.id, stepKey: stepView.step.key, checklist: patch })}
                  />
                </div>
              </Card>

              {/* 完了できない理由を具体的に示す（仕様 §27-3） */}
              {showMissing && !stepView.completion.canComplete && (
                <div className="mt-4 rounded-xl border border-danger/40 bg-danger-soft p-4">
                  <p className="mb-2 text-[13px] font-bold text-danger">このSTEPを完了できません</p>
                  <ul className="flex flex-col gap-1">
                    {stepView.completion.missing.map((m) => (
                      <li key={m.key} className="text-[12.5px] text-danger">・「{m.label}」が{m.reason}です</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 分岐の予告：次にどこへ進むかを事前に示す */}
              {preview.branches.length > 1 && (
                <Card className="mt-4 p-4">
                  <h3 className="mb-2 text-[12px] font-bold text-ink-3">このSTEPの後の分岐</h3>
                  <ul className="flex flex-col gap-1.5">
                    {preview.branches.map((b, i) => {
                      const target = getStep(def, b.to);
                      return (
                        <li key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] ${b.willTake ? "bg-brand-soft text-brand-ink" : "bg-surface-2 text-ink-3"}`}>
                          <span className="font-medium">{b.willTake ? "→ 進む" : "　条件外"}</span>
                          <span>{target?.title ?? b.to}</span>
                          {b.label && <span className="ml-auto text-[11.5px]">{b.label}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              )}

              {/* 次にやること帯 */}
              <div className="sticky bottom-4 mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-brand/30 bg-brand-soft px-5 py-4 shadow-sm">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold tracking-wide text-brand">次にやること</p>
                  <p className="mt-0.5 text-[14px] font-bold leading-snug text-brand-ink">
                    {describeStepAction(stepView.effective, stepView.stepRun, stepView.completion)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {statusOf(stepView.step.key) === "done" ? (
                    <Button variant="secondary" onClick={() => dispatch({ type: "reopenStep", runId: run.id, stepKey: stepView.step.key })}>
                      このSTEPをやり直す
                    </Button>
                  ) : (
                    <Button size="lg" onClick={complete} disabled={!stepView.completion.canComplete}>
                      完了して次へ →
                    </Button>
                  )}
                </div>
              </div>
              {!stepView.completion.canComplete && (
                <p className="mt-2 text-right text-[12px] text-ink-3">
                  未完了の項目が {stepView.completion.missing.length} 件あります
                </p>
              )}
            </>
          ) : (
            <Card className="p-8 text-center text-[13px] text-ink-2">着手できるSTEPがありません。</Card>
          )}
        </div>

        {stepView && <ContextPanel ctx={stepView.context} />}
      </div>
    </div>
  );
}
