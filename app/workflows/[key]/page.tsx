"use client";

/** 業務フロー詳細／実行開始画面。STEP・分岐・適用ルールをデータから描画する */
import { use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useWorkflows, useActiveRules } from "@/ui/use-navigator";
import { Badge, Button, Card, PageHeader, LinkButton } from "@/ui/primitives";
import { getComponentSpec } from "@/components-registry/registry";
import { orderedSteps, outgoingEdges } from "@/core/flow/engine";
import { buildRun } from "@/services/start-run";

export default function WorkflowDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const router = useRouter();
  const workflows = useWorkflows();
  const { state, dispatch, customers } = useStore();
  const { active: activeRules } = useActiveRules();

  const def = workflows.find((w) => w.key === key);
  if (!def) return <div className="p-8 text-[13px]">業務フローが見つかりません。</div>;

  const steps = orderedSteps(def);
  const relatedRules = activeRules.filter(
    (r) => r.scope.workflowKeys.length === 0 || r.scope.workflowKeys.includes(def.key),
  );
  const runsOfThis = state.runs.filter((r) => r.workflowKey === def.key);

  function start() {
    if (!def) return;
    const { run, stepRuns } = buildRun({
      def, customers, assigneeId: state.currentUserId,
    });
    dispatch({ type: "startRun", run, stepRuns });
    router.push(`/navigator/${run.id}`);
  }

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-6">
      <div className="mb-2 text-[12px] text-ink-3">
        <Link href="/workflows" className="hover:text-brand">業務</Link> / {def.name}
      </div>
      <PageHeader
        title={def.name}
        description={def.description}
        action={<Button size="lg" onClick={start}>この業務を開始する</Button>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <h2 className="mb-3 text-[13px] font-bold">STEP構成（{steps.filter((s) => s.componentType !== "branch").length}ステップ）</h2>
          <ol className="flex flex-col gap-2">
            {steps.map((s, i) => {
              const spec = getComponentSpec(s.componentType);
              const edges = outgoingEdges(def, s.key);
              const isBranch = s.componentType === "branch";
              return (
                <li key={s.key}>
                  <Card className={`p-4 ${isBranch ? "border-dashed bg-surface-2" : ""}`}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[11px] font-bold tabular-nums text-ink-3">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[13.5px] font-bold">{s.title}</h3>
                          <Badge tone={isBranch ? "neutral" : "brand"}>{spec.icon} {spec.label}</Badge>
                          {s.required && <Badge tone="neutral">必須</Badge>}
                          {(s.ruleTags ?? []).length > 0 && (
                            <span className="text-[11px] text-ink-3">タグ: {(s.ruleTags ?? []).join(", ")}</span>
                          )}
                        </div>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{s.guidance}</p>
                        {edges.some((e) => e.condition) && (
                          <ul className="mt-2 flex flex-col gap-1">
                            {edges.map((e, j) => (
                              <li key={j} className="flex items-center gap-2 rounded bg-surface-2 px-2.5 py-1.5 text-[11.5px] text-ink-2">
                                <span className="text-brand">⑂</span>
                                <span className="font-medium">{e.label ?? "既定"}</span>
                                <span className="text-ink-3">→ {def.steps.find((x) => x.key === e.to)?.title}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {edges.some((e) => e.joinPolicy === "all") && (
                          <p className="mt-2 text-[11.5px] text-brand">先行STEPが全て完了してから次へ進みます（合流）</p>
                        )}
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <p className="mb-2 text-[12px] font-bold text-ink-3">この業務に適用されるルール</p>
            {relatedRules.length === 0 ? (
              <p className="text-[12px] text-ink-3">現在有効なルールはありません</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {relatedRules.map((r) => (
                  <li key={r.id} className="rounded-lg bg-surface-2 px-3 py-2">
                    <Badge tone={r.ruleType === "temporary" ? "signal" : "neutral"}>
                      {{ case: "個別案件", temporary: "期間限定", department: "部署", standard: "標準" }[r.ruleType]}
                    </Badge>
                    <p className="mt-1.5 text-[12.5px] font-medium leading-snug">{r.name}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-[12px] font-bold text-ink-3">定義情報</p>
            <dl className="flex flex-col gap-1.5 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-ink-3">識別子</dt><dd className="font-mono text-[11.5px]">{def.key}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-3">バージョン</dt><dd>v{def.version}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-3">状態</dt><dd>公開中</dd></div>
              <div className="flex justify-between"><dt className="text-ink-3">対象</dt><dd>{def.audience.teams.join(", ") || "全社"}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-3">更新日</dt><dd>{new Date(def.updatedAt).toLocaleDateString("ja-JP")}</dd></div>
            </dl>
          </Card>

          {runsOfThis.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 text-[12px] font-bold text-ink-3">この業務の実行履歴</p>
              <ul className="flex flex-col gap-1">
                {runsOfThis.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <Link href={r.status === "done" ? `/map/${r.id}` : `/navigator/${r.id}`} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-surface-2">
                      <span className="truncate text-[12.5px]">{r.subject.label}</span>
                      <Badge tone={r.status === "done" ? "ok" : "brand"}>{r.status === "done" ? "完了" : "進行中"}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <LinkButton href="/rules" variant="secondary" size="sm">一時ルールを管理する</LinkButton>
        </div>
      </div>
    </div>
  );
}
