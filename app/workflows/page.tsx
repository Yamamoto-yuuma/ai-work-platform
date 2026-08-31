"use client";

import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useLatestWorkflows } from "@/ui/use-navigator";
import { Badge, Card, LinkButton, PageHeader } from "@/ui/primitives";
import { runProgress } from "@/core/flow/engine";
import { WORK_KIND_LABEL, describeStart } from "@/core/workflow/start-trigger";
import { runLabel, subjectOf } from "@/core/model/run-label";

export default function WorkflowsPage() {
  const all = useLatestWorkflows();
  const { state, currentUser } = useStore();

  const published = all.filter((w) => w.status === "published");
  const stopped = all.filter((w) => w.status !== "published");
  const categories = Array.from(new Set(published.map((w) => w.category)));

  // HOME と同じ基準（自分が担当する進行中の業務）で表示する
  const myActiveRuns = state.runs.filter(
    // 待ち中も「進行中」に含める。ここから消えると探せなくなる
    (r) => (r.status === "active" || r.status === "paused") && r.assigneeId === currentUser.id,
  );

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-6">
      <PageHeader
        title="業務"
        description="自分の業務を登録すると、STEPに沿って進められるようになります。業務はすべてデータとして定義されています。"
        action={<LinkButton href="/workflows/new" size="lg">＋ 業務を登録</LinkButton>}
      />

      {/* 進行中 */}
      {myActiveRuns.length > 0 && (
        <section className="mb-8">
          {/* HOME と同じ語彙にする（仕様 §26-5）。待ち中もここに含まれる */}
          <h2 className="mb-3 text-[13px] font-bold">抱えている業務（{myActiveRuns.length}）</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {myActiveRuns.map((run) => {
              const def = all.find((w) => w.key === run.workflowKey);
              const p = def ? runProgress(def, run, state.stepRunsByRun[run.id] ?? []) : { index: 0, total: 0, done: 0 };
              return (
                <Link key={run.id} href={`/navigator/${run.id}`}>
                  <Card className={`h-full p-4 ${
                    run.status === "paused"
                      ? "border-line bg-surface hover:border-signal"
                      : "bg-brand-soft hover:shadow-lift"
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      {/* 対象を持たない業務では業務名が下の見出しと同じになる */}
                      <p className="text-[11px] text-brand">{subjectOf(run) ? def?.name : ""}</p>
                      {run.status === "paused" && <Badge tone="signal">待ち中</Badge>}
                    </div>
                    <p className="mt-1 text-[13.5px] font-bold leading-snug">{runLabel(run)}</p>
                    <p className="mt-2 text-[11.5px] tabular-nums text-ink-2">STEP {p.index}/{p.total}</p>
                    {run.status === "paused" && run.waitingFor && (
                      <p className="mt-1 truncate text-[11px] text-ink-3">{run.waitingFor}</p>
                    )}
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {published.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <p className="text-[14px] font-bold">まだ業務が登録されていません</p>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[12.5px] leading-relaxed text-ink-2">
            最初の1つを登録してみてください。名前とやることを並べるだけで始められます。
          </p>
          <div className="mt-4 flex justify-center">
            <LinkButton href="/workflows/new">＋ 業務を登録</LinkButton>
          </div>
        </Card>
      )}

      {categories.map((cat) => (
        <section key={cat} className="mb-8">
          <h2 className="mb-3 text-[13px] font-bold">{cat}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {published.filter((w) => w.category === cat).map((w) => {
              const runCount = state.runs.filter((r) => r.workflowKey === w.key).length;
              return (
                <Link key={w.key} href={`/workflows/${w.key}`}>
                  <Card className="flex h-full flex-col p-4 transition-colors hover:border-brand">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h3 className="text-[14px] font-bold leading-snug">{w.name}</h3>
                      <Badge tone="ok">v{w.version}</Badge>
                    </div>
                    <p className="flex-1 text-[12.5px] leading-relaxed text-ink-2">{w.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {w.workKind && <Badge tone="neutral">{WORK_KIND_LABEL[w.workKind]}</Badge>}
                      {w.origin === "user" && <Badge tone="brand">自分で登録</Badge>}
                      {(w.startSchedules?.some((s) => s.enabled)
                        || (w.startTrigger && w.startTrigger.kind !== "manual")) && (
                        <span className="text-[11px] text-ink-3">{describeStart(w).join("／")}</span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3 text-[11.5px] text-ink-3">
                      <span>{w.steps.filter((s) => s.componentType !== "branch").length} STEP</span>
                      {w.edges.some((e) => e.condition) && <Badge tone="brand">条件分岐あり</Badge>}
                      {w.edges.some((e) => e.joinPolicy === "all") && <Badge tone="brand">並列あり</Badge>}
                      {runCount > 0 && <span>実行 {runCount}件</span>}
                      {w.estimatedMinutes && <span className="ml-auto">目安 {w.estimatedMinutes}分</span>}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      {stopped.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-[13px] font-bold">停止中の業務（{stopped.length}）</h2>
          <p className="mb-3 text-[12px] text-ink-3">
            新しく開始できません。過去の実行記録はそのまま残っています。
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stopped.map((w) => (
              <Link key={w.key} href={`/workflows/${w.key}`}>
                <Card className="flex h-full flex-col bg-surface-2 p-4 transition-colors hover:border-brand">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h3 className="text-[13.5px] font-bold leading-snug text-ink-2">{w.name}</h3>
                    <Badge tone="neutral">停止中</Badge>
                  </div>
                  <p className="text-[12px] leading-relaxed text-ink-3">{w.description}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
