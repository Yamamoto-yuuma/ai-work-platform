"use client";

/**
 * 業務の「待ち」。
 *
 * 相手の状態を管理する機能ではない。
 * 「自分が今は作業を進められないので一旦止め、自分が次に確認する日を決める」状態。
 *
 * 既存の RunStatus="paused" と WorkEvent を使い、待ち専用のモデルは作らない。
 * システムが勝手に active へ戻すことはなく、確認日が来たら HOME に出るだけ。
 */
import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useNow } from "@/ui/use-navigator";
import { Badge, Button, Card, LinkButton } from "./primitives";
import { effectiveStatus } from "@/core/task/dependency";
import { TASK_STATUS_LABEL } from "@/core/model/task-labels";
import { remainingLabel, urgencyOf } from "@/core/context/resolver";
import type { WorkRun, WorkflowDefinition } from "@/core/model/types";
import { runLabel, subjectOf } from "@/core/model/run-label";

/** 入力欄の表示形式はブラウザ任せなので、日本語表記を必ず添える */
function formatJaDate(value: string): string {
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}

function toDateInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

/** 日付入力を、その日の終業時刻の ISO へ */
function fromDateInput(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}

/** 営業日で n 日後。土日は確認日にしない */
function addBusinessDaysFrom(now: Date, days: number): string {
  const d = new Date(now);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) remaining -= 1;
  }
  return toDateInput(d.toISOString());
}

/**
 * 確認日の状態。
 * 色だけに頼らないよう、必ず文言を持たせる（仕様 §26-6）。
 * label は短い残り日数、headline は状態の名前。用途に応じて使い分ける。
 */
export function checkStatusOf(waitingUntil: string | undefined, now: Date): {
  overdue: boolean;
  dueToday: boolean;
  /** 「3日超過」「今日まで」「あと5日」など */
  label: string;
  /** 「確認期限超過」「今日が確認予定日」。通常時は空 */
  headline: string;
} {
  if (!waitingUntil) {
    return { overdue: false, dueToday: false, label: "確認日未設定", headline: "確認日未設定" };
  }
  const u = urgencyOf(waitingUntil, now);
  const label = remainingLabel(new Date(waitingUntil), now);
  if (u === "overdue") return { overdue: true, dueToday: false, label, headline: "確認期限超過" };
  if (u === "today") return { overdue: false, dueToday: true, label, headline: "今日が確認予定日" };
  return { overdue: false, dueToday: false, label, headline: "" };
}

