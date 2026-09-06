"use client";

import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useLatestWorkflows } from "@/ui/use-navigator";
import { Badge, Card, LinkButton, PageHeader, Row, RowList } from "@/ui/primitives";
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
          <RowList>
            {myActiveRuns.map((run) => {
              const def = all.find((w) => w.key === run.workflowKey);
              const p = def ? runProgress(def, run, state.stepRunsByRun[run.id] ?? []) : { index: 0, total: 0, done: 0 };
              return (
                <Row key={run.id}>
                  <Link href={`/navigator/${run.id}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-medium">{runLabel(run)}</span>
                        {run.status === "paused" && <Badge tone="signal">待ち中</Badge>}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11.5px] text-ink-3">
                        {/* 対象を持たない業務では業務名が見出しと同じになるので繰り返さない */}
                        {subjectOf(run) && def && <span className="truncate">{def.name}</span>}
                        {run.status === "paused" && run.waitingFor && (
                          <span className="truncate">{run.waitingFor}</span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">STEP {p.index}/{p.total}</span>
                  </Link>
                </Row>
              );
            })}
          </RowList>
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
          <RowList>
            {published.filter((w) => w.category === cat).map((w) => {
              const runCount = state.runs.filter((r) => r.workflowKey === w.key).length;
              return (
                <Row key={w.key}>
                  <Link href={`/workflows/${w.key}`} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-medium leading-snug">{w.name}</span>
                        {w.workKind && <Badge tone="neutral">{WORK_KIND_LABEL[w.workKind]}</Badge>}
                        {w.origin === "user" && <Badge tone="brand">自分で登録</Badge>}
                        {w.edges.some((e) => e.condition) && <Badge tone="brand">条件分岐あり</Badge>}
                        {w.edges.some((e) => e.joinPolicy === "all") && <Badge tone="brand">並列あり</Badge>}
                      </span>
                      {w.description && (
                        <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{w.description}</span>
                      )}
                      {/*
                        件数や目安は、名前の下に文字だけで並べる。
                        1件ごとに罫線で仕切ると、行が増えるほど画面が網目になる。
                      */}
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-ink-3">
                        <span className="tabular-nums">
                          {w.steps.filter((st) => st.componentType !== "branch").length} STEP
                        </span>
                        {w.estimatedMinutes && <span className="tabular-nums">目安 {w.estimatedMinutes}分</span>}
                        {runCount > 0 && <span className="tabular-nums">実行 {runCount}件</span>}
                        {(w.startSchedules?.some((sc) => sc.enabled)
                          || (w.startTrigger && w.startTrigger.kind !== "manual")) && (
                          <span className="truncate">{describeStart(w).join("／")}</span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 pt-0.5"><Badge tone="ok">v{w.version}</Badge></span>
                  </Link>
                </Row>
              );
            })}
          </RowList>
        </section>
      ))}

      {stopped.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-[13px] font-bold">停止中の業務（{stopped.length}）</h2>
          <p className="mb-3 text-[12px] text-ink-3">
            新しく開始できません。過去の実行記録はそのまま残っています。
          </p>
          <RowList>
            {stopped.map((w) => (
              <Row key={w.key} tone="sunken">
                <Link href={`/workflows/${w.key}`} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="text-[13px] font-medium leading-snug text-ink-2">{w.name}</span>
                    {w.description && (
                      <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{w.description}</span>
                    )}
                  </span>
                  <span className="shrink-0 pt-0.5"><Badge tone="neutral">停止中</Badge></span>
                </Link>
              </Row>
            ))}
          </RowList>
        </section>
      )}

    </div>
  );
}
