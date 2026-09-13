"use client";

/**
 * HOME（仕様 §25-3）。
 * 「今日何をすればよいか」がスクロールせずに分かること。
 * リストを並べるのではなく、NextActionResolver の出力を最上部に出す。
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/adapters/memory/store";
import { useNextAction, useNow, useStartableToday, useWorkflows } from "@/ui/use-navigator";
import { Badge, Button, Card, LinkButton, Panel, Row, RowList, TopBar } from "@/ui/primitives";
import { TaskMemoPanel } from "@/ui/task-memo-panel";
import { TodayTimeline } from "@/ui/today-timeline";
import { remainingLabel } from "@/core/context/resolver";
import { runProgress } from "@/core/flow/engine";
import { buildRun } from "@/services/start-run";
import { describeStart } from "@/core/workflow/start-trigger";
import { runLabel, subjectOf } from "@/core/model/run-label";
import { catForHome } from "@/core/cat/message";
import { CatSays } from "@/ui/cat";
import { checkStatusOf } from "@/ui/wait-run";
import type { WorkflowDefinition } from "@/core/model/types";

function fmt(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
}

export default function HomePage() {
  const router = useRouter();
  const { state, dispatch, workflows, customers, currentUser } = useStore();
  /* タスクメモの開閉。本文の幅を変えるので、パネルではなくここで持つ */
  const [memoOpen, setMemoOpen] = useState(false);
  const { next, ranked, waiting } = useNextAction();
  const now = useNow();
  // 開始条件が来ている業務。勝手には始めず、ここに出して自分が決める
  const startable = useStartableToday();
  const publishedCount = useWorkflows().length;

  function startWorkflow(def: WorkflowDefinition) {
    const { run, stepRuns } = buildRun({
      def, customers, assigneeId: currentUser.id, now,
    });
    dispatch({ type: "startRun", run, stepRuns });
    router.push(`/navigator/${run.id}`);
  }

  /**
   * 行動候補は rankActions の出力だけを源にする。
   * tasks / runs から別のリストを組み直すと、同じ仕事が複数セクションに出てしまう。
   */
  const keyOf = (a: { kind: string; runId?: string; taskId?: string; stepKey?: string }) =>
    a.taskId ?? (a.runId ? `${a.runId}:${a.stepKey ?? a.kind}` : a.kind);

  // ① 最優先（1件）
  const first = ranked[0];
  // ② 次の候補。確認は③に集約するのでここには出さない
  const upNext = ranked
    .slice(1)
    .filter((a) => a.kind !== "check")
    .slice(0, 3);
  // ③ 要確認。①に出ているものは重ねない
  const shownKeys = new Set([first, ...upNext].filter(Boolean).map((a) => keyOf(a!)));
  const dueChecks = waiting
    .filter((w) => w.dueForCheck)
    .filter((w) => !shownKeys.has(`${w.run.id}:check`));

  // --- ここから下は「状態確認」。行動候補ではない ---
  const activeRuns = state.runs.filter((r) => r.status === "active" && r.assigneeId === currentUser.id);
  // 派生タスクの確認は①②に出ていればそちらに任せる
  const proposed = shownKeys.has("review-proposals")
    ? []
    : state.tasks.filter((t) => t.confirmationState === "proposed");

  const nextHref =
    (next.kind === "step" || next.kind === "check") && next.runId ? `/navigator/${next.runId}`
    : next.kind === "review-proposals" ? "/tasks?view=proposed"
    : next.kind === "task" && next.taskId ? `/tasks/${next.taskId}`
    : "/workflows";

  return (
    <div
      className={`mx-auto max-w-[1180px] px-6 pb-8 transition-[padding] duration-200 ${
        memoOpen ? "xl:pr-[calc(var(--memo-w)+1.5rem)]" : ""
      }`}
    >
      {/*
        タスク化前メモ。既定では開いたままにする（毎日いちばん使うため）。
        広い画面では横に並べて置き、HOME を覆わない。畳めば元の幅に戻る。
        HOME の中身そのものには手を入れていない。使える幅が狭くなるだけで、
        窓を小さくしたときと同じ並び方をする。
      */}
      <TaskMemoPanel now={now} open={memoOpen} onOpenChange={setMemoOpen} />
      {/*
        自分ひとりで使うものなので、自分の名前は出さない。
        右上に入口は置かない。毎日通る場所に「作る側」の入口が並んでいると、
        今日やることを見に来たのに手が止まる。業務を始めるのは左のレーンの
        「業務」から、登録は業務が 0 件のときに下の「次の候補」から案内する。
      */}
      <TopBar
        title="本日の作業"
        description={now.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
      />

      {/* 最上部：今やるべき唯一のこと */}
      <Link href={nextHref} className="mb-5 block">
        {/*
          今日いちばん先に触るもの。
          面は白のままにするが、左に太い線を1本入れて、他の塊と見分けが
          つくようにする。面を塗ると、画面のほとんどが色になってしまう。
          線の色は急ぎかどうかで変える。ここだけは色で示してよい。
        */}
        <div className={`rounded-xl border border-line-soft border-l-[3px] bg-surface p-6 shadow-card transition-shadow duration-150 hover:shadow-lift ${
          next.urgency === "overdue" ? "border-l-danger" : "border-l-brand"
        }`}>
          <div className="mb-2 flex items-center gap-2">
            <span className={`text-[11px] font-bold tracking-wide ${next.urgency === "overdue" ? "text-danger" : "text-brand"}`}>
              最優先
            </span>
            {next.urgency === "overdue" && <Badge tone="danger">期限超過</Badge>}
            {next.urgency === "today" && <Badge tone="signal">今日まで</Badge>}
          </div>
          <p className={`text-[19px] font-bold leading-snug ${next.urgency === "overdue" ? "text-danger" : "text-brand-ink"}`}>
            {next.headline}
          </p>
          {/*
            理由は猫が1回だけ言う（仕様 §29-1）。ここに同じ文を置くと二重になる。
            期限そのものは事実なので残す。
          */}
          {next.dueAt && (
            <div className="mt-2 text-[12.5px] text-ink-2">
              {next.kind === "check" ? "確認予定日" : "期限"} {fmt(next.dueAt)}
            </div>
          )}
        </div>
      </Link>

      {/*
        案内役の一言（仕様 §29）。順位を決めるのは NextActionResolver で、
        猫はその結果が「なぜ上に来ているか」を言い換えるだけ。
        カードの外に小さく置き、最初の3秒の情報量を増やさない。
      */}
      <CatSays
        className="-mt-3 mb-5 px-1"
        message={catForHome({ next, now })}
      />

      {/*
        今日の並び。「今日いちばん先にやること」の次に「今日はこういう1日」を置く。
        期限だけでは、それが今日に入るのかが分からない。
        カレンダーが未連携のときは何も出さない（毎日出る警告にしない）。
      */}
      <div className="mb-5">
        <TodayTimeline now={now} />
      </div>

      {/*
        1 列のときも minmax(0,1fr) で押さえる。既定のままだと列が中身の幅まで広がり、
        折り返せない予定名や案件名が入った日にだけ、画面が横へずれる。
      */}
      <div className="grid gap-5 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          {/* 要確認：待ちの確認日が来たもの。作業ではなく判断 */}
          {dueChecks.length > 0 && (
            <Panel title="要確認" count={dueChecks.length}>
              <RowList flat>
                {dueChecks.map(({ run, reason }) => {
                  const st = checkStatusOf(run.waitingUntil, now);
                  return (
                    <Row key={run.id} tone={st.overdue ? "danger" : "signal"}>
                      <Link
                        href={`/navigator/${run.id}`}
                        className="flex items-center gap-3 px-4 py-2.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{runLabel(run)}</span>
                          <span className="mt-0.5 block text-[11.5px] text-ink-2">
                            {reason} ／ 確認予定日：
                            {run.waitingUntil
                              ? new Date(run.waitingUntil).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })
                              : "—"}
                          </span>
                        </span>
                        <Badge tone={st.overdue ? "danger" : "signal"}>
                          {st.overdue ? `確認期限超過 ${st.label}` : "今日が確認予定日"}
                        </Badge>
                      </Link>
                    </Row>
                  );
                })}
              </RowList>
            </Panel>
          )}

          {/* 開始待ち：開始条件が来ているもの。開始するかは自分が決める */}
          {startable.length > 0 && (
            <Panel title="開始待ち" count={startable.length}>
              <RowList flat>
                {startable.map((def) => (
                  <Row key={def.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <Link href={`/workflows/${def.key}`} className="block truncate text-[13px] font-medium hover:text-brand">
                        {def.name}
                      </Link>
                      {/*
                        今日出ている理由。予定が複数当たっていても業務は1件なので、
                        理由だけを並べる。開始の入口は1つのまま。
                      */}
                      <span className="mt-0.5 block text-[11.5px] text-ink-3">
                        {describeStart(def).join("／")}
                      </span>
                    </span>
                    <Button size="sm" onClick={() => startWorkflow(def)}>開始する</Button>
                  </Row>
                ))}
              </RowList>
            </Panel>
          )}

          {/* 続けて着手できるもの */}
          <Panel
            title="次の候補"
            action={<Link href="/tasks" className="text-[12px] text-brand hover:underline">すべてのタスク</Link>}
          >
            {/* 囲いの中なので、空のときも入れ子の箱を作らない */}
            {upNext.length === 0 ? (
              publishedCount === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-[13px] font-bold">業務が未登録です</p>
                  <div className="mt-3 flex justify-center">
                    <LinkButton href="/workflows/new" size="sm">＋ 業務を登録</LinkButton>
                  </div>
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-[12.5px] text-ink-3">
                  他に着手できる作業はありません
                </p>
              )
            ) : (
              <RowList flat>
                {upNext.map((a, i) => (
                  <Row key={i}>
                    <Link
                      href={a.runId && (a.kind === "step" || a.kind === "check") ? `/navigator/${a.runId}` : a.taskId ? `/tasks/${a.taskId}` : "/tasks"}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{a.headline}</span>
                        <span className="mt-0.5 block text-[11.5px] text-ink-3">{a.reason}</span>
                      </span>
                      {a.dueAt && (
                        <Badge tone={a.urgency === "overdue" ? "danger" : a.urgency === "today" ? "signal" : "neutral"}>
                          {remainingLabel(new Date(a.dueAt), now)}
                        </Badge>
                      )}
                    </Link>
                  </Row>
                ))}
              </RowList>
            )}
          </Panel>

        </div>

        {/* 右カラム */}
        <div className="flex flex-col gap-5">
          {proposed.length > 0 && (
            <Card className="bg-signal-soft p-4">
              <p className="text-[12px] font-bold text-signal">未確認の派生タスク</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                変更によって {proposed.length} 件のタスクが提案されています。確認して確定してください。
              </p>
              <LinkButton href="/tasks?view=proposed" size="sm" variant="secondary">内容を確認する</LinkButton>
            </Card>
          )}

          {waiting.length > 0 && (
            <Panel title="待ち中" count={waiting.length}>
              <ul className="flex flex-col gap-1.5 p-3">
                {/*
                  ここは状態確認なので、待ち中は必ず全件出す。
                  行動候補に出ているかどうかで消さない（消えると待ちを見失う）
                */}
                {waiting.map(({ run, reason }) => {
                  const st = checkStatusOf(run.waitingUntil, now);
                  return (
                    <li key={run.id}>
                      <Link href={`/navigator/${run.id}`} className="block rounded-lg bg-surface-2 px-3 py-2 hover:bg-brand-soft">
                        <span className="block text-[12.5px] font-medium">{runLabel(run)}</span>
                        <span className="block text-[11px] text-ink-3">{reason}</span>
                        <span className={`mt-0.5 block text-[11px] ${st.overdue ? "font-bold text-danger" : "text-ink-3"}`}>
                          次回確認：
                          {run.waitingUntil
                            ? new Date(run.waitingUntil).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" })
                            : "未設定"}
                          {st.headline ? `・${st.headline}` : ""}・{st.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          {/*
            進行中の業務。ここは「今やること」ではなく状態確認。
            候補（左カラム）と見た目を明確に分けるため、
            カードではなく淡い行で並べる。
          */}
          {activeRuns.length > 0 && (
            <Panel
              title="進行中の業務" count={activeRuns.length}
              action={<Link href="/workflows" className="text-[11.5px] text-brand hover:underline">すべての業務</Link>}
            >
              <ul className="flex flex-col gap-1.5 p-3">
                {activeRuns.map((run) => {
                  const def = workflows.find((w) => w.key === run.workflowKey);
                  const p = def
                    ? runProgress(def, run, state.stepRunsByRun[run.id] ?? [])
                    : { index: 0, total: 0, done: 0 };
                  // 左（行動候補）に既に出ている業務は、その旨を添えて役割の違いを示す
                  const inCandidates = run.currentStepKeys.some((k) => shownKeys.has(`${run.id}:${k}`));
                  return (
                    <li key={run.id}>
                      <Link href={`/navigator/${run.id}`} className="block rounded-lg bg-surface-2 px-3 py-2 hover:bg-brand-soft">
                        <span className="block truncate text-[12.5px] font-medium">{runLabel(run)}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
                          {/* 対象を持たない業務では業務名が見出しと同じになるので繰り返さない */}
                          <span className="truncate">{subjectOf(run) ? def?.name : ""}</span>
                          <span className="ml-auto shrink-0 tabular-nums">STEP {p.index}/{p.total}</span>
                        </span>
                        {inCandidates && (
                          <span className="mt-0.5 block text-[10.5px] text-brand">本日の候補に表示中</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

        </div>
      </div>
    </div>
  );
}
