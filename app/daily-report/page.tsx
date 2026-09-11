"use client";

/**
 * 日報。
 *
 * カレンダーから日報を作るのも、Chatwork へ送るのも GAS の役目で、
 * この画面はその下書きを見せて、直して、送る合図を出すだけにする。
 * 判断を二重に持たせない（同じ規則が二か所にあると、いつか食い違う）。
 *
 * 送信は戻せないので、押す前に必ず本文を出して確かめてもらう。
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Empty, PageHeader } from "@/ui/primitives";

type ReportType = "day" | "night";

interface ReportState {
  reportType: ReportType;
  exists: boolean;
  body: string;
  generatedAt: string;
  sentAt: string;
  sent: boolean;
}

interface DailyReportState {
  ok: true;
  today: string;
  todayLabel: string;
  nonBusinessDayReason: string | null;
  reports: Record<ReportType, ReportState>;
  /** 送信操作のとき、実際に送ったかどうか */
  sentNow?: boolean;
}

interface FailureState {
  ok: false;
  error: string;
  notConfigured?: boolean;
}

type ApiResult = DailyReportState | FailureState;

const LABEL: Record<ReportType, string> = {
  day: "昼の日報",
  night: "夜の日報",
};
const TIME: Record<ReportType, string> = {
  day: "12:55 頃に作成",
  night: "18:25 頃に作成",
};

