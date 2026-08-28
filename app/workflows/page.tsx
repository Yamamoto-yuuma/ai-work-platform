"use client";

import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useWorkflows } from "@/ui/use-navigator";
import { Badge, Card, PageHeader } from "@/ui/primitives";
import { progressOf } from "@/core/flow/engine";

export default function WorkflowsPage() {
  const workflows = useWorkflows();
  const { state, currentUser } = useStore();
  const categories = Array.from(new Set(workflows.map((w) => w.category)));
  // HOME と同じ基準（自分が担当する進行中の業務）で表示する
  const myActiveRuns = state.runs.filter(
    (r) => r.status === "active" && r.assigneeId === currentUser.id,
  );

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-6">
      <PageHeader
        title="業務"
        description="実行できる業務フローの一覧です。業務フローはすべてデータとして定義されており、管理者が追加・変更できます。"
      />

      {/* 進行中 */}
      {myActiveRuns.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-[13px] font-bold">進行中の業務</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {myActiveRuns.map((run) => {
              const def = workflows.find((w) => w.key === run.workflowKey);
              const p = def ? progressOf(def, state.stepRunsByRun[run.id] ?? []) : { done: 0, total: 1 };
              return (
                <Link key={run.id} href={`/navigator/${run.id}`}>
                  <Card className="h-full border-brand/30 bg-brand-soft p-4 hover:border-brand">
                    <p className="text-[11px] text-brand">{def?.name}</p>
                    <p className="mt-1 text-[13.5px] font-bold leading-snug">{run.subject.label}</p>
                    <p className="mt-2 text-[11.5px] tabular-nums text-ink-2">STEP {p.done}/{p.total}</p>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {categories.map((cat) => (
        <section key={cat} className="mb-8">
          <h2 className="mb-3 text-[13px] font-bold">{cat}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workflows.filter((w) => w.category === cat).map((w) => (
              <Link key={w.key} href={`/workflows/${w.key}`}>
                <Card className="flex h-full flex-col p-4 transition-colors hover:border-brand">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="text-[14px] font-bold leading-snug">{w.name}</h3>
                    <Badge tone="ok">公開中 v{w.version}</Badge>
                  </div>
                  <p className="flex-1 text-[12.5px] leading-relaxed text-ink-2">{w.description}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3 text-[11.5px] text-ink-3">
                    <span>{w.steps.filter((s) => s.componentType !== "branch").length} STEP</span>
                    {w.edges.some((e) => e.condition) && <Badge tone="brand">条件分岐あり</Badge>}
                    {w.edges.some((e) => e.joinPolicy === "all") && <Badge tone="brand">並列あり</Badge>}
                    {w.estimatedMinutes && <span className="ml-auto">目安 {w.estimatedMinutes}分</span>}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <Card className="border-dashed p-5 text-center">
        <p className="text-[13px] font-medium text-ink-2">＋ 新しい業務フローを追加</p>
        <p className="mt-1 text-[12px] text-ink-3">
          業務フローのGUI作成・編集は Phase 2 で実装します。現在はシードデータとして定義されています。
        </p>
      </Card>
    </div>
  );
}
