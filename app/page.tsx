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
import { runProgress, orderedSteps } from "@/core/flow/engine";
import { blockingPredecessors, effectiveStatus, isBlocked } from "@/core/task/dependency";
import { TASK_STATUS_LABEL, TASK_SOURCE_LABEL } from "@/core/model/task-labels";
import { checkStatusOf } from "@/ui/wait-run";

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
  // 直近に発生した自分の未完了タスク。期限が先でも「作ったのに消えた」を防ぐ（新しい順）。
  // 先行待ちのタスクは着手できないので、ここには出さない（B-4 と同じ判定を共有する）
  const recentTasks = [...state.tasks]
    .filter(
      (t) => t.confirmationState === "confirmed" && t.status !== "done" && t.status !== "canceled" &&
        t.assigneeId === currentUser.id && !todayTasks.some((x) => x.id === t.id) &&
        !isBlocked(t, state.tasks),
    )
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 4);
  const recentDone = state.runs.filter((r) => r.status === "done").slice(0, 3);
  // 待ち中のうち、自分が決めた確認日が来た／過ぎたもの
  const dueChecks = waiting.filter((w) => w.dueForCheck);
  const stillWaiting = waiting.filter((w) => !w.dueForCheck);

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
                          <span className="block truncate text-[13px] font-bold">{run.subject.label}</span>
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
                  const p = def ? runProgress(def, run, stepRuns) : { index: 0, total: 0, done: 0 };
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
                            <div className="h-full rounded-full bg-brand" style={{ width: `${p.total === 0 ? 0 : (p.done / p.total) * 100}%` }} />
                          </div>
                          <span className="shrink-0 text-[11px] tabular-nums text-ink-3">STEP {p.index}/{p.total}</span>
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
                {todayTasks.map((t) => {
                  // 期限が今日でも、先行待ちなら着手できない。同じ判定を全画面で共有する
                  const waiting = blockingPredecessors(t, state.tasks);
                  const shown = effectiveStatus(t, state.tasks);
                  return (
                    <li key={t.id}>
                      <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 hover:border-brand">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px]">{t.title}</span>
                          {waiting.length > 0 && (
                            <span className="mt-0.5 block text-[11.5px] text-danger">
                              {TASK_STATUS_LABEL[shown]} — 待機中：{waiting.map((x) => x.title).join(" / ")}
                            </span>
                          )}
                        </span>
                        <Badge tone={urgencyOf(t.dueAt, now) === "overdue" ? "danger" : "signal"}>
                          {t.dueAt ? remainingLabel(new Date(t.dueAt), now) : "—"}
                        </Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 最近発生した仕事：業務やタスクから生まれたものを見失わないための導線 */}
          {recentTasks.length > 0 && (
            <section>
              <SectionTitle action={<Link href="/tasks" className="text-[12px] text-brand hover:underline">すべてのタスク</Link>}>
                最近発生した仕事
              </SectionTitle>
              <ul className="flex flex-col gap-1.5">
                {recentTasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 hover:border-brand">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{t.title}</span>
                        <span className="mt-0.5 block text-[11.5px] text-ink-3">
                          {TASK_SOURCE_LABEL[t.source]}
                          {t.runId && state.runs.find((r) => r.id === t.runId)
                            ? ` ／ ${state.runs.find((r) => r.id === t.runId)!.subject.label}`
                            : ""}
                        </span>
                      </span>
                      {t.dueAt && (
                        <Badge tone="neutral">{remainingLabel(new Date(t.dueAt), now)}</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
                {[...dueChecks, ...stillWaiting].map(({ run, reason }) => {
                  const st = checkStatusOf(run.waitingUntil, now);
                  return (
                    <li key={run.id}>
                      <Link href={`/navigator/${run.id}`} className="block rounded-lg bg-surface-2 px-3 py-2 hover:bg-brand-soft">
                        <span className="block text-[12.5px] font-medium">{run.subject.label}</span>
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
