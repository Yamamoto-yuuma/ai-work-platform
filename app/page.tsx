"use client";

/**
 * HOME（仕様 §25-3）。
 * 「今日何をすればよいか」がスクロールせずに分かること。
 * リストを並べるのではなく、NextActionResolver の出力を最上部に出す。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/adapters/memory/store";
import { useNextAction, useNow, useStartableToday, useWorkflows } from "@/ui/use-navigator";
import { Badge, Button, Card, LinkButton, SectionTitle, Empty } from "@/ui/primitives";
import { remainingLabel } from "@/core/context/resolver";
import { runProgress } from "@/core/flow/engine";
import { buildRun } from "@/services/start-run";
import { describeStartTrigger } from "@/core/workflow/start-trigger";
import { runLabel, subjectOf } from "@/core/model/run-label";
import { checkStatusOf } from "@/ui/wait-run";
import type { WorkflowDefinition } from "@/core/model/types";

function fmt(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
}

export default function HomePage() {
  const router = useRouter();
  const { state, dispatch, workflows, customers, currentUser } = useStore();
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

  // ① いま着手すること（1件）
  const first = ranked[0];
  // ② 続けて着手できること。確認は③に集約するのでここには出さない
  const upNext = ranked
    .slice(1)
    .filter((a) => a.kind !== "check")
    .slice(0, 3);
  // ③ 今日確認する。①に出ているものは重ねない
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
    <div className="mx-auto max-w-[1180px] px-6 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] text-ink-3">
            {now.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
          </p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight">{currentUser.name} さんの今日</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href="/workflows/new" variant="secondary">＋ 業務を登録</LinkButton>
          <LinkButton href="/workflows">＋ 新しい業務を開始</LinkButton>
        </div>
      </header>

      {/* 最上部：今やるべき唯一のこと */}
      <Link href={nextHref} className="mb-5 block">
        <div className={`rounded-xl border p-5 transition-colors ${
          next.urgency === "overdue" ? "border-danger/40 bg-danger-soft hover:border-danger"
          : "border-brand/30 bg-brand-soft hover:border-brand"
        }`}>
          <div className="mb-2 flex items-center gap-2">
            <span className={`text-[11px] font-bold tracking-wide ${next.urgency === "overdue" ? "text-danger" : "text-brand"}`}>
              いま着手すること
            </span>
            {next.urgency === "overdue" && <Badge tone="danger">期限超過</Badge>}
            {next.urgency === "today" && <Badge tone="signal">今日まで</Badge>}
          </div>
          <p className={`text-[19px] font-bold leading-snug ${next.urgency === "overdue" ? "text-danger" : "text-brand-ink"}`}>
            {next.headline}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12.5px] text-ink-2">
            <span>{next.reason}</span>
            {next.dueAt && (
              <span>{next.kind === "check" ? "確認予定日" : "期限"} {fmt(next.dueAt)}</span>
            )}
          </div>
        </div>
      </Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          {/* 今日確認する：待ちの確認日が来たもの。作業ではなく判断 */}
          {dueChecks.length > 0 && (
            <section>
              <SectionTitle>今日確認する（{dueChecks.length}）</SectionTitle>
              <ul className="flex flex-col gap-1.5">
                {dueChecks.map(({ run, reason }) => {
                  const st = checkStatusOf(run.waitingUntil, now);
                  return (
                    <li key={run.id}>
                      <Link
                        href={`/navigator/${run.id}`}
                        className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                          st.overdue
                            ? "border-danger/40 bg-danger-soft hover:border-danger"
                            : "border-signal/40 bg-signal-soft hover:border-signal"
                        }`}
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
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* 今日開始する業務：開始条件が来ているもの。開始するかは自分が決める */}
          {startable.length > 0 && (
            <section>
              <SectionTitle>今日開始する業務（{startable.length}）</SectionTitle>
              <ul className="flex flex-col gap-1.5">
                {startable.map((def) => (
                  <li
                    key={def.key}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <Link href={`/workflows/${def.key}`} className="block truncate text-[13px] font-medium hover:text-brand">
                        {def.name}
                      </Link>
                      <span className="mt-0.5 block text-[11.5px] text-ink-3">
                        {describeStartTrigger(def.startTrigger)}
                      </span>
                    </span>
                    <Button size="sm" onClick={() => startWorkflow(def)}>開始する</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 続けて着手できるもの */}
          <section>
            <SectionTitle action={<Link href="/tasks" className="text-[12px] text-brand hover:underline">すべてのタスク</Link>}>
              続けて着手できること
            </SectionTitle>
            {upNext.length === 0 ? (
              publishedCount === 0 ? (
                <Card className="border-dashed p-5 text-center">
                  <p className="text-[13px] font-bold">まだ業務が登録されていません</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                    自分の業務を登録すると、ここに「次にやること」が並びます。
                  </p>
                  <div className="mt-3 flex justify-center">
                    <LinkButton href="/workflows/new" size="sm">＋ 業務を登録</LinkButton>
                  </div>
                </Card>
              ) : (
                <Empty>他に着手できる作業はありません</Empty>
              )
            ) : (
              <ul className="flex flex-col gap-1.5">
                {upNext.map((a, i) => (
                  <li key={i}>
                    <Link
                      href={a.runId && (a.kind === "step" || a.kind === "check") ? `/navigator/${a.runId}` : a.taskId ? `/tasks/${a.taskId}` : "/tasks"}
                      className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 hover:border-brand"
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
                  </li>
                ))}
              </ul>
            )}
          </section>

        </div>

        {/* 右カラム */}
        <div className="flex flex-col gap-5">
          {proposed.length > 0 && (
            <Card className="border-signal/40 bg-signal-soft p-4">
              <p className="text-[12px] font-bold text-signal">未確認の派生タスク</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                変更によって {proposed.length} 件のタスクが提案されています。確認して確定してください。
              </p>
              <LinkButton href="/tasks?view=proposed" size="sm" variant="secondary">内容を確認する</LinkButton>
            </Card>
          )}

          {waiting.length > 0 && (
            <Card className="p-4">
              <p className="text-[12px] font-bold text-ink-3">待ち中（{waiting.length}）</p>
              <ul className="mt-2 flex flex-col gap-1.5">
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
            </Card>
          )}

          {/*
            抱えている業務。ここは「今やること」ではなく状態確認。
            着手候補（左カラム）と見た目を明確に分けるため、
            カードではなく淡い行で並べる。
          */}
          {activeRuns.length > 0 && (
            <Card className="p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-[12px] font-bold text-ink-3">抱えている業務（{activeRuns.length}）</p>
                <Link href="/workflows" className="text-[11.5px] text-brand hover:underline">すべての業務</Link>
              </div>
              <ul className="flex flex-col gap-1.5">
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
                          <span className="mt-0.5 block text-[10.5px] text-brand">今日の着手候補に出ています</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}
