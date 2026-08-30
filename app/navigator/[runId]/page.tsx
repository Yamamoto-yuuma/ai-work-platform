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
import { resolveNextSteps, getStep, isRunComplete } from "@/core/flow/engine";
import { describeStepActionDetail } from "@/core/context/step-action";
import { StepRenderer } from "@/ui/step-renderers";
import { ContextPanel } from "@/ui/context-panel";
import { Badge, Button, Card, LinkButton } from "@/ui/primitives";
import { getComponentSpec } from "@/components-registry/registry";
import { generateStepTasks } from "@/core/task/from-step";
import { RunCompletion } from "@/ui/run-completion";
import { ChangeRequestPanel } from "@/ui/change-request";
import { CancelRunPanel, CanceledRunNotice } from "@/ui/cancel-run";
import { WaitRunPanel, WaitingRunNotice } from "@/ui/wait-run";
import type { StepRunStatus } from "@/core/model/types";
import { runLabel, subjectOf } from "@/core/model/run-label";
import { catForStep } from "@/core/cat/message";
import { CatSays } from "@/ui/cat";
import { remainingLabel } from "@/core/context/resolver";

const STATUS_MARK: Record<StepRunStatus, { mark: string; cls: string }> = {
  done: { mark: "✓", cls: "border-ok bg-ok text-white" },
  active: { mark: "→", cls: "border-brand bg-brand text-white" },
  pending: { mark: "○", cls: "border-line bg-surface text-ink-3" },
  skipped: { mark: "–", cls: "border-line bg-surface-2 text-ink-3" },
  blocked: { mark: "⛔", cls: "border-danger bg-danger-soft text-danger" },
};

