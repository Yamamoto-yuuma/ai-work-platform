"use client";

/**
 * Gmail の見張り。
 *
 * メールの一覧は作らない。それは Gmail の仕事で、ここで真似ると
 * 使いにくい Gmail ができるだけ。出すのは「手を打つ必要があるものが来ている」
 * ことと、そこへ飛ぶ口だけ。本文はこちらへ持ってこない。
 *
 * 見せるのは 2 つ。
 *
 *   自分宛   … To に自分が入っている未読。CC で回ってきた山とは分ける。
 *   返信待ち … 自分が最後に送ったまま、何日も返事が来ていないやり取り。
 *              送ったまま忘れるのが一番痛いので、こちらも同じ場所に出す。
 *
 * 読むのは Apps Script（日報で使っている口をそのまま使う）。
 * 新しい認証は増やさないし、ブラウザから Gmail へは直接つながない。
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Panel } from "./primitives";

/** 届いている 1 件 */
interface InboxMail {
  from: string;
  subject: string;
  at: string;
  days: number;
  url: string;
}

/** 返事を待っている 1 件 */
interface AwaitingMail {
  to: string;
  subject: string;
  at: string;
  days: number;
  url: string;
}

interface MailResponse {
  ok?: boolean;
  inbox?: InboxMail[];
  inboxTotal?: number;
  awaiting?: AwaitingMail[];
  awaitingTotal?: number;
  awaitDays?: number;
  error?: string;
  notConfigured?: boolean;
}

/**
 * 読み込みの状態。Schedule と同じ分け方にする。
 * off（つないでいない）のときだけ、HOME に何も足さない。
 * 設定していないことは、毎日知らせる用件ではない。
 */
type Load =
  | { kind: "loading" }
  | { kind: "ready"; mail: MailResponse }
  | { kind: "failed"; message: string }
  | { kind: "off" };

/*
  前回読んだものの置き場。
  Apps Script を経由するので返ってくるまで数秒かかる。毎回そこを待つと、
  HOME を開くたびに枠が空のままの時間ができる。前のものを先に出してから、
  裏で最新に差し替える。古すぎるものは使わない。
*/
const CACHE_KEY = "ai-work-platform:mail";
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;

interface Cached { mail: MailResponse; savedAt: number }

function readCache(): MailResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return null;
    if (!Array.isArray(parsed.mail?.inbox)) return null;
    return parsed.mail;
  } catch {
    return null;
  }
}

function writeCache(mail: MailResponse): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ mail, savedAt: Date.now() }));
  } catch {
    /* 置けなくても表示には困らない */
  }
}

/** 何日前か。今日と昨日だけは言葉にする */
function agoLabel(days: number): string {
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  return `${days}日前`;
}

function Row({
  who, subject, days, url, warn,
}: {
  who: string; subject: string; days: number; url: string; warn?: boolean;
}) {
  return (
    <li>
      {/*
        押すと Gmail のそのやり取りが開く。別タブにする。
        ここで画面ごと移ると、見ていた HOME から出てしまう。
      */}
      <a
        href={url} target="_blank" rel="noreferrer"
        className="group flex items-baseline gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2"
      >
        <span className="w-[7.5em] shrink-0 truncate text-[12px] text-ink-2">{who || "（差出人不明）"}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] group-hover:text-brand">
          {subject || "（件名なし）"}
        </span>
        <span className={`shrink-0 cell-num text-[11.5px] ${warn ? "text-signal" : "text-ink-3"}`}>
          {agoLabel(days)}
        </span>
      </a>
    </li>
  );
}

