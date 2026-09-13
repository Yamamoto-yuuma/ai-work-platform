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
 * 同じ軸の下に期限の位置だけ印を出し、一覧は下に並べる。
 * 持っていない情報を、あるように見せない。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/adapters/memory/store";
import { formatMinutes } from "@/core/model/task-draft";
import { effectiveStatus } from "@/core/task/dependency";
import type { Task } from "@/core/model/types";
import { Button, Panel } from "./primitives";

/** 表示する時間帯。これより早い・遅い予定は端に寄せる */
const START_HOUR = 8;
const END_HOUR = 20;
const HOURS = END_HOUR - START_HOUR;

/** 目盛りを打つ時刻。2 時間おき */
const TICKS = Array.from({ length: HOURS / 2 + 1 }, (_, i) => START_HOUR + i * 2);

/**
 * Google カレンダーの色。
 *
 * 予定に色を付けている人は、名前を読む前に色で見分けている。
 * こちらで別の色に置き換えると、カレンダーと見比べたときに別物になる。
 * 番号と色の対応は Google 側が決めているものをそのまま持つ
 * （GAS は番号だけを渡してくる。あちらで色名を決めると、
 * Google がパレットを変えたときに食い違うため）。
 */
const CALENDAR_COLORS: Record<string, string> = {
  "1": "#7986cb", // ラベンダー
  "2": "#33b679", // セージ
  "3": "#8e24aa", // ブドウ
  "4": "#e67c73", // フラミンゴ
  "5": "#f6bf26", // バナナ
  "6": "#f4511e", // ミカン
  "7": "#039be5", // クジャク
  "8": "#616161", // グラファイト
  "9": "#3f51b5", // ブルーベリー
  "10": "#0b8043", // バジル
  "11": "#d50000", // トマト
};

interface DayEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** カレンダー上で付けた色の番号。色を変えていない予定は空 */
  color?: string;
}

interface EventsResponse {
  ok?: boolean;
  events?: DayEvent[];
  /** カレンダーそのものの色。色を変えていない予定はこれで表示される */
  calendarColor?: string;
  error?: string;
  notConfigured?: boolean;
}

/**
 * 読み込みの状態。
 *
 * 以前は、読めるまでと読めなかったときを同じ「何も出さない」で扱っていた。
 * カレンダーを見に行くのに数秒かかるので、そのあいだ HOME からこの枠ごと
 * 消えてしまい、動いていないのか壊れているのか分からなかった。
 *
 *   loading … 読みに行っている。枠は出したまま、中身の形だけ見せる
 *   ready   … 読めた
 *   failed  … 読めなかった。黙って消さず、理由と読み直す口を出す
 *   off     … そもそも連携していない。ここだけは何も出さない
 *             （設定していないことは毎日知らせる用件ではない。
 *              つなぐ場所は［管理］の「Integrations」にある）
 */
type Load =
  | { kind: "loading" }
  | { kind: "ready"; events: DayEvent[]; calendarColor?: string }
  | { kind: "failed"; message: string }
  | { kind: "off" };

/**
 * 予定を塗る色。
 *
 * 番号 → カレンダーの色 → それも無ければ画面の差し色、の順に落とす。
 * 古い GAS を貼ったままだと色は返ってこないので、そのときも今までどおり出る。
 */