/** 中継口へ投げる。画面からは GAS の場所も合言葉も見えない */
async function callApi(payload: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch("/api/daily-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await response.json()) as ApiResult;
}

/** 生成日時から時刻だけを取り出す（2026-09-11T12:55:03+09:00 → 12:55） */
function timeOf(timestamp: string): string {
  const matched = /T(\d{2}:\d{2})/.exec(timestamp);
  return matched ? matched[1] : "";
}

export default function DailyReportPage() {
  const [state, setState] = useState<DailyReportState | null>(null);
  const [failure, setFailure] = useState<FailureState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<ReportType, string>>({
    day: "",
    night: "",
  });
  const [notice, setNotice] = useState<string | null>(null);

  /** 受け取った状態を画面に映す。編集中の本文も、届いた本文で置き直す */
  const apply = useCallback((result: ApiResult) => {
    if (result.ok) {
      setState(result);
      setFailure(null);
      setDrafts({
        day: result.reports.day.body,
        night: result.reports.night.body,
      });
    } else {
      setFailure(result);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    callApi({ action: "drafts" })
      .then((result) => {
        if (alive) apply(result);
      })
      .catch((error: unknown) => {
        if (alive)
          setFailure({
            ok: false,
            error: `読み込めませんでした: ${String(error)}`,
          });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apply]);

  /** 一手ぶん実行して、結果を返す（続けて別の操作へ進むかを呼び出し側で決められる） */
  const run = useCallback(
    async (
      key: string,
      payload: Record<string, unknown>,
      done?: string,
    ): Promise<ApiResult | null> => {
      setBusy(key);
      setNotice(null);
      try {
        const result = await callApi(payload);
        apply(result);
        if (result.ok && done) setNotice(done);
        return result;
      } catch (error: unknown) {
        setFailure({
          ok: false,
          error: `通信できませんでした: ${String(error)}`,
        });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [apply],
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-[900px] px-6 pb-8">
        <PageHeader
          title="日報"
          description="カレンダーの予定から作った下書きを、確かめてから Chatwork へ送ります。"
        />
        <Empty>読み込んでいます…</Empty>
      </div>
    );
  }

  if (failure?.notConfigured) {
    return (
      <div className="mx-auto max-w-[900px] px-6 pb-8">
        <PageHeader
          title="日報"
          description="カレンダーの予定から作った下書きを、確かめてから Chatwork へ送ります。"
        />
        <Empty>
          <span className="mx-auto block w-full max-w-[42ch] text-left">
            日報の連携先がまだ設定されていません。
            <br />
            Apps Script をウェブアプリとして公開し、その URL と合言葉を環境変数
            <code className="mx-1 break-all rounded bg-surface px-1 py-0.5 font-mono text-[11px]">
              DAILY_REPORT_GAS_URL
            </code>
            <code className="mr-1 break-all rounded bg-surface px-1 py-0.5 font-mono text-[11px]">
              DAILY_REPORT_SECRET
            </code>
            に設定してください。
          </span>
        </Empty>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[900px] px-6 pb-8">
      <PageHeader
        title="日報"
        description="カレンダーの予定から作った下書きを、確かめてから Chatwork へ送ります。"
        action={
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => void run("reload", { action: "drafts" })}
          >
            最新の状態にする
          </Button>
        }
      />

      {failure && (
        <div className="mb-4 rounded-[5px] bg-danger-soft px-3.5 py-2.5 text-[12px] leading-[1.8] text-danger">
          {failure.error}
        </div>
      )}

      {notice && (
        <div className="mb-4 rounded-[5px] bg-ok-soft px-3.5 py-2.5 text-[12px] text-ok">
          {notice}
        </div>
      )}

      {state && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
            <span className="font-medium text-ink">{state.todayLabel}</span>
            {state.nonBusinessDayReason !== null && (
              <Badge tone="neutral">
                {state.nonBusinessDayReason}のため自動作成はされません
              </Badge>
            )}
          </div>

          <div className="flex flex-col gap-5">
            {(["day", "night"] as const).map((reportType) => {
              const report = state.reports[reportType];
              const edited = drafts[reportType];
              const changed = report.exists && edited !== report.body;
              const working = busy !== null;

              return (
                <Card key={reportType}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[14px] font-bold">
                        {LABEL[reportType]}
                      </h2>
                      {report.sent ? (
                        <Badge tone="ok">
                          送信済み
                          {report.sentAt ? ` ${timeOf(report.sentAt)}` : ""}
                        </Badge>
                      ) : report.exists ? (
                        <Badge tone="brand">未送信</Badge>
                      ) : (
                        <Badge tone="neutral">下書きなし</Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-ink-3">
                      {report.exists && report.generatedAt
                        ? `${timeOf(report.generatedAt)} に作成`
                        : TIME[reportType]}
                    </span>
                  </div>

                  {report.exists ? (
                    <>
                      <textarea
                        id={`daily-report-${reportType}`}
                        className="mt-3 h-64 w-full resize-y rounded-[5px] border border-line bg-surface px-3 py-2.5 font-mono text-[12px] leading-[1.8] text-ink outline-none focus:border-brand"
                        value={edited}
                        readOnly={report.sent}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [reportType]: event.target.value,
                          }))
                        }
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          disabled={working || report.sent}
                          onClick={() => {
                            void (async () => {
                              if (
                                !window.confirm(
                                  `${LABEL[reportType]}を Chatwork へ送信します。\n\n${edited}\n\nこの内容で送信しますか？`,
                                )
                              ) {
                                return;
                              }
                              // 編集したまま送ると、画面と送信内容が食い違う。先に保存する
                              if (changed) {
                                const saved = await run(`save-${reportType}`, {
                                  action: "save",
                                  reportType,
                                  body: edited,
                                });
                                if (!saved || !saved.ok) return;
                              }
                              const result = await run(`send-${reportType}`, {
                                action: "send",
                                reportType,
                              });
                              if (result?.ok) {
                                setNotice(
                                  result.sentNow === false
                                    ? `${LABEL[reportType]}はすでに送信済みでした。送信していません。`
                                    : `${LABEL[reportType]}を Chatwork へ送信しました。`,
                                );
                              }
                            })();
                          }}
                        >
                          Chatwork へ送信
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={working || report.sent || !changed}
                          onClick={() =>
                            void run(
                              `save-${reportType}`,
                              { action: "save", reportType, body: edited },
                              "本文を保存しました。",
                            )
                          }
                        >
                          {changed ? "編集を保存" : "保存済み"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={working || report.sent}
                          onClick={() => {
                            if (
                              changed &&
                              !window.confirm(
                                "編集した内容は消えます。作り直しますか？",
                              )
                            )
                              return;
                            void run(
                              `rebuild-${reportType}`,
                              { action: "rebuild", reportType },
                              "最新のカレンダーで作り直しました。",
                            );
                          }}
                        >
                          作り直す
                        </Button>
                        {changed && (
                          <span className="text-[11px] text-ink-3">
                            未保存の変更があります
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="mt-3">
                      <Empty
                        action={
                          <Button
                            disabled={working}
                            onClick={() =>
                              void run(
                                `rebuild-${reportType}`,
                                { action: "rebuild", reportType },
                                `${LABEL[reportType]}の下書きを作りました。`,
                              )
                            }
                          >
                            下書きを作る
                          </Button>
                        }
                      >
                        まだ下書きがありません（{TIME[reportType]}）。
                      </Empty>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <p className="mt-5 text-[11px] leading-[1.9] text-ink-3">
            自動で作られるのは下書きまでです。Chatwork
            へ投稿されるのは、ここで送信を押したときだけです。
            送信した日報は取り消せません。
          </p>
        </div>
      )}
    </div>
  );
}
