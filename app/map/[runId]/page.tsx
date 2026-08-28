"use client";

import { use } from "react";
import Link from "next/link";
import { useRunView } from "@/ui/use-navigator";
import { useStore } from "@/adapters/memory/store";
import { FlowGraph } from "@/ui/flow-graph";
import { Badge, LinkButton, PageHeader } from "@/ui/primitives";

export default function RunMapPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const view = useRunView(runId);
  const { state } = useStore();

  if (!view) return <div className="p-8 text-[13px]">業務が見つかりません。</div>;
  const { run, def, statusOf, progress } = view;
  const relatedTasks = state.tasks.filter((t) => t.runId === run.id);

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6">
      <div className="mb-2 text-[12px] text-ink-3">
        <Link href="/map" className="hover:text-brand">業務マップ</Link> / {run.subject.label}
      </div>
      <PageHeader
        title={run.subject.label}
        description={`${def.name} ／ STEP ${progress.done} / ${progress.total}`}
        action={run.status === "active"
          ? <LinkButton href={`/navigator/${run.id}`}>業務ナビゲーターへ</LinkButton>
          : <Badge tone="ok">完了</Badge>}
      />

      <FlowGraph def={def} statusOf={statusOf} />

      <div className="mt-4 flex flex-wrap gap-4 text-[11.5px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-[var(--color-brand)] bg-[var(--color-brand)]" />実行中</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-[var(--color-ok)] bg-[var(--color-ok-soft)]" />完了</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-[var(--color-line)] bg-[var(--color-surface)]" />未着手</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-dashed border-[var(--color-line)]" />条件分岐 ／ 破線の矢印は条件付き経路</span>
      </div>

      {relatedTasks.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[13px] font-bold">この業務から派生したタスク（{relatedTasks.length}）</h2>
          <ul className="flex flex-col gap-1.5">
            {relatedTasks.map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 hover:border-brand">
                  <span className="flex-1 text-[13px]">{t.title}</span>
                  {t.confirmationState === "proposed" && <Badge tone="signal">提案中</Badge>}
                  <Badge tone={t.status === "done" ? "ok" : "neutral"}>{t.status === "done" ? "完了" : "未完了"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