export function MailPanel() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  /* 読み直しているあいだも、前の中身は消さない */
  const [staleReason, setStaleReason] = useState<string | null>(null);

  const fetchMail = useCallback((opts?: { keepOld?: boolean }) => {
    if (!opts?.keepOld) setLoad({ kind: "loading" });
    return fetch("/api/daily-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mail" }),
    })
      .then((r) => r.json() as Promise<MailResponse>)
      .then((r) => {
        if (r.ok === true && Array.isArray(r.inbox)) {
          setLoad({ kind: "ready", mail: r });
          setStaleReason(null);
          writeCache(r);
          return;
        }
        if (r.notConfigured === true) { setLoad({ kind: "off" }); return; }
        const message =
          typeof r.error === "string" && r.error.trim() !== ""
            ? r.error
            : "メールの状況を受け取れませんでした。";
        // 出せるものがあるなら消さない。消すと、開くたびに画面が入れ替わる
        if (opts?.keepOld) setStaleReason(message);
        else setLoad({ kind: "failed", message });
      })
      .catch(() => {
        if (opts?.keepOld) setStaleReason("メールの状況を読み直せませんでした。");
        else setLoad({ kind: "failed", message: "メールの状況を読み込めませんでした。" });
      });
  }, []);

  useEffect(() => {
    const cached = readCache();
    const hasSomething = cached !== null;
    if (cached) setLoad({ kind: "ready", mail: cached });
    void fetchMail({ keepOld: hasSomething });
  }, [fetchMail]);

  if (load.kind === "off") return null;

  if (load.kind === "loading") {
    return (
      <Panel title="Mail" note="自分宛と、返事が来ていないもの">
        <div className="flex flex-col gap-1.5 px-4 py-4" aria-hidden>
          {/* 出来上がりと同じ形の枠を置く。枠ごと消えていると、壊れたのか分からない */}
          {[0, 1].map((i) => (
            <div key={i} className="h-[26px] animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      </Panel>
    );
  }

  if (load.kind === "failed") {
    return (
      <Panel title="Mail" note="自分宛と、返事が来ていないもの">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">メールの状況を読み込めませんでした</p>
            {/* 何が起きたかをそのまま出す。番号だけでは直す場所が分からない */}
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{load.message}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void fetchMail()}>読み直す</Button>
        </div>
      </Panel>
    );
  }

  const { inbox = [], awaiting = [], inboxTotal = 0, awaitingTotal = 0, awaitDays = 3 } = load.mail;
  const quiet = inbox.length === 0 && awaiting.length === 0;

  return (
    <Panel
      title="Mail"
      note="自分宛と、返事が来ていないもの"
      action={<Button variant="ghost" size="sm" onClick={() => void fetchMail({ keepOld: true })}>読み直す</Button>}
    >
      <div className="px-2 py-2">
        {staleReason && (
          <p className="mb-1.5 px-2 text-[11.5px] text-ink-3">
            最新に出来ていません（{staleReason}）
          </p>
        )}

        {quiet ? (
          /*
            何も無いことも、出す。枠ごと消すと「読めていないのか、無いのか」が
            分からず、結局 Gmail を開いて確かめることになる。
          */
          <p className="px-2 py-2 text-[12.5px] text-ink-3">
            自分宛の未読はありません。返事待ちのやり取りもありません。
          </p>
        ) : (
          <>
            {inbox.length > 0 && (
              <section className="mb-1">
                <p className="px-2 pb-0.5 text-[11px] font-semibold tracking-[.02em] text-ink-3">
                  自分宛 <span className="cell-num font-normal">{inboxTotal}</span>
                </p>
                <ul className="flex flex-col">
                  {inbox.map((m) => (
                    <Row key={m.url} who={m.from} subject={m.subject} days={m.days} url={m.url} />
                  ))}
                </ul>
                {inboxTotal > inbox.length && (
                  <p className="px-2 pt-0.5 text-[11px] text-ink-3">ほか {inboxTotal - inbox.length}件</p>
                )}
              </section>
            )}

            {awaiting.length > 0 && (
              <section className={inbox.length > 0 ? "mt-2 border-t border-line-soft pt-2" : ""}>
                <p className="px-2 pb-0.5 text-[11px] font-semibold tracking-[.02em] text-ink-3">
                  返信待ち <span className="cell-num font-normal">{awaitingTotal}</span>
                  <span className="ml-1.5 font-normal">（{awaitDays}日以上）</span>
                </p>
                <ul className="flex flex-col">
                  {awaiting.map((m) => (
                    <Row key={m.url} who={m.to} subject={m.subject} days={m.days} url={m.url} warn />
                  ))}
                </ul>
                {awaitingTotal > awaiting.length && (
                  <p className="px-2 pt-0.5 text-[11px] text-ink-3">ほか {awaitingTotal - awaiting.length}件</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
