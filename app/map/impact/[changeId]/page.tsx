"use client";

/**
 * インパクトマップ（仕様 §12）＋ 逆算スケジュール（§13）。
 * 変更イベントを起点に、直接影響／間接影響／確認事項の3層で表示する。
 * 派生タスクは必ず「提案中」を経由し、ユーザーが確認して確定する。
 */
import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { matchRules, generateDerivedTasks, buildImpactGraph, detectCycle } from "@/core/derivation/engine";
import { backwardSchedule } from "@/core/schedule/backward";
import { Badge, Button, Card, PageHeader } from "@/ui/primitives";
import type { ImpactLayer } from "@/core/model/types";

const LAYERS: { key: ImpactLayer; label: string; hint: string; tone: "danger" | "signal" | "brand" }[] = [
  { key: "direct", label: "直接影響", hint: "変更対象に直結して対応が必要", tone: "danger" },
  { key: "indirect", label: "間接影響", hint: "直接影響の結果として対応が必要", tone: "signal" },
  { key: "check", label: "確認事項", hint: "対応要否の判断に確認が必要", tone: "brand" },
];

export default function ImpactPage({ params }: { params: Promise<{ changeId: string }> }) {
  const { changeId } = use(params);
  const { state, dispatch, derivationRules } = useStore();
  const [analyzed, setAnalyzed] = useState(false);

  const change = state.changeEvents.find((c) => c.id === changeId);
  const existing = state.tasks.filter((t) => t.originEventId === changeId);

  // 決定的なルールによる派生タスクの生成（AIには依存しない）
  const generated = useMemo(() => {
    if (!change) return [];
    const rules = matchRules(change, derivationRules);
    return generateDerivedTasks(change, rules, state.currentUserId);
  }, [change, derivationRules, state.currentUserId]);

  const tasks = useMemo(
    () => (existing.length > 0 ? existing : analyzed ? generated : []),
    [existing, analyzed, generated],
  );
  const graph = change ? buildImpactGraph(change, tasks) : null;
  const cycle = detectCycle(tasks);

  const schedule = useMemo(() => {
    if (!change || tasks.length === 0) return null;
    return backwardSchedule(tasks, String(change.after));
  }, [change, tasks]);

  if (!change) return <div className="p-8 text-[13px]">変更イベントが見つかりません。</div>;

  const proposed = tasks.filter((t) => t.confirmationState === "proposed");

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6">
      <div className="mb-2 text-[12px] text-ink-3">
        <Link href="/map" className="hover:text-brand">業務マップ</Link> / インパクトマップ
      </div>

      <PageHeader
        title="変更による影響範囲"
        description="この変更によって対応が必要になるものを洗い出します。生成されたタスクは提案であり、確認して確定するまでタスクにはなりません。"
      />

      {/* 変更内容 */}
      <Card className="mb-6 border-brand/30 bg-brand-soft p-5">
        <p className="text-[11px] font-bold tracking-wide text-brand">変更内容</p>
        <p className="mt-1.5 text-[17px] font-bold text-brand-ink">{change.entityLabel}</p>
        <p className="mt-1 text-[14px] text-ink">
          {change.fieldLabel}：
          <span className="mx-1.5 line-through opacity-60">{new Date(String(change.before)).toLocaleDateString("ja-JP")}</span>
          →
          <span className="mx-1.5 font-bold">{new Date(String(change.after)).toLocaleDateString("ja-JP")}</span>
        </p>
        {change.reason && <p className="mt-2 text-[12.5px] text-ink-2">理由：{change.reason}</p>}
      </Card>

      {tasks.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[13.5px] font-medium">この変更の影響範囲を分析します</p>
          <p className="mt-1.5 text-[12.5px] text-ink-2">
            登録された派生ルールに基づき、対応が必要なものを機械的に洗い出します（AIには依存しません）。
          </p>
          <div className="mt-4">
            <Button size="lg" onClick={() => setAnalyzed(true)}>影響範囲を分析する</Button>
          </div>
        </Card>
      ) : (
        <>
          {/* 3層の影響グラフ */}
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {LAYERS.map((layer) => {
              const nodes = graph?.layers[layer.key] ?? [];
              return (
                <Card key={layer.key} className="overflow-hidden">
                  <div className="border-b border-line bg-surface-2 px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[12.5px] font-bold">{layer.label}</h3>
                      <Badge tone={layer.tone}>{nodes.length}</Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-3">{layer.hint}</p>
                  </div>
                  <ul className="flex flex-col gap-1.5 p-3">
                    {nodes.length === 0 && <li className="py-2 text-center text-[11.5px] text-ink-3">該当なし</li>}
                    {nodes.map((n) => {
                      const t = tasks.find((x) => x.id === n.taskId);
                      const due = schedule?.proposals.find((p) => p.taskId === n.taskId)?.dueAt ?? t?.dueAt;
                      return (
                        <li key={n.id} className={`rounded-lg border px-3 py-2.5 ${
                          n.confirmationState === "proposed" ? "border-signal/40 bg-signal-soft" : "border-line bg-surface"
                        }`}>
                          <p className="text-[12.5px] font-medium leading-snug">{n.label}</p>
                          {t?.description && <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{t.description}</p>}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {due && <Badge tone="neutral">{new Date(due).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}</Badge>}
                            {n.dependsOn.length > 0 && <Badge tone="neutral">先行 {n.dependsOn.length}件</Badge>}
                            {n.confirmationState === "proposed" && <Badge tone="signal">提案中</Badge>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>

          {cycle && (
            <Card className="mb-6 border-danger/40 bg-danger-soft p-4">
              <p className="text-[13px] font-bold text-danger">依存関係に循環があります</p>
              <p className="mt-1 text-[12.5px] text-danger">{cycle.join(" → ")}</p>
            </Card>
          )}

          {/* 逆算スケジュール */}
          {schedule && (
            <Card className="mb-6 p-5">
              <h2 className="text-[13px] font-bold">
                逆算スケジュール（ゴール：{new Date(String(change.after)).toLocaleDateString("ja-JP")}）
              </h2>
              <p className="mt-1 text-[12px] text-ink-3">
                ゴール期限と依存関係から各タスクの期限を逆算した提案です。確定するまで適用されません。
              </p>

              {schedule.warnings.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {schedule.warnings.map((w, i) => (
                    <li key={i} className="rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">⚠ {w.message}</li>
                  ))}
                </ul>
              )}

              <ol className="mt-4 flex flex-col gap-1">
                {[...schedule.proposals]
                  .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
                  .map((p) => {
                    const t = tasks.find((x) => x.id === p.taskId);
                    return (
                      <li key={p.taskId} className="flex items-center gap-4 border-b border-line-soft py-2 last:border-b-0">
                        <span className="w-16 shrink-0 text-[12.5px] font-bold tabular-nums text-brand">
                          {new Date(p.dueAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                        </span>
                        <span className="flex-1 text-[12.5px]">{t?.title}</span>
                        <Badge tone={t?.impactLayer === "direct" ? "danger" : t?.impactLayer === "check" ? "brand" : "signal"}>
                          {t?.impactLayer === "direct" ? "直接" : t?.impactLayer === "check" ? "確認" : "間接"}
                        </Badge>
                      </li>
                    );
                  })}
                <li className="flex items-center gap-4 pt-3">
                  <span className="w-16 shrink-0 text-[12.5px] font-bold tabular-nums text-ok">
                    {new Date(String(change.after)).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                  </span>
                  <span className="flex-1 text-[12.5px] font-bold">ゴール：{change.entityLabel} {change.fieldLabel}</span>
                </li>
              </ol>
            </Card>
          )}

          {/* 確認ゲート */}
          {proposed.length > 0 && (
            <Card className="border-signal/40 bg-signal-soft p-5">
              <p className="text-[13.5px] font-bold text-signal">{proposed.length}件のタスクが提案されています</p>
              <p className="mt-1 text-[12.5px] text-ink-2">
                内容を確認して確定してください。確定するまでタスク一覧には反映されません。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="lg" onClick={() => {
                  const withDue = tasks.map((t) => ({
                    ...t,
                    dueAt: schedule?.proposals.find((p) => p.taskId === t.id)?.dueAt ?? t.dueAt,
                  }));
                  dispatch({ type: "addTasks", tasks: withDue });
                  dispatch({ type: "confirmTasks", taskIds: withDue.map((t) => t.id) });
                }}>
                  この内容で {proposed.length} 件を作成する
                </Button>
                <Button variant="secondary" onClick={() => { dispatch({ type: "addTasks", tasks }); }}>
                  提案のまま保存する
                </Button>
              </div>
            </Card>
          )}

          {proposed.length === 0 && existing.length > 0 && (
            <Card className="border-ok/40 bg-ok-soft p-4">
              <p className="text-[13px] font-bold text-ok">派生タスクは確定済みです</p>
              <Link href="/tasks?view=derived" className="mt-1 inline-block text-[12.5px] text-brand hover:underline">
                タスク一覧で確認する →
              </Link>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