export default function NavigatorPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const { state, dispatch, users, currentUser } = useStore();
  const now = useNow();
  const view = useRunView(runId);

  // 表示中のSTEP（現在STEPが複数ある場合は切り替えられる）
  const [selected, setSelected] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  // 変更起票パネルの開閉。開いていても現在STEPの操作は妨げない
  const [changeOpen, setChangeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [waitOpen, setWaitOpen] = useState(false);

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
  const isCanceled = run.status === "canceled";
  const isWaiting = run.status === "paused";
  // 終わった業務（完了・中止）はSTEPを進められない。変更起票だけは引き続きできる
  const isFinished = isDone || isCanceled;
  // 待ち中もSTEPは進められないが、終わってはいない
  const isStopped = isFinished || isWaiting;
  // 進捗は業務の現在地。過去のSTEPを開いて眺めても動かさない（仕様 §6-2）
  const position = view.progress;
  // 表示中のSTEPが現在地と違うとき、それを明示する
  const viewingPast = Boolean(activeKey) && !run.currentStepKeys.includes(activeKey!);
  const assignee = users.find((u) => u.id === run.assigneeId);
  const changeCount = state.changeEvents.filter((c) => c.runId === run.id).length;

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
            <h1 className="text-[22px] font-bold tracking-tight">{runLabel(run)}</h1>
            {/* 対象を持たない業務では見出しが業務名なので繰り返さない */}
            {subjectOf(run) && <p className="mt-0.5 text-[13px] text-ink-2">{def.name}</p>}
          </div>
          <div className="flex items-center gap-3">
            {isCanceled && <Badge tone="neutral">中止</Badge>}
            {isDone && <Badge tone="ok">完了</Badge>}
            {isWaiting && <Badge tone="signal">待ち中</Badge>}
            <span className="text-[12.5px] text-ink-2">
              担当：{assignee ? assignee.name : "未割当"}
              {assignee && assignee.id === currentUser.id && (
                <span className="ml-1 text-[11px] font-bold text-brand">（自分）</span>
              )}
            </span>
            {run.dueAt && (() => {
              // 終わった業務を「超過」と呼ばない。超過判定は進行中の業務だけ
              const overdue = !isFinished && new Date(run.dueAt) < now;
              return (
                <Badge tone={overdue ? "danger" : "brand"}>
                  期限 {new Date(run.dueAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                  {/* 業務全体の期限はここが唯一の表示。残りもここで示す */}
                  {!isFinished && `（${remainingLabel(new Date(run.dueAt), now)}）`}
                </Badge>
              );
            })()}
            <span className="text-[13px] font-medium tabular-nums">
              STEP {position.index} / {position.total}
            </span>
            <LinkButton href={`/map/${run.id}`} variant="secondary" size="sm">業務マップ</LinkButton>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${position.total === 0 ? 0 : (position.done / position.total) * 100}%` }} />
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
                      {st === "active" && !isCurrent && !isStopped && (
                        <span className="text-[11px] text-brand">
                          {run.currentStepKeys.length > 1 ? "並行して進行中" : "現在のSTEP"}
                        </span>
                      )}
                      {st === "active" && isStopped && (
                        <span className="text-[11px] text-ink-3">
                          {isCanceled ? "中止時点で未完了"
                            : isWaiting ? "ここで待ち中"
                            : "未完了のまま完了"}
                        </span>
                      )}
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
          {isWaiting ? (
            <>
              <WaitingRunNotice run={run} />
              {changeOpen && (
                <ChangeRequestPanel run={run} def={def} onClose={() => setChangeOpen(false)} />
              )}
            </>
          ) : isCanceled ? (
            <>
              <CanceledRunNotice run={run} />
              {changeOpen && (
                <ChangeRequestPanel run={run} def={def} onClose={() => setChangeOpen(false)} />
              )}
            </>
          ) : isDone ? (
            <>
              <RunCompletion run={run} def={def} view={view} />
              {changeOpen && (
                <ChangeRequestPanel run={run} def={def} onClose={() => setChangeOpen(false)} />
              )}
            </>
          ) : stepView ? (
            <>
              <Card className="overflow-hidden">
                <div className="border-b border-line bg-surface-2 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{spec?.icon} {spec?.label}</Badge>
                    {statusOf(stepView.step.key) === "done" && <Badge tone="ok">完了済み（再編集中）</Badge>}
                    {viewingPast && (
                      <span className="text-[11.5px] text-ink-3">
                        表示中：STEP {ordered.filter((s) => s.componentType !== "branch").findIndex((s) => s.key === stepView.step.key) + 1}
                        （この業務の現在地は STEP {position.index} です）
                      </span>
                    )}
                  </div>
                  <h2 className="mt-2 text-[17px] font-bold tracking-tight">{stepView.step.title}</h2>
                  {stepView.step.guidance && (
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{stepView.step.guidance}</p>
                  )}
                  {stepView.step.preconditions && (
                    <p className="mt-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-[12px] leading-relaxed text-ink-2">
                      前提：{stepView.step.preconditions}
                    </p>
                  )}
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

              {changeOpen && (
                <ChangeRequestPanel run={run} def={def} onClose={() => setChangeOpen(false)} />
              )}
              {waitOpen && (
                <WaitRunPanel run={run} def={def} onClose={() => setWaitOpen(false)} />
              )}
              {cancelOpen && (
                <CancelRunPanel run={run} def={def} onClose={() => setCancelOpen(false)} />
              )}

              {/* 次にやること帯 */}
              <div className={`mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-brand/30 bg-brand-soft px-5 py-4 shadow-sm ${
                changeOpen ? "relative" : "sticky bottom-4"
              }`}>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold tracking-wide text-brand">次にやること</p>
                  {(() => {
                    const action = describeStepActionDetail(
                      stepView.effective, stepView.stepRun, stepView.completion,
                    );
                    return (
                      <>
                        <p className="mt-0.5 text-[14px] font-bold leading-snug text-brand-ink">
                          {action.text}
                        </p>
                        {action.ruleItems.length > 0 && (
                          <p className="mt-1 text-[11.5px] text-signal">
                            ＋一時ルールによる確認 {action.ruleItems.length}件
                            （{action.ruleItems.map((m) => m.label).join("・")}）
                          </p>
                        )}
                      </>
                    );
                  })()}
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
              {/*
                足りない項目の件数はここに書かない。猫が1回だけ言う（仕様 §29-1）。
                何が足りないかは、上のSTEP本体の未チェック項目そのものが示している。
              */}
              {/*
                案内役の一言（仕様 §29）。STEP本体の下、これまで空いていた場所に置く。
                判断はしない。いまどうなっているかを1〜2行で言い換えるだけ。
              */}
              <CatSays
                className="mt-4"
                message={catForStep({
                  def, run, step: stepView.step, stepRuns: view.stepRuns, scope: view.scope,
                  missingToComplete: stepView.completion.missing,
                  now,
                })}
              />
            </>
          ) : (
            <Card className="p-8 text-center text-[13px] text-ink-2">着手できるSTEPがありません。</Card>
          )}
        </div>

        {stepView && !isStopped ? (
          <ContextPanel
            ctx={stepView.context}
            onRequestChange={() => setChangeOpen(true)}
            onWaitRun={() => setWaitOpen(true)}
            onCancelRun={() => setCancelOpen(true)}
            historyHref={`/map/${run.id}`}
            historyCount={changeCount}
          />
        ) : (
          /*
            終わった業務（完了・中止）にはSTEPの情報は無い。
            それでも後から変更は起きるので、変更起票の入口だけは残す（仕様 §10-3）。
          */
          <aside className="w-full shrink-0 lg:w-[312px]">
            <div className="sticky top-4 overflow-hidden rounded-xl border border-line bg-surface p-4">
              <p className="text-[12px] font-bold">
                {isCanceled ? "この業務は中止されています"
                  : isWaiting ? "この業務は待ち中です"
                  : "この業務は完了しています"}
              </p>
              <p className="mt-1 mb-2.5 text-[11.5px] leading-relaxed text-ink-3">
                {isWaiting
                  ? "確認するまでSTEPは進みません。中央で「作業を再開する」か「まだ待つ」を選べます。"
                  : "STEPの実行はできませんが、後から変更が起きた場合は起票して影響を確認できます。"}
              </p>
              <Button variant="secondary" size="sm" onClick={() => setChangeOpen(true)}>変更を起票</Button>
              {changeCount > 0 && (
                <Link href={`/map/${run.id}`} className="mt-2 block text-[11.5px] text-brand hover:underline">
                  この業務の変更履歴（{changeCount}件）→
                </Link>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
