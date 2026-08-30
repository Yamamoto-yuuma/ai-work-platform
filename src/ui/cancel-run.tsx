"use client";

/**
 * 業務の中止（仕様 §6-4）。
 *
 * 「完了」とは別の終わり方であることを明示し、理由を必ず記録する。
 * 確認するまでストアは書き換えない。既存の RunStatus / WorkEvent を使い、
 * 中止専用のモデルは作らない。
 */
import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { Badge, Button, Card, LinkButton } from "./primitives";
import { effectiveStatus } from "@/core/task/dependency";
import { TASK_STATUS_LABEL } from "@/core/model/task-labels";
import { runLabel, subjectOf } from "@/core/model/run-label";
import type { WorkRun, WorkflowDefinition } from "@/core/model/types";

export function CancelRunPanel({
  run, def, onClose,
}: {
  run: WorkRun;
  def: WorkflowDefinition;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // 中止しても残るタスク。中止によって自動的には片付かないことを先に示す
  const openTasks = state.tasks.filter(
    (t) => t.runId === run.id && t.status !== "done" && t.status !== "canceled",
  );

  function proceed() {
    if (!reason.trim()) {
      setError("中止する理由を入力してください");
      return;
    }
    setError(null);
    setConfirming(true);
  }

  function cancelRun() {
    dispatch({ type: "cancelRun", runId: run.id, reason: reason.trim() });
    onClose();
  }

  return (
    <Card className="mt-4 shadow-pop">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-danger-soft px-5 py-3">
        <div>
          <h3 className="text-[14px] font-bold text-danger">この業務を中止する</h3>
          <p className="mt-0.5 text-[12px] text-ink-2">
            完了ではなく、途中でやめた記録として残ります。確定するまで何も変わりません。
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>閉じる</Button>
      </header>

      <div className="flex flex-col gap-4 p-5">
        <section className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px]">
          <p><span className="text-ink-3">対象：</span><span className="font-medium">{runLabel(run)}</span>{subjectOf(run) ? `（${def.name}）` : ""}</p>
          <p className="mt-1 text-ink-2">
            中止すると、残りのSTEPは実行できなくなります。完了済みのSTEPの記録は残ります。
          </p>
        </section>

        {openTasks.length > 0 && (
          <section>
            <h4 className="mb-1 text-[12px] font-bold text-ink-3">
              この業務に紐づく未完了のタスク（{openTasks.length}件）
            </h4>
            <p className="mb-2 text-[11.5px] leading-relaxed text-ink-3">
              中止してもタスクは自動では片付きません。不要なものはタスク側で個別に判断してください。
            </p>
            <ul className="flex flex-col gap-1">
              {openTasks.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tasks/${t.id}`}
                    className="flex items-center gap-3 rounded-lg border border-line-soft bg-surface px-3.5 py-2 shadow-card text-[12.5px] hover:border-brand"
                  >
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <Badge tone="neutral">{TASK_STATUS_LABEL[effectiveStatus(t, state.tasks)]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div>
          <label className="mb-1.5 block text-[13px] font-medium" htmlFor="cancel-reason">
            中止する理由<span className="ml-1.5 text-[11px] text-danger">必須</span>
          </label>
          <textarea
            id="cancel-reason" rows={2} value={reason}
            onChange={(e) => { setReason(e.target.value); setError(null); setConfirming(false); }}
            placeholder="例：顧客が検討を取り下げたため／別部署へ引き継いだため"
            className="field"
          />
          {error && <p className="mt-1.5 text-[12.5px] text-danger">{error}</p>}
        </div>

        {confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft px-3.5 py-3">
            <p className="w-full text-[12.5px] font-bold text-danger">
              この業務を中止します。元に戻すことはできません。
            </p>
            <Button variant="danger" onClick={cancelRun}>中止を確定</Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>やめる</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button variant="danger" onClick={proceed}>中止の内容を確認</Button>
            <Button variant="secondary" onClick={onClose}>この業務を続ける</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** 中止済みの業務に出す説明。完了画面とは明確に別物にする */
export function CanceledRunNotice({ run }: { run: WorkRun }) {
  const { state, users } = useStore();
  const event = [...state.workEvents]
    .reverse()
    .find((e) => e.runId === run.id && e.type === "run.canceled");
  const reason = typeof event?.payload.reason === "string" ? event.payload.reason : undefined;
  const actor = users.find((u) => u.id === event?.actor);
  const remaining = state.tasks.filter(
    (t) => t.runId === run.id && t.status !== "done" && t.status !== "canceled",
  );

  return (
    <Card className="overflow-hidden">
      <header className="border-b border-line bg-surface-2 px-5 py-4">
        <p className="text-[11px] font-bold tracking-wide text-ink-3">業務中止</p>
        <h2 className="mt-1 text-[20px] font-bold tracking-tight">{runLabel(run)}</h2>
        <p className="mt-1 text-[13px] text-ink-2">この業務は中止されています。STEPの実行はできません。</p>
      </header>

      <div className="flex flex-col gap-4 p-5">
        <dl className="flex flex-col gap-2 text-[13px]">
          {reason && (
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-[12px] text-ink-3">理由</dt>
              <dd className="min-w-0 flex-1">{reason}</dd>
            </div>
          )}
          {event && (
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-[12px] text-ink-3">中止日時</dt>
              <dd className="min-w-0 flex-1 tabular-nums">
                {new Date(event.createdAt).toLocaleString("ja-JP", {
                  month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
                })}
                {actor ? `（${actor.name}）` : ""}
              </dd>
            </div>
          )}
        </dl>

        {remaining.length > 0 && (
          <section>
            <h3 className="mb-2 text-[12px] font-bold text-ink-3">
              この業務に残っているタスク（{remaining.length}件）
            </h3>
            <ul className="flex flex-col gap-1">
              {remaining.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tasks/${t.id}`}
                    className="flex items-center gap-3 rounded-lg border border-line-soft bg-surface px-3.5 py-2 shadow-card text-[12.5px] hover:border-brand hover:bg-brand-soft"
                  >
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <Badge tone="neutral">{TASK_STATUS_LABEL[effectiveStatus(t, state.tasks)]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <LinkButton href={`/map/${run.id}`} variant="secondary" size="sm">この業務のマップを見る</LinkButton>
          <LinkButton href="/tasks" variant="secondary" size="sm">タスク一覧へ</LinkButton>
          <LinkButton href="/" size="sm">HOMEへ戻る</LinkButton>
        </div>
      </div>
    </Card>
  );
}
