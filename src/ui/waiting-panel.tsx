"use client";

/**
 * 相手ボールの切り替え（core/task/waiting）。
 *
 * タスク一覧の右パネルと詳細ページの両方から使う。
 * 状態を変える操作が画面ごとに違うと、同じタスクが画面によって
 * 別の状態に見えることが起きる。入口はここ1つにする。
 *
 * 出すのは「誰を」「いつから」の2つだけ。
 * 催促の履歴や督促回数までは持たない。自分ひとりで使うものなので、
 * 数えて報告する相手がいない。
 */
import { useState } from "react";
import { Button } from "./primitives";
import { isStaleWait, isWaiting, waitingDayLabel, WAITING_STALE_DAYS, WAITING_STATUS } from "@/core/task/waiting";
import type { Task } from "@/core/model/types";

export function WaitingSwitch({
  task, now, onChange,
}: {
  task: Task;
  now: Date;
  /** 状態と待ち相手をまとめて渡す。waitingSince は store が押す */
  onChange: (patch: Partial<Task>) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [who, setWho] = useState("");

  if (task.status === "done" || task.status === "canceled") return null;

  if (isWaiting(task)) {
    const days = waitingDayLabel(task, now);
    const stale = isStaleWait(task, now);
    return (
      <div className={`rounded-lg px-3.5 py-2.5 ${stale ? "bg-danger-soft" : "bg-signal-soft"}`}>
        <p className={`text-[13.5px] font-medium ${stale ? "text-danger" : "text-ink-2"}`}>
          相手待ち{days && `（${days}）`}
          {task.waitingFor && <span className="ml-1.5 font-normal">— {task.waitingFor}</span>}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
          {stale
            ? `${WAITING_STALE_DAYS}日以上動いていません。催促するか、こちらで進められることが無いか見直す頃です。`
            : "自分の手は空いています。着手候補には出ません。"}
        </p>
        <div className="mt-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onChange({ status: "todo" })}
          >
            返ってきた
          </Button>
        </div>
      </div>
    );
  }

  if (!asking) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => { setAsking(true); setWho(""); }}
      >
        相手待ちにする
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5">
      <label className="block text-[13.5px] font-medium" htmlFor="waiting-for">
        誰を待ちますか
        <span className="ml-1.5 text-[12px] text-ink-3">任意</span>
      </label>
      <input
        id="waiting-for"
        type="text"
        value={who}
        onChange={(e) => setWho(e.target.value)}
        placeholder="例：先方の担当者／経理／上長"
        aria-label="待っている相手"
        className="field field-sm mt-1.5"
        autoFocus
      />
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
        待ち始めた日はここで記録します。何日待っているかは一覧の状態欄に出ます。
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            onChange({ status: WAITING_STATUS, waitingFor: who.trim() || undefined });
            setAsking(false);
          }}
        >
          相手に投げた
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>やめる</Button>
      </div>
    </div>
  );
}