function colorOf(event: DayEvent, calendarColor: string | undefined): string {
  const byId = event.color ? CALENDAR_COLORS[event.color] : undefined;
  if (byId !== undefined) return byId;
  if (calendarColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(calendarColor)) return calendarColor;
  return "var(--color-brand)";
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

/** 時刻を 0〜100 の位置に。目盛りと帯で同じ計算を使う */
function pctOfHour(hour: number): number {
  return ((hour - START_HOUR) / HOURS) * 100;
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
 * これから空いている時間帯（分）。
 *
 * 合計の分数だけを出しても、それが 30 分の細切れ 4 つなのか、
 * 2 時間まとまって空いているのかで、入れられる仕事が変わる。
 * 合計と一緒に、どこが空いているかも返す。
 *
 * 重なっている予定を二重に数えないよう、先に区間をつなげてから引く。
 */
function freeIntervals(
  events: { from: number; to: number }[],
  now: Date,
): { from: number; to: number }[] {
  const dayEnd = END_HOUR * 60;
  // 過ぎた時間は空きに数えない。「あと何分あるか」を出すため
  const from = Math.max(START_HOUR * 60, now.getHours() * 60 + now.getMinutes());
  if (from >= dayEnd) return [];

  const merged: { from: number; to: number }[] = [];
  for (const e of [...events].sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last !== undefined && e.from <= last.to) last.to = Math.max(last.to, e.to);
    else merged.push({ ...e });
  }

  const gaps: { from: number; to: number }[] = [];
  let cursor = from;
  for (const m of merged) {
    const s = Math.max(m.from, from);
    const t = Math.min(m.to, dayEnd);
    if (t <= s) continue;
    if (s > cursor) gaps.push({ from: cursor, to: s });
    cursor = Math.max(cursor, t);
  }
  if (cursor < dayEnd) gaps.push({ from: cursor, to: dayEnd });
  return gaps;
}

/** 分（0 時起点）を軸の位置（0〜100）に直す */
function pctOfMinutes(minutes: number): number {
  return Math.min(100, Math.max(0, ((minutes / 60 - START_HOUR) / HOURS) * 100));
}

function minutesLabel(gap: { from: number; to: number }): string {
  const p = (n: number) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  return `${p(gap.from)}–${p(gap.to)} 空き`;
}

export function TodayTimeline({ now }: { now: Date }) {
  const { state } = useStore();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  /** 読み直しのたびに数える。前の応答が遅れて返ってきても上書きさせない */
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setLoad({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

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
        if (r.ok === true && Array.isArray(r.events)) {
          setLoad({
            kind: "ready",
            events: r.events,
            calendarColor: typeof r.calendarColor === "string" ? r.calendarColor : undefined,
          });
        } else if (r.notConfigured === true) {
          setLoad({ kind: "off" });
        } else {
          setLoad({
            kind: "failed",
            message:
              typeof r.error === "string" && r.error.trim() !== ""
                ? r.error
                : "カレンダーの予定を受け取れませんでした。",
          });
        }
      })
      .catch(() => {
        if (alive) setLoad({ kind: "failed", message: "カレンダーへ問い合わせできませんでした。" });
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

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
    if (load.kind !== "ready") return [];
    return load.events
      .filter((e) => !e.allDay && e.title.trim().length > 0)
      .map((e) => ({
        title: e.title,
        start: new Date(e.start),
        end: new Date(e.end),
        color: colorOf(e, load.calendarColor),
      }))
      .filter((e) => !isNaN(e.start.getTime()) && !isNaN(e.end.getTime()))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [load]);

  const gaps = useMemo(
    () =>
      freeIntervals(
        blocks.map((b) => ({
          from: b.start.getHours() * 60 + b.start.getMinutes(),
          to: b.end.getHours() * 60 + b.end.getMinutes(),
        })),
        now,
      ),
    [blocks, now],
  );
  const free = gaps.reduce((sum, g) => sum + (g.to - g.from), 0);

  /* 見積のあるものだけ合計する。無いものは数に入れず、件数で添える */
  const estimated = todayTasks.reduce((sum, t) => sum + (minutesOf(t) ?? 0), 0);
  const withoutEstimate = todayTasks.filter((t) => minutesOf(t) === undefined).length;
  const short = estimated > free;

  /* つないでいないときだけ、HOME に何も足さない */
  if (load.kind === "off") return null;

  if (load.kind === "loading") {
    return (
      <Panel title="Schedule" note="今日の予定と、今日締めのタスク">
        <div className="px-4 py-4">
          <Ruler />
          {/*
            読み込み中も、出来上がりと同じ形の枠を置く。
            枠ごと消えていると、動いていないのか壊れているのか分からない。
            中身は分からないので、帯の場所だけを灰色で示す（予定を偽らない）。
          */}
          <div className="relative mt-1 overflow-hidden rounded-[5px] border border-line-soft bg-surface py-1.5">
            <Gridlines />
            <div className="relative flex animate-pulse flex-col gap-1">
              {[
                { left: 8, width: 10 },
                { left: 26, width: 16 },
                { left: 52, width: 12 },
              ].map((b) => (
                <div key={b.left} className="relative h-[22px]">
                  <div
                    className="absolute top-0 h-full rounded-[3px] bg-surface-2"
                    style={{ left: `${b.left}%`, width: `${b.width}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 rounded-[5px] bg-surface-2 px-3 py-2 text-[13.5px] text-ink-3">
            カレンダーを読み込んでいます…
          </p>
        </div>
      </Panel>
    );
  }

  if (load.kind === "failed") {
    return (
      <Panel title="Schedule" note="今日の予定と、今日締めのタスク">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">カレンダーを読み込めませんでした</p>
            {/* 何が起きたかをそのまま出す。番号だけでは直す場所が分からない */}
            <p className="mt-0.5 text-[12px] leading-[1.7] text-ink-3">{load.message}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={reload}>
            読み込み直す
          </Button>
        </div>
      </Panel>
    );
  }

  const nowPct = positionOf(now) * 100;
  const showNow = now.getHours() >= START_HOUR && now.getHours() < END_HOUR;

  return (
    <Panel title="Schedule" note="今日の予定と、今日締めのタスク">
      <div className="px-4 py-4">
        <div className="relative">
          <Ruler />

          <div className="relative mt-1 overflow-hidden rounded-[5px] border border-line-soft bg-surface py-1.5">
            <Gridlines />

            {blocks.length === 0 ? (
              <div className="relative px-2 py-3 text-center text-[12px] text-ink-3">
                今日は予定が入っていません
              </div>
            ) : (
              <div className="relative flex flex-col gap-1">
                {blocks.map((b, i) => {
                  const left = positionOf(b.start) * 100;
                  const right = positionOf(b.end) * 100;
                  const width = Math.max(1.5, right - left);
                  /*
                    名前は帯の中に入れない。
                    12 時間を 1 本に収めているので、1 時間の予定の帯は指2本ぶんしかない。
                    そこへ文字を入れると「運営…」で切れて、何の予定か分からなくなる。
                    予定は 1 件ずつ別の行に置いているから、帯の外に出しても重ならない。

                    右に置けるなら右に置く。読む向きと同じで、帯から名前へ目が流れる。
                    右が詰まっていて、かつ左のほうが広いときだけ左へ回す。
                    狭い画面では夕方の予定の右がほとんど残らず、
                    「16:00 …」と時刻だけになって何の予定か分からなくなる。
                  */
                  const roomRight = 100 - right;
                  const labelOnLeft = roomRight < 30 && left > roomRight;
                  return (
                    <div
                      key={`${b.title}-${i}`}
                      className="relative h-[22px]"
                      title={`${hhmm(b.start)}–${hhmm(b.end)} ${b.title}`}
                    >
                      <div
                        className="absolute top-0 h-full min-w-[3px] rounded-r-[3px]"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          // カレンダーで付けた色。面は薄く、始まりの縁だけ濃く出す
                          background: `color-mix(in srgb, ${b.color} 22%, white)`,
                          borderLeft: `2px solid ${b.color}`,
                        }}
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

            {/*
              下の 1 行に、これから空いている時間帯と、今日締めの期限を重ねる。

              「空き 1時間10分」と数字だけ出しても、それが細切れなのか
              まとまっているのかが分からない。軸の上に出せば、
              どの予定とどの予定の間が空いているかがそのまま読める。
              期限の印を同じ行に置くのは、その空きに間に合うかを見るため。
            */}
            {(gaps.length > 0 || todayTasks.length > 0) && (
              <div className="relative mt-1.5 h-[9px]">
                {gaps.map((g) => (
                  <div
                    key={g.from}
                    className="absolute top-[3px] h-[4px] rounded-full bg-ok/40"
                    style={{
                      left: `${pctOfMinutes(g.from)}%`,
                      width: `${Math.max(0.4, pctOfMinutes(g.to) - pctOfMinutes(g.from))}%`,
                    }}
                    title={minutesLabel(g)}
                  />
                ))}
                {/*
                  タスクは時間帯を持たない（あるのは期限だけ）。帯にはせず印だけを打つ。
                  色は下の一覧と同じにして、どの行のことかを目で結べるようにする。
                */}
                {todayTasks.map((t) => (
                  <span
                    key={t.id}
                    className={`absolute top-0 h-[9px] w-[3px] -translate-x-1/2 rounded-full ${dotOf(t, state.tasks)}`}
                    style={{ left: `${positionOf(new Date(t.dueAt as string)) * 100}%` }}
                    title={`${hhmm(new Date(t.dueAt as string))} 締め：${t.title}`}
                  />
                ))}
              </div>
            )}

            {/* いま。どこまで来ているかが分かれば、残りを見積もれる */}
            {showNow && (
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-danger"
                style={{ left: `${nowPct}%` }}
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
          {/*
            軸に出している空きの帯と同じ色を、文の中にも小さく置く。
            凡例を別に作らなくても、緑の線が何を指しているかが分かる。
          */}
          いまから{END_HOUR}時まで{" "}
          <span
            className="mx-0.5 inline-block h-[4px] w-4 rounded-full bg-ok/40 align-middle"
            aria-hidden="true"
          />{" "}
          空き <b className="tabular-nums">{formatMinutes(free)}</b>
          {" ／ "}
          今日締め <b className="tabular-nums">{todayTasks.length}件</b>
          {/*
            見積の話は 1 回で言い切る。
            以前は「今日締めのタスク 2件」と「2件は見積が未設定です」を
            続けて出していたので、同じ 2 件のことなのか別なのかが読めなかった。
          */}
          {todayTasks.length > 0 && withoutEstimate === todayTasks.length ? (
            <span className="text-ink-3">（見積は未設定）</span>
          ) : estimated > 0 ? (
            <>
              （見積 <span className="tabular-nums">{formatMinutes(estimated)}</span>
              {withoutEstimate > 0 && <span className="text-ink-3">・{withoutEstimate}件は見積なし</span>}）
            </>
          ) : null}
          {short && (
            <>
              <br />
              このままだと <b>{formatMinutes(estimated - free)}</b> ぶん足りません。期限を延ばすか、明日へ回すものを選んでください。
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

/**
 * 時刻の目盛り。
 *
 * 以前は flex で等間隔に置いていたので、数字の位置と帯の位置が少しずつずれていた。
 * 「16:30 の予定」が 16 の目盛りの下に来ていないと、目で時刻を読み取れない。
 * 帯と同じ計算で置く。読み込み中の枠でも同じものを使う。
 */
function Ruler() {
  return (
    <div className="relative h-4 text-[12px] tabular-nums text-ink-3">
      {TICKS.map((h, i) => (
        <span
          key={h}
          className="absolute top-0"
          style={{
            left: `${pctOfHour(h)}%`,
            transform:
              i === 0 ? "none" : i === TICKS.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          {h}
        </span>
      ))}
    </div>
  );
}

/** 目盛りの線。数字だけだと、帯がどの時刻にあるかを目で追えない */
function Gridlines() {
  return (
    <>
      {TICKS.slice(1, -1).map((h) => (
        <div
          key={h}
          className="pointer-events-none absolute inset-y-0 w-px bg-line-soft"
          style={{ left: `${pctOfHour(h)}%` }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/** 手を付けられる状態かどうかを、点の色で示す。軸の上の印と下の一覧で同じ色を使う */
function dotOf(task: Task, all: Task[]): string {
  const status = effectiveStatus(task, all);
  if (status === "blocked") return "bg-ink-3";
  if (task.priority === "urgent") return "bg-danger";
  if (task.priority === "high") return "bg-signal";
  return "bg-brand";
}
