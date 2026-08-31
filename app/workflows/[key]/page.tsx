"use client";

/**
 * 業務フロー詳細／実行開始画面。
 *
 * 「業務の定義」と「その業務の実行（Run）」を1画面で区別して見せる（仕様 §28-9）。
 * 定義は手順そのもの。実行は、その手順を特定の相手・案件に対して1回まわしたもの。
 */
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useLatestWorkflows, useActiveRules, useNow } from "@/ui/use-navigator";
import { Badge, Button, Card, PageHeader, LinkButton } from "@/ui/primitives";
import { getComponentSpec } from "@/components-registry/registry";
import { orderedSteps, outgoingEdges, runProgress } from "@/core/flow/engine";
import { buildRun } from "@/services/start-run";
import { latestOf } from "@/core/workflow/registry";
import { WORK_KIND_LABEL, describeStart } from "@/core/workflow/start-trigger";
import { TASK_PRIORITIES } from "@/core/model/task-draft";
import { runLabel } from "@/core/model/run-label";
import type { WorkflowNotes } from "@/core/model/types";

const PERIOD_LABEL = { day: "1日", week: "1週", month: "1か月", quarter: "四半期", year: "1年" } as const;

const NOTE_LABELS: { key: keyof WorkflowNotes; label: string; kind: "text" | "list" }[] = [
  { key: "cautions", label: "注意事項", kind: "text" },
  { key: "specialRules", label: "特殊ルール", kind: "text" },
  { key: "exceptions", label: "よくある例外", kind: "text" },
  { key: "emergency", label: "緊急時の対応", kind: "text" },
  { key: "criteria", label: "判断基準", kind: "text" },
  { key: "aiInstruction", label: "AIへの指示", kind: "text" },
  { key: "memo", label: "メモ", kind: "text" },
  { key: "tools", label: "関連ツール", kind: "list" },
  { key: "materials", label: "関連資料", kind: "list" },
  { key: "companies", label: "関連企業", kind: "list" },
  { key: "checkItems", label: "チェック項目", kind: "list" },
];

