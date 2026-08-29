"use client";

import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { Badge, Card, Empty, PageHeader } from "@/ui/primitives";
import { runProgress } from "@/core/flow/engine";

export default function MapIndexPage() {
  const { state, workflows } = useStore();
  const runs = state.runs;
  const changes = state.changeEvents;

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-6">
      <PageHeader
        title="業務マップ"
        description="業務の構造と、変更による影響の広がりを可視化します。業務は一本道ではなく、条件によって分岐し、変更によってタスクが派生します。"
      />

      <section className="mb-8">
        <h2 className="mb-3 text-[13px] font-bold">変更によるインパクト</h2>
        {changes.length === 0 ? (
          <Empty>記録された変更はありません</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {changes.map((c) => {
              const derived = state.tasks.filter((t) => t.originEventId === c.id);
              const unconfirmed = derived.filter((t) => t.confirmationState === "proposed").length;
              return (
                <li key={c.id}>
                  <Link href={`/map/impact/${c.id}`}>
                    <Card className="p-4 transition-colors hover:border-brand">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[13.5px] font-bold">{c.entityLabel}</p>
                        {unconfirmed > 0 && <Badge tone="signal">未確認 {unconfirmed}件</Badge>}
                      </div>
                      <p className="mt-1 text-[12.5px] text-ink-2">
                        {c.fieldLabel}：{new Date(String(c.before)).toLocaleDateString("ja-JP")} → {new Date(String(c.after)).toLocaleDateString("ja-JP")}
                      </p>
                      <p className="mt-2 text-[11.5px] text-ink-3">
                        {derived.length > 0 ? `${derived.length}件の派生タスク` : "影響を分析する →"}
                      </p>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-bold">業務の進行状況</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {runs.map((run) => {
            const def = workflows.find((w) => w.key === run.workflowKey);
            const p = def ? runProgress(def, run, state.stepRunsByRun[run.id] ?? []) : { index: 0, total: 0, done: 0 };
            return (
              <Link key={run.id} href={`/map/${run.id}`}>
                <Card className="p-4 transition-colors hover:border-brand">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold">{run.subject.label}</p>
                      <p className="mt-0.5 text-[11.5px] text-ink-3">{def?.name}</p>
                    </div>
                    <Badge tone={run.status === "done" ? "ok" : run.status === "paused" ? "signal" : run.status === "canceled" ? "neutral" : "brand"}>
                      {run.status === "done" ? "完了" : run.status === "paused" ? "待ち中" : run.status === "canceled" ? "中止" : "進行中"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-[11.5px] tabular-nums text-ink-2">STEP {p.index}/{p.total}</p>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
