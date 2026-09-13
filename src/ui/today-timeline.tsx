"use client";

/**
 * 今日の予定（Schedule）。
 *
 * 「次にやること」は期限の順で決まる。だが期限だけを見ても、それが今日入るのかは
 * 分からない。予定で埋まっていれば入らないし、空いていれば前倒しできる。
 * 1 日の埋まり具合と、今日締めのタスクの量を、同じ場所に出して見比べられるようにする。
 *
 * 予定はカレンダーから取る（日報で使っている Apps Script の口をそのまま使う）。
 * 新しい認証は増やさない。カレンダーを読んでいるのは今までどおり GAS だけで、
 * ブラウザから Google へは直接つながない。
 *
 * タスクは時間帯を持たない（あるのは期限だけ）。予定のように帯では置けないので、
 * 期限の位置に印を出し、一覧は下に並べる。持っていない情報を、あるように見せない。
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/adapters/memory/store";
import { formatMinutes } from "@/core/model/task-draft";
import { effectiveStatus } from "@/core/task/dependency";
import type { Task } from "@/core/model/types";
import { Panel } from "./primitives";

/** 表示する時間帯。これより早い・遅い予定は端に寄せる */
const START_HOUR = 8;
const END_HOUR = 20;
const HOURS = END_HOUR - START_HOUR;

interface DayEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

interface EventsResponse {
  ok?: boolean;
  events?: DayEvent[];
  error?: string;
  notConfigured?: boolean;
}

/**
 * 見積の分数。数として使えるものだけを返す。
 * 取り込んだデータには null が入ることがあり、そのまま足すと「null分」と出る。
 */
function minutesOf(task: Task): number | undefined {
  const m = task.estimatedMinutes;
  return typeof m === "number" && isFinite(m) && m > 0 ? m : undefined;
}

/** その日の中での位置（0〜1）。表示範囲の外は端で止める */
function positionOf(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / 60;
  return Math.min(1, Math.max(0, (hours - START_HOUR) / HOURS));
}

function hhmm(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * 予定で埋まっていない時間（分）。
 * 重なっている予定を二重に数えないよう、先に区間をつなげてから引く。
 */
function freeMinutes(events: { from: number; to: number }[], now: Date): number {
  const dayStart = START_HOUR * 60;
  const dayEnd = END_HOUR * 60;
  // 過ぎた時間は空きに数えない。「あと何分あるか」を出すため
  const from = Math.max(dayStart, now.getHours() * 60 + now.getMinutes());
  if (from >= dayEnd) return 0;

  const merged: { from: number; to: number }[] = [];
  for (const e of [...events].sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last !== undefined && e.from <= last.to) last.to = Math.max(last.to, e.to);
    else merged.push({ ...e });
  }

  let busy = 0;
  for (const m of merged) {
    const s = Math.max(m.from, from);
    const t = Math.min(m.to, dayEnd);
    if (t > s) busy += t - s;
  }
  return Math.max(0, dayEnd - from - busy);
}

