"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useLatestWorkflows } from "@/ui/use-navigator";
import { Badge, Card, Cells, LinkButton, Row, RowHead, RowList, Tabs, TopBar } from "@/ui/primitives";
import { runProgress } from "@/core/flow/engine";
import { WORK_KIND_LABEL, describeStart } from "@/core/workflow/start-trigger";
import { runLabel, subjectOf } from "@/core/model/run-label";

/* 見出し行と各行で同じ列幅を使う。ここがずれると表に見えなくなる */
const RUN_TEMPLATE = "minmax(0,1fr) 190px 84px 80px";
const WF_TEMPLATE = "minmax(0,1fr) 64px 76px 64px 168px 48px";
const STOPPED_TEMPLATE = "minmax(0,1fr) 80px";

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

  /*
    カテゴリは切り替えで選ぶ。全部を縦に積むと、業務が増えるほど
    目的のものまでスクロールが伸びる。

    停止中はタブに入れない。タブにすると、業務を停止した瞬間に
    今見ている一覧から消えるだけになり、止まったのか失敗したのかが
    分からない。下に節として置いて、止めた結果がその場で見えるようにする。
  */
  const TABS = [
    { key: "all", label: "すべて", count: published.length },
    ...categories.map((c) => ({ key: c, label: c, count: published.filter((w) => w.category === c).length })),
  ];
  const [tab, setTab] = useState<string>("all");
  const listed = tab === "all" ? published : published.filter((w) => w.category === tab);

  return (
    <div className="mx-auto max-w-[1180px] px-6 pb-8">
      <TopBar
        title="業務"
        action={<LinkButton href="/workflows/new">＋ 業務を登録</LinkButton>}
      >
        {published.length + stopped.length > 0 && (
          <Tabs items={TABS} value={tab} onChange={setTab} />
        )}
      </TopBar>

      {/* 進行中。今どこまで進んでいるかを、業務の一覧より先に置く */}
      {myActiveRuns.length > 0 && (
        <section className="mb-7">
          {/* HOME と同じ語彙にする（仕様 §26-5）。待ち中もここに含まれる */}
          <h2 className="mb-2 text-[12.5px] font-bold">進行中の業務（{myActiveRuns.length}）</h2>
          <RowList>
            <RowHead template={RUN_TEMPLATE}>
              <span>対象</span>
              <span>業務</span>
              <span>状態</span>
              <span>進捗</span>
            </RowHead>
            {myActiveRuns.map((run) => {
              const def = all.find((w) => w.key === run.workflowKey);
              const p = def ? runProgress(def, run, state.stepRunsByRun[run.id] ?? []) : { index: 0, total: 0, done: 0 };
              return (
                <Row key={run.id}>
                  <Cells template={RUN_TEMPLATE}>
                    {/* 名前そのものをリンクにし、当たり判定だけ行全体に広げる */}
                    <Link
                      href={`/navigator/${run.id}`}
                      className="cell-clip text-[13px] font-medium before:absolute before:inset-0"
                    >
                      {runLabel(run)}
                    </Link>
                    {/* 対象を持たない業務では業務名が対象と同じになるので繰り返さない */}
                    <span className="cell-clip text-[12px] text-ink-3">{subjectOf(run) ? def?.name ?? "" : ""}</span>
                    <span className="relative">
                      {run.status === "paused"
                        ? <Badge tone="signal">待ち中</Badge>
                        : <Badge tone="neutral">進行中</Badge>}
                    </span>
                    <span className="cell-clip cell-num text-[12px] text-ink-2">STEP {p.index}/{p.total}</span>
                  </Cells>
                </Row>
              );
            })}
          </RowList>
        </section>
      )}

      {published.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[14px] font-bold">業務が未登録です</p>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[12.5px] leading-relaxed text-ink-2">
            名前とSTEPの並びだけで登録できます。
          </p>
          <div className="mt-4 flex justify-center">
            <LinkButton href="/workflows/new">＋ 業務を登録</LinkButton>
          </div>
        </Card>
      ) : (
        <section>
          <RowList>
            <RowHead template={WF_TEMPLATE}>
              <span>業務名</span>
              <span>STEP</span>
              <span>目安</span>
              <span>実行</span>
              <span>開始条件</span>
              <span>版</span>
            </RowHead>
            {listed.map((w) => {
              const runCount = state.runs.filter((r) => r.workflowKey === w.key).length;
              const start = (w.startSchedules?.some((sc) => sc.enabled)
                || (w.startTrigger && w.startTrigger.kind !== "manual"))
                ? describeStart(w).join("／")
                : "自分で開始";
              return (
                <Row key={w.key}>
                  <Cells template={WF_TEMPLATE}>
                    <span className="cell-clip flex items-center gap-1.5">
                      {/* 名前そのものをリンクにし、当たり判定だけ行全体に広げる */}
                      <Link
                        href={`/workflows/${w.key}`}
                        className="cell-clip text-[13px] font-medium before:absolute before:inset-0"
                      >
                        {w.name}
                      </Link>
                      {w.workKind && <Badge tone="neutral">{WORK_KIND_LABEL[w.workKind]}</Badge>}
                      {w.origin === "user" && <Badge tone="brand">自分で登録</Badge>}
                      {w.edges.some((e) => e.condition) && <Badge tone="brand">分岐</Badge>}
                      {w.edges.some((e) => e.joinPolicy === "all") && <Badge tone="brand">並列</Badge>}
                    </span>
                    <span className="cell-clip cell-num text-[12px] text-ink-2">
                      {w.steps.filter((st) => st.componentType !== "branch").length}
                    </span>
                    <span className="cell-clip cell-num text-[12px] text-ink-3">
                      {w.estimatedMinutes ? `${w.estimatedMinutes}分` : "—"}
                    </span>
                    <span className="cell-clip cell-num text-[12px] text-ink-3">{runCount || "—"}</span>
                    {/* 長い条件は切る。全文は業務を開けば読める */}
                    <span className="cell-clip text-[12px] text-ink-3" title={start}>{start}</span>
                    <span className="relative z-10"><Badge tone="ok">v{w.version}</Badge></span>
                  </Cells>
                </Row>
              );
            })}
          </RowList>
        </section>
      )}

      {/*
        停止中。新しく開始できないだけで、記録は残っている。
        止めた直後にここへ現れることで、操作が効いたことが分かる。
      */}
      {stopped.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-1 text-[12.5px] font-bold">停止中の業務（{stopped.length}）</h2>
          <p className="mb-2 text-[12px] text-ink-3">
            新しく開始できません。過去の実行記録はそのまま残っています。
          </p>
          <RowList>
            <RowHead template={STOPPED_TEMPLATE}>
              <span>業務名</span>
              <span>状態</span>
            </RowHead>
            {stopped.map((w) => (
              <Row key={w.key} tone="sunken">
                <Cells template={STOPPED_TEMPLATE}>
                  <Link
                    href={`/workflows/${w.key}`}
                    className="cell-clip text-[13px] font-medium text-ink-2 before:absolute before:inset-0"
                  >
                    {w.name}
                  </Link>
                  <span className="relative z-10"><Badge tone="neutral">停止中</Badge></span>
                </Cells>
              </Row>
            ))}
          </RowList>
        </section>
      )}
    </div>
  );
}