// --- 待ちにする ---------------------------------------------------------------
export function WaitRunPanel({
  run, def, onClose,
}: {
  run: WorkRun;
  def: WorkflowDefinition;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const now = useNow();
  const [waitingFor, setWaitingFor] = useState("");
  const [until, setUntil] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const openTasks = state.tasks.filter(
    (t) => t.runId === run.id && t.status !== "done" && t.status !== "canceled",
  );

  function validate(): string[] {
    const found: string[] = [];
    if (!waitingFor.trim()) found.push("何を待っているかを入力してください");
    if (!until) found.push("次回いつ確認するかを入力してください");
    else if (new Date(`${until}T23:59:59`) < now) found.push("次回確認日には今日以降の日付を指定してください");
    return found;
  }

  function proceed() {
    const found = validate();
    if (found.length > 0) { setErrors(found); return; }
    setErrors([]);
    setConfirming(true);
  }

  function apply() {
    dispatch({
      type: "pauseRun", runId: run.id,
      waitingFor: waitingFor.trim(), waitingUntil: fromDateInput(until),
    });
    onClose();
  }

  const change = (fn: () => void) => { fn(); setErrors([]); setConfirming(false); };

  return (
    <Card className="mt-4 border-signal/40">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-5 py-3">
        <div>
          <h3 className="text-[14px] font-bold">この業務を待ちにする</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            作業を一旦止めます。確定するまで何も変わりません。
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>閉じる</Button>
      </header>

      <div className="flex flex-col gap-4 p-5">
        <section className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px]">
          <p>
            <span className="text-ink-3">対象：</span>
            <span className="font-medium">{runLabel(run)}</span>{subjectOf(run) ? `（${def.name}）` : ""}
          </p>
          <p className="mt-1 text-ink-2">
            ここまでの進捗は保持されます。再開すると、止めたSTEPから続けられます。
          </p>
        </section>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium" htmlFor="wait-for">
            何を待っていますか<span className="ml-1.5 text-[11px] text-danger">必須</span>
          </label>
          <input
            id="wait-for" type="text" value={waitingFor}
            onChange={(e) => change(() => setWaitingFor(e.target.value))}
            placeholder="例：先方からの回答"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
          />
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            例：顧客からの回答／見積システムの処理／上長への確認の返事／自分で後日あらためて確認
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium" htmlFor="wait-until">
            次回いつ確認しますか<span className="ml-1.5 text-[11px] text-danger">必須</span>
          </label>
          <input
            id="wait-until" type="date" value={until}
            onChange={(e) => change(() => setUntil(e.target.value))}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
          />
          {until && <p className="mt-1.5 text-[11.5px] text-ink-3">{formatJaDate(until)}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { label: "3営業日後", days: 3 },
              { label: "1週間後", days: 5 },
              { label: "2週間後", days: 10 },
            ].map((o) => (
              <Button
                key={o.days} variant="secondary" size="sm"
                onClick={() => change(() => setUntil(addBusinessDaysFrom(now, o.days)))}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>

        {openTasks.length > 0 && (
          <section>
            <h4 className="mb-1 text-[12px] font-bold text-ink-3">
              この業務に紐づく未完了のタスク（{openTasks.length}件）
            </h4>
            <p className="mb-2 text-[11.5px] leading-relaxed text-ink-3">
              待ちにしてもタスクは止まりません。個別に判断してください。
            </p>
            <ul className="flex flex-col gap-1">
              {openTasks.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tasks/${t.id}`}
                    className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2 text-[12.5px] hover:border-brand"
                  >
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <Badge tone="neutral">{TASK_STATUS_LABEL[effectiveStatus(t, state.tasks)]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {errors.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2.5">
            {errors.map((e, i) => <li key={i} className="text-[12.5px] text-danger">・{e}</li>)}
          </ul>
        )}

        {confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-signal/40 bg-signal-soft px-3.5 py-3">
            <p className="w-full text-[12.5px] leading-relaxed text-ink">
              <strong className="font-bold">{formatJaDate(until)}</strong> まで
              「<strong className="font-bold">{waitingFor.trim()}</strong>」を待ちます。
              確認日になると、HOMEの「今日確認する」に出ます。
            </p>
            <Button onClick={apply}>待ちを確定</Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>やめる</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button onClick={proceed}>待ちの内容を確認</Button>
            <Button variant="secondary" onClick={onClose}>作業を続ける</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// --- 待ち中の表示 -------------------------------------------------------------
export function WaitingRunNotice({ run }: { run: WorkRun }) {
  const { state, dispatch, workflows } = useStore();
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [waitingFor, setWaitingFor] = useState(run.waitingFor ?? "");
  const [until, setUntil] = useState(toDateInput(run.waitingUntil));
  const [error, setError] = useState<string | null>(null);

  const status = checkStatusOf(run.waitingUntil, now);
  const def =
    workflows.find((w) => w.key === run.workflowKey && w.version === run.workflowVersion) ??
    workflows.find((w) => w.key === run.workflowKey);
  const stoppedAt = run.currentStepKeys
    .map((k) => def?.steps.find((s) => s.key === k)?.title)
    .filter(Boolean)
    .join(" / ");
  const event = [...state.workEvents].reverse().find(
    (e) => e.runId === run.id && e.type === "run.paused",
  );

  function keepWaiting() {
    if (!waitingFor.trim()) { setError("何を待っているかを入力してください"); return; }
    if (!until) { setError("次回いつ確認するかを入力してください"); return; }
    setError(null);
    // 待ちのまま、確認日と理由だけを更新する
    dispatch({
      type: "pauseRun", runId: run.id,
      waitingFor: waitingFor.trim(), waitingUntil: fromDateInput(until),
    });
    setEditing(false);
  }

  return (
    <Card className="overflow-hidden">
      <header className={`border-b border-line px-5 py-4 ${status.overdue ? "bg-danger-soft" : "bg-surface-2"}`}>
        <p className={`text-[11px] font-bold tracking-wide ${status.overdue ? "text-danger" : "text-ink-3"}`}>
          {status.overdue ? "待ち中・確認期限超過" : status.dueToday ? "待ち中・今日が確認予定日" : "待ち中"}
        </p>
        <h2 className="mt-1 text-[20px] font-bold tracking-tight">{runLabel(run)}</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          この業務は待ち中です。確認して、まだ待つか作業を再開するかを決めてください。
        </p>
      </header>

      <div className="flex flex-col gap-4 p-5">
        <dl className="flex flex-col gap-2 text-[13px]">
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-[12px] text-ink-3">待っているもの</dt>
            <dd className="min-w-0 flex-1 font-medium">{run.waitingFor ?? "（未設定）"}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-[12px] text-ink-3">次回確認</dt>
            <dd className="min-w-0 flex-1">
              <span className="font-medium tabular-nums">
                {run.waitingUntil ? formatJaDate(run.waitingUntil) : "（未設定）"}
              </span>
              <span className={`ml-2 text-[12px] ${status.overdue ? "font-bold text-danger" : "text-ink-2"}`}>
                {status.headline ? `${status.headline}・${status.label}` : status.label}
              </span>
            </dd>
          </div>
          {stoppedAt && (
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-[12px] text-ink-3">止めたSTEP</dt>
              <dd className="min-w-0 flex-1">{stoppedAt}</dd>
            </div>
          )}
          {event && (
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-[12px] text-ink-3">待ち開始</dt>
              <dd className="min-w-0 flex-1 tabular-nums text-ink-2">
                {new Date(event.createdAt).toLocaleString("ja-JP", {
                  month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
                })}
              </dd>
            </div>
          )}
        </dl>

        {editing ? (
          <section className="rounded-lg border border-signal/40 bg-signal-soft p-4">
            <p className="mb-3 text-[12.5px] font-bold text-signal">まだ待つ：次回確認日を決め直します</p>
            <label className="mb-1.5 block text-[12.5px] font-medium" htmlFor="wait-for-edit">何を待っているか</label>
            <input
              id="wait-for-edit" type="text" value={waitingFor}
              onChange={(e) => { setWaitingFor(e.target.value); setError(null); }}
              className="mb-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
            />
            <label className="mb-1.5 block text-[12.5px] font-medium" htmlFor="wait-until-edit">次回いつ確認するか</label>
            <input
              id="wait-until-edit" type="date" value={until}
              onChange={(e) => { setUntil(e.target.value); setError(null); }}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
            />
            {until && <p className="mt-1.5 text-[11.5px] text-ink-3">{formatJaDate(until)}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {[{ label: "3営業日後", days: 3 }, { label: "1週間後", days: 5 }, { label: "2週間後", days: 10 }].map((o) => (
                <Button
                  key={o.days} variant="secondary" size="sm"
                  onClick={() => { setUntil(addBusinessDaysFrom(now, o.days)); setError(null); }}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={keepWaiting}>この内容で待ち続ける</Button>
              <Button variant="secondary" onClick={() => { setEditing(false); setError(null); }}>やめる</Button>
            </div>
          </section>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button onClick={() => dispatch({ type: "resumeRun", runId: run.id })}>作業を再開する</Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>まだ待つ（確認日を変える）</Button>
          </div>
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