export function TodayTimeline({ now }: { now: Date }) {
  const { state } = useStore();
  const [events, setEvents] = useState<DayEvent[] | null>(null);
  /** 連携していない・読めないときは、HOME に何も足さない（毎日出る警告にしない） */
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/daily-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "events" }),
    })
      .then((r) => r.json() as Promise<EventsResponse>)
      .then((r) => {
        if (!alive) return;
        if (r.ok === true && Array.isArray(r.events)) setEvents(r.events);
        else setHidden(true);
      })
      .catch(() => {
        if (alive) setHidden(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  /* 今日が期限で、まだ終わっていないもの */
  const todayTasks = useMemo(
    () =>
      state.tasks
        .filter((t) => t.dueAt !== undefined && isSameDay(new Date(t.dueAt), now))
        .filter((t) => t.status !== "done" && t.status !== "canceled")
        .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))),
    [state.tasks, now],
  );

  const blocks = useMemo(() => {
    if (events === null) return [];
    return events
      .filter((e) => !e.allDay && e.title.trim().length > 0)
      .map((e) => ({ title: e.title, start: new Date(e.start), end: new Date(e.end) }))
      .filter((e) => !isNaN(e.start.getTime()) && !isNaN(e.end.getTime()))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [events]);

  const free = useMemo(
    () =>
      freeMinutes(
        blocks.map((b) => ({
          from: b.start.getHours() * 60 + b.start.getMinutes(),
          to: b.end.getHours() * 60 + b.end.getMinutes(),
        })),
        now,
      ),
    [blocks, now],
  );

  /* 見積のあるものだけ合計する。無いものは数に入れず、件数で添える */
  const estimated = todayTasks.reduce((sum, t) => sum + (minutesOf(t) ?? 0), 0);
  const withoutEstimate = todayTasks.filter((t) => minutesOf(t) === undefined).length;
  const short = estimated > free;

  if (hidden || events === null) return null;

  const nowLeft = positionOf(now) * 100;
  const showNow = now.getHours() >= START_HOUR && now.getHours() < END_HOUR;

  return (
    <Panel title="Schedule" note="今日の予定と、今日締めのタスク">
      <div className="px-4 py-4">
        {/* 目盛り */}
        <div className="relative">
          <div className="flex justify-between text-[12px] tabular-nums text-ink-3">
            {Array.from({ length: HOURS / 2 + 1 }, (_, i) => START_HOUR + i * 2).map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>

          {/* 予定の帯。1 本の軸に重ねず、時間の重なりが分かるよう縦に並べる */}
          <div className="relative mt-1.5 rounded-[3px] bg-surface-2 py-1.5">
            {blocks.length === 0 ? (
              <div className="px-2 py-3 text-center text-[12px] text-ink-3">
                今日は予定が入っていません
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {blocks.map((b, i) => {
                  const left = positionOf(b.start) * 100;
                  const right = positionOf(b.end) * 100;
                  const width = Math.max(1.5, right - left);
                  /*
                    名前は帯の中に入れない。
                    12 時間を 1 本に収めているので、1 時間の予定の帯は指2本ぶんしかない。
                    そこへ文字を入れると「運営…」で切れて、何の予定か分からなくなる。
                    予定は 1 件ずつ別の行に置いているから、帯の外に出しても重ならない。
                    右端に近いものだけ、画面からはみ出さないよう帯の左側に出す。
                  */
                  const labelOnLeft = left > 62;
                  return (
                    <div
                      key={`${b.title}-${i}`}
                      className="relative h-[22px]"
                      title={`${hhmm(b.start)}–${hhmm(b.end)} ${b.title}`}
                    >
                      <div
                        className="absolute top-0 h-full min-w-[3px] rounded-r-[3px] border-l-2 border-brand bg-brand/20"
                        style={{ left: `${left}%`, width: `${width}%` }}
                        aria-hidden="true"
                      />
                      <span
                        className={`absolute top-0 flex h-full items-center overflow-hidden text-[12px] text-ink-2 ${
                          labelOnLeft ? "justify-end pr-1.5" : "pl-1.5"
                        }`}
                        style={
                          labelOnLeft
                            ? { right: `${100 - left}%`, maxWidth: `${left}%` }
                            : { left: `${left + width}%`, maxWidth: `${Math.max(0, 100 - left - width)}%` }
                        }
                      >
                        <span className="truncate">
                          <span className="tabular-nums text-ink-3">{hhmm(b.start)}</span> {b.title}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* いま。どこまで来ているかが分かれば、残りを見積もれる */}
            {showNow && (
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-danger"
                style={{ left: `${nowLeft}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </div>

        {/* 足りているかどうか。ここが「先にどれをやるか」を決める材料になる */}
        <p
          className={`mt-3 rounded-[5px] px-3 py-2 text-[13.5px] leading-[1.8] ${
            short ? "bg-signal-soft text-signal" : "bg-surface-2 text-ink-2"
          }`}
        >
          残りの空き <b className="tabular-nums">{formatMinutes(free)}</b>
          {" ／ "}
          今日締めのタスク <b className="tabular-nums">{todayTasks.length}件</b>
          {estimated > 0 && <> （見積 {formatMinutes(estimated)}）</>}
          {short && (
            <>
              <br />
              このままだと <b>{formatMinutes(estimated - free)}</b> ぶん足りません。期限を延ばすか、明日へ回すものを選んでください。
            </>
          )}
          {withoutEstimate > 0 && (
            <>
              <br />
              <span className="text-ink-3">{withoutEstimate}件は見積が未設定です（合計には入れていません）。</span>
            </>
          )}
        </p>

        {todayTasks.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {todayTasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-[13.5px]">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotOf(t, state.tasks)}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {minutesOf(t) !== undefined && (
                  <span className="shrink-0 tabular-nums text-[12px] text-ink-3">
                    {formatMinutes(minutesOf(t) as number)}
                  </span>
                )}
                <span className="shrink-0 tabular-nums text-[12px] text-ink-3">
                  {t.dueAt ? hhmm(new Date(t.dueAt)) : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/** 手を付けられる状態かどうかを、点の色で示す */
function dotOf(task: Task, all: Task[]): string {
  const status = effectiveStatus(task, all);
  if (status === "blocked") return "bg-ink-3";
  if (task.priority === "urgent") return "bg-danger";
  if (task.priority === "high") return "bg-signal";
  return "bg-brand";
}
