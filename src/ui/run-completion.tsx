"use client";

/**
 * 業務完了時の着地（仕様 §32）。
 * 完了して終わりではなく、何が残ったのかと次に取るべき行動を示す。
 */
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useNextAction, useNow } from "@/ui/use-navigator";
import { remainingLabel, urgencyOf } from "@/core/context/resolver";
import { blockingPredecessors, effectiveStatus } from "@/core/task/dependency";
import { TASK_STATUS_LABEL } from "@/core/model/task-labels";
import { Badge, Card, LinkButton } from "./primitives";
import type { WorkRun, WorkflowDefinition } from "@/core/model/types";
import type { RunView } from "@/ui/use-navigator";
import { runLabel } from "@/core/model/run-label";

export function RunCompletion({
  run, def, view,
}: {
  run: WorkRun;
  def: WorkflowDefinition;
  view: RunView;
}) {
  const { state } = useStore();
  const { next } = useNextAction();
  const now = useNow();

  // この業務から生まれたタスク（STEP由来・派生の双方）
  const produced = state.tasks
    .filter((t) => t.runId === run.id && t.confirmationState !== "rejected")
    .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  const open = produced.filter((t) => t.status !== "done" && t.status !== "canceled");

  const executed = view.stepRuns.filter((sr) => sr.status === "done").length;
  const skipped = view.stepRuns.filter((sr) => sr.status === "skipped").length;

  const nextHref =
    next.kind === "step" && next.runId ? `/navigator/${next.runId}`
    : next.kind === "review-proposals" ? "/tasks?view=proposed"
    : next.kind === "task" && next.taskId ? `/tasks/${next.taskId}`
    : "/workflows";

  return (
    <div className="flex flex-col gap-4">
      {/* 完了したこと */}
      <Card className="border-ok/40 bg-ok-soft p-6">
        <p className="text-[11px] font-bold tracking-wide text-ok">業務完了</p>
        <h2 className="mt-1.5 text-[19px] font-bold">{runLabel(run)}</h2>
        <p className="mt-1 text-[13px] text-ink-2">{def.name}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
          <span>{executed} ステップを実施{skipped > 0 && `（条件により ${skipped} 件をスキップ）`}</span>
          {run.completedAt && (
            <span>完了 {new Date(run.completedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </div>
      </Card>

      {/* この業務から残った仕事 */}
      <Card className="p-5">
        <h3 className="text-[13px] font-bold">
          この業務から残った仕事（{open.length}）
        </h3>
        {produced.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-ink-3">この業務から作成されたタスクはありません。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {produced.map((t) => {
              const waiting = blockingPredecessors(t, state.tasks);
              const shown = effectiveStatus(t, state.tasks);
              const u = urgencyOf(t.dueAt, now);
              return (
                <li key={t.id}>
                  <Link
                    href={`/tasks/${t.id}`}
                    className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 transition-colors hover:border-brand"
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] ${t.status === "done" ? "text-ink-3 line-through" : "font-medium"}`}>
                        {t.title}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-ink-3">
                        {TASK_STATUS_LABEL[shown]}
                        {waiting.length > 0 && ` — 待機中：${waiting.map((x) => x.title).join(" / ")}`}
                      </span>
                    </span>
                    {t.confirmationState === "proposed" && <Badge tone="signal">提案中</Badge>}
                    {t.dueAt && (
                      <Badge tone={u === "overdue" ? "danger" : u === "today" ? "signal" : "neutral"}>
                        {new Date(t.dueAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                        （{remainingLabel(new Date(t.dueAt), now)}）
                      </Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* 次に必要な行動 */}
      <Link href={nextHref}>
        <Card className={`p-5 transition-colors ${
          next.urgency === "overdue" ? "border-danger/40 bg-danger-soft hover:border-danger"
          : "border-brand/30 bg-brand-soft hover:border-brand"
        }`}>
          <p className={`text-[11px] font-bold tracking-wide ${next.urgency === "overdue" ? "text-danger" : "text-brand"}`}>
            次に着手すること
          </p>
          <p className={`mt-1.5 text-[15px] font-bold leading-snug ${next.urgency === "overdue" ? "text-danger" : "text-brand-ink"}`}>
            {next.headline}
          </p>
          <p className="mt-1 text-[12.5px] text-ink-2">{next.reason}</p>
        </Card>
      </Link>

      <div className="flex flex-wrap gap-2">
        <LinkButton href={`/map/${run.id}`} variant="secondary">この業務のマップを見る</LinkButton>
        <LinkButton href="/tasks" variant="secondary">タスク一覧へ</LinkButton>
        <LinkButton href="/">HOMEへ戻る</LinkButton>
      </div>
    </div>
  );
}