export default function WorkflowDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const router = useRouter();
  const workflows = useLatestWorkflows();
  const { state, dispatch, customers } = useStore();
  const { active: activeRules } = useActiveRules();
  const now = useNow();
  const [confirmStop, setConfirmStop] = useState(false);

  const def = latestOf(workflows, key);
  if (!def) return <div className="p-8 text-[13px]">業務が見つかりません。</div>;

  const steps = orderedSteps(def);
  const relatedRules = activeRules.filter(
    (r) => r.scope.workflowKeys.length === 0 || r.scope.workflowKeys.includes(def.key),
  );
  const runsOfThis = state.runs.filter((r) => r.workflowKey === def.key);
  const openRuns = runsOfThis.filter((r) => r.status === "active" || r.status === "paused");
  const closedRuns = runsOfThis.filter((r) => r.status === "done" || r.status === "canceled");
  const stopped = def.status !== "published";
  const notes = def.notes ?? {};
  const hasNotes = NOTE_LABELS.some((n) => {
    const v = notes[n.key];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  }) || (notes.faq ?? []).length > 0;

  function start() {
    if (!def) return;
    const { run, stepRuns } = buildRun({
      def, customers, assigneeId: state.currentUserId, now,
    });
    dispatch({ type: "startRun", run, stepRuns });
    router.push(`/navigator/${run.id}`);
  }

  function setStatus(status: "published" | "archived") {
    if (!def) return;
    dispatch({ type: "setWorkflowStatus", key: def.key, status, latest: def });
    setConfirmStop(false);
  }

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-6">
      <div className="mb-2 text-[12px] text-ink-3">
        <Link href="/workflows" className="hover:text-brand">業務</Link> / {def.name}
      </div>
      <PageHeader
        title={def.name}
        description={def.description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton href={`/workflows/${def.key}/edit`} variant="secondary">編集する</LinkButton>
            <LinkButton href={`/workflows/new?copyFrom=${def.key}`} variant="secondary">複製して作る</LinkButton>
            {stopped ? (
              <Button onClick={() => setStatus("published")}>この業務を再開する</Button>
            ) : (
              <Button size="lg" onClick={start}>この業務を開始する</Button>
            )}
          </div>
        }
      />

      {stopped && (
        <Card className="mb-5 border-line bg-surface-2 p-4">
          <p className="text-[13px] font-bold">この業務は停止中です</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
            新しく開始できません。定義と過去の実行記録はそのまま残っています。
          </p>
        </Card>
      )}

      {/* 定義と実行の関係 */}
      <Card className="mb-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5">
            <p className="text-[11px] font-bold text-ink-3">業務の定義（この画面）</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
              やることの手順そのものです。1つだけ持ちます。編集すると新しいバージョンになります。
            </p>
          </div>
          <div className="rounded-lg bg-brand-soft px-3.5 py-2.5">
            <p className="text-[11px] font-bold text-brand">実行（開始するたびに増える）</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
              この手順を1回まわしたものです。相手や案件ごとに別々に進み、進捗も別々に残ります。
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="mb-3 text-[13px] font-bold">
              STEP構成（{steps.filter((s) => s.componentType !== "branch").length}ステップ）
            </h2>
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
                            {!s.required && <Badge tone="neutral">任意</Badge>}
                            {s.estimatedMinutes && (
                              <span className="text-[11px] text-ink-3">{s.estimatedMinutes}分</span>
                            )}
                          </div>
                          {s.guidance && (
                            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{s.guidance}</p>
                          )}
                          {s.preconditions && (
                            <p className="mt-1 text-[11.5px] text-ink-3">前提：{s.preconditions}</p>
                          )}
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
                          {edges.length > 1 && !edges.some((e) => e.condition) && (
                            <p className="mt-2 text-[11.5px] text-brand">
                              ⇉ {edges.length}件を同時に進めます（並列）
                            </p>
                          )}
                          {def.edges.some((e) => e.to === s.key && e.joinPolicy === "all") && (
                            <p className="mt-2 text-[11.5px] text-brand">先行STEPが全て完了してから進みます（合流）</p>
                          )}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ol>
          </div>

          {hasNotes && (
            <Card className="p-5">
              <h2 className="mb-3 text-[13px] font-bold">この業務について記録していること</h2>
              <dl className="flex flex-col gap-3">
                {NOTE_LABELS.map((n) => {
                  const v = notes[n.key];
                  if (n.kind === "list") {
                    const list = (v as string[]) ?? [];
                    if (list.length === 0) return null;
                    return (
                      <div key={n.key}>
                        <dt className="text-[11.5px] font-bold text-ink-3">{n.label}</dt>
                        <dd className="mt-1 flex flex-wrap gap-1.5">
                          {list.map((x, i) => <Badge key={i} tone="neutral">{x}</Badge>)}
                        </dd>
                      </div>
                    );
                  }
                  if (!v) return null;
                  return (
                    <div key={n.key}>
                      <dt className="text-[11.5px] font-bold text-ink-3">{n.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed">{String(v)}</dd>
                    </div>
                  );
                })}
                {(notes.faq ?? []).length > 0 && (
                  <div>
                    <dt className="text-[11.5px] font-bold text-ink-3">よくある質問</dt>
                    <dd className="mt-1 flex flex-col gap-1.5">
                      {(notes.faq ?? []).map((f, i) => (
                        <div key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px]">
                          <p className="font-medium">{f.q}</p>
                          <p className="mt-0.5 text-ink-2">{f.a}</p>
                        </div>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <p className="mb-2 text-[12px] font-bold text-ink-3">この業務の設定</p>
            <dl className="flex flex-col gap-1.5 text-[12.5px]">
              {def.workKind && (
                <div className="flex justify-between gap-3"><dt className="text-ink-3">業務タイプ</dt><dd>{WORK_KIND_LABEL[def.workKind]}</dd></div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-ink-3">開始条件</dt>
                <dd className="text-right">
                  {describeStart(def).map((line, i) => <span key={i} className="block">{line}</span>)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">期限</dt>
                <dd>
                  {def.deadlineRule?.offsetDays !== undefined
                    ? `開始から${def.deadlineRule.offsetDays}${def.deadlineRule.businessDaysOnly ? "営業" : ""}日`
                    : def.deadlineRule?.offsetHours !== undefined
                      ? `開始から${def.deadlineRule.offsetHours}時間`
                      : "なし"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">優先度</dt>
                <dd>{TASK_PRIORITIES.find((p) => p.value === (def.defaultPriority ?? "normal"))?.label}</dd>
              </div>
              {def.quota && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">目標</dt>
                  <dd className="text-right">
                    {PERIOD_LABEL[def.quota.period]}あたり {def.quota.target}
                    {def.quota.metric === "count" ? "件" : "時間"}
                    {def.quota.direction === "atLeast" ? "以上" : "以内"}
                  </dd>
                </div>
              )}
              {def.estimatedMinutes && (
                <div className="flex justify-between gap-3"><dt className="text-ink-3">想定所要</dt><dd>{def.estimatedMinutes}分</dd></div>
              )}
            </dl>
            <p className="mt-2.5 border-t border-line-soft pt-2.5 text-[11.5px] leading-relaxed text-ink-3">
              優先度は期限が近づくと自動で引き上がります（2日前は高、超過は緊急）。
            </p>
          </Card>

          <Card className="p-5">
            <p className="mb-2 text-[12px] font-bold text-ink-3">定義情報</p>
            <dl className="flex flex-col gap-1.5 text-[12.5px]">
              {/*
                内部の識別子は出さない（Phase 12 / P2-1）。
                自動採番なので、ユーザーが業務を見分ける手がかりにならない。
                リンク先や保存には引き続き def.key を使う。
              */}
              <div className="flex justify-between"><dt className="text-ink-3">バージョン</dt><dd>v{def.version}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-3">状態</dt><dd>{stopped ? "停止中" : "公開中"}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-3">カテゴリ</dt><dd>{def.category}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-3">更新日</dt><dd>{new Date(def.updatedAt).toLocaleDateString("ja-JP")}</dd></div>
            </dl>
          </Card>

          {openRuns.length > 0 && (
            <Card className="p-5">
              <p className="mb-2 text-[12px] font-bold text-ink-3">進行中の実行（{openRuns.length}）</p>
              <ul className="flex flex-col gap-1">
                {openRuns.map((r) => {
                  const p = runProgress(def, r, state.stepRunsByRun[r.id] ?? []);
                  return (
                    <li key={r.id}>
                      <Link href={`/navigator/${r.id}`} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-surface-2">
                        <span className="truncate text-[12.5px]">{runLabel(r)}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{p.index}/{p.total}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {closedRuns.length > 0 && (
            <Card className="p-5">
              <p className="mb-2 text-[12px] font-bold text-ink-3">終わった実行（{closedRuns.length}）</p>
              <ul className="flex flex-col gap-1">
                {closedRuns.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <Link href={`/map/${r.id}`} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-surface-2">
                      <span className="truncate text-[12.5px]">{runLabel(r)}</span>
                      <Badge tone={r.status === "done" ? "ok" : "neutral"}>{r.status === "done" ? "完了" : "中止"}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-5">
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

          {!stopped && (
            <Card className="p-5">
              {confirmStop ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[12.5px] leading-relaxed">
                    停止すると新しく開始できなくなります。進行中の実行はそのまま続けられます。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" size="sm" onClick={() => setStatus("archived")}>停止する</Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirmStop(false)}>やめる</Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setConfirmStop(true)}>この業務を停止する</Button>
              )}
            </Card>
          )}

          <LinkButton href="/rules" variant="secondary" size="sm">一時ルールを管理する</LinkButton>
        </div>
      </div>
    </div>
  );
}
