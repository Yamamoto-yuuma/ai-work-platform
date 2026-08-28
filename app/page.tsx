"use client";

/**
 * HOME（仕様 §25-3）。
 * 「今日何をすればよいか」がスクロールせずに分かること。
 * リストを並べるのではなく、NextActionResolver の出力を最上部に出す。
 */
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useNextAction, useActiveRules, useNow } from "@/ui/use-navigator";
import { Badge, Card, LinkButton, SectionTitle, Empty } from "@/ui/primitives";
import { remainingLabel, urgencyOf } from "@/core/context/resolver";
import { progressOf, orderedSteps } from "@/core/flow/engine";

function fmt(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
}

export default function HomePage() {
  const { state, workflows, currentUser } = useStore();
  const { next, ranked, waiting } = useNextAction();
  const { active: activeRules } = useActiveRules();
  const now = useNow();

  const activeRuns = state.runs.filter((r) => r.status === "active" && r.assigneeId === currentUser.id);
  const todayTasks = state.tasks.filter(
    (t) => t.confirmationState === "confirmed" && t.status !== "done" && t.status !== "canceled" &&
      t.assigneeId === currentUser.id && ["overdue", "today"].includes(urgencyOf(t.dueAt, now)),
  );
  const proposed = state.tasks.filter((t) => t.confirmationState === "proposed");
  const recentDone = state.runs.filter((r) => r.status === "done").slice(0, 3);

  const nextHref =
    next.kind === "step" && next.runId ? `/navigator/${next.runId}`
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
        <LinkButton href="/workflows">＋ 新しい業務を開始</LinkButton>
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
            {next.dueAt && <span>期限 {fmt(next.dueAt)}</span>}
          </div>
        </div>
      </Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          {/* 続けて着手できるもの */}
          <section>
            <SectionTitle>続けて着手できること</SectionTitle>
            {ranked.length <= 1 ? (
              <Empty>他に着手できる作業はありません</Empty>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {ranked.slice(1, 6).map((a, i) => (
                  <li key={i}>
                    <Link
                      href={a.runId && a.kind === "step" ? `/navigator/${a.runId}` : a.taskId ? `/tasks/${a.taskId}` : "/tasks"}
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

          {/* 進行中の業務 */}
          <section>
            <SectionTitle action={<Link href="/workflows" className="text-[12px] text-brand hover:underline">すべての業務</Link>}>
              進行中の業務（{activeRuns.length}）
            </SectionTitle>
            {activeRuns.length === 0 ? (
              <Empty>進行中の業務はありません</Empty>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {activeRuns.map((run) => {
                  const def = workflows.find((w) => w.key === run.workflowKey);
                  const stepRuns = state.stepRunsByRun[run.id] ?? [];
                  const p = def ? progressOf(def, stepRuns) : { done: 0, total: 1 };
                  const currentTitles = def
                    ? run.currentStepKeys.map((k) => def.steps.find((s) => s.key === k)?.title).filter(Boolean)
                    : [];
                  const overdue = run.dueAt ? new Date(run.dueAt) < now : false;
                  return (
                    <Link key={run.id} href={`/navigator/${run.id}`}>
                      <Card className="h-full p-4 transition-colors hover:border-brand">
                        <div className="mb-1.5 flex items-start justify-between gap-2">
                          <span className="text-[11px] text-ink-3">{def?.name}</span>
                          {run.dueAt && (
                            <Badge tone={overdue ? "danger" : urgencyOf(run.dueAt, now) === "today" ? "signal" : "neutral"}>
                              {remainingLabel(new Date(run.dueAt), now)}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[13.5px] font-bold leading-snug">{run.subject.label}</p>
                        <p className="mt-1.5 text-[12px] text-ink-2">
                          次：{currentTitles.join(" / ") || "—"}
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <div className="h-full rounded-full bg-brand" style={{ width: `${(p.done / p.total) * 100}%` }} />
                          </div>
                          <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{p.done}/{p.total}</span>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* 今日のタスク */}
          <section>
            <SectionTitle action={<Link href="/tasks" className="text-[12px] text-brand hover:underline">すべてのタスク</Link>}>
              今日のタスク（{todayTasks.length}）
            </SectionTitle>
            {todayTasks.length === 0 ? (
              <Empty>今日が期限のタスクはありません</Empty>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {todayTasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 hover:border-brand">
                      <span className="flex-1 text-[13px]">{t.title}</span>
                      <Badge tone={urgencyOf(t.dueAt, now) === "overdue" ? "danger" : "signal"}>
                        {t.dueAt ? remainingLabel(new Date(t.dueAt), now) : "—"}
                      </Badge>
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
              <p className="text-[12px] font-bold text-ink-3">対応待ちの業務</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {waiting.map(({ run, reason }) => (
                  <li key={run.id}>
                    <Link href={`/navigator/${run.id}`} className="block rounded-lg bg-surface-2 px-3 py-2 hover:bg-brand-soft">
                      <span className="block text-[12.5px] font-medium">{run.subject.label}</span>
                      <span className="text-[11px] text-ink-3">{reason}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-[12px] font-bold text-ink-3">適用中の一時ルール</p>
              <Link href="/rules" className="text-[11.5px] text-brand hover:underline">管理</Link>
            </div>
            {activeRules.length === 0 ? (
              <p className="text-[12px] text-ink-3">有効なルールはありません</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {activeRules.map((r) => (
                  <li key={r.id} className="rounded-lg bg-surface-2 px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={r.ruleType === "temporary" ? "signal" : "neutral"}>
                        {{ case: "個別案件", temporary: "期間限定", department: "部署", standard: "標準" }[r.ruleType]}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[12.5px] font-medium leading-snug">{r.name}</p>
                    {r.activeTo && <p className="mt-0.5 text-[11px] text-ink-3">〜{new Date(r.activeTo).toLocaleDateString("ja-JP")}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {recentDone.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 text-[12px] font-bold text-ink-3">最近完了した業務</p>
              <ul className="flex flex-col gap-1">
                {recentDone.map((r) => {
                  const def = workflows.find((w) => w.key === r.workflowKey);
                  void orderedSteps;
                  return (
                    <li key={r.id}>
                      <Link href={`/map/${r.id}`} className="block rounded-lg px-2 py-1.5 hover:bg-surface-2">
                        <span className="block text-[12.5px]">{r.subject.label}</span>
                        <span className="text-[11px] text-ink-3">{def?.name} ・ {fmt(r.completedAt)}</span>
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
