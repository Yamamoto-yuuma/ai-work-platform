"use client";

/**
 * Google ToDo リストの取り込み（設定画面）。
 *
 * 読み取りだけ。こちらからは書き戻さない。
 * 取り込むかどうかの判断は core/integration/google-tasks.ts が持ち、
 * 手順は services/google-import.ts にある。ここは入口と見せ方だけ。
 */
import { useEffect, useState } from "react";
import { useStore } from "@/adapters/memory/store";
import { Badge, Button, Card } from "./primitives";
import { importGoogleTasks } from "@/services/google-import";
import {
  connect, disconnect, googleClientId, isConnected,
} from "@/adapters/google/tasks";
import {
  isAutoSyncOn, readLastImport, rememberLastImport, setAutoSync, type LastImport,
} from "./google-sync-prefs";

type Phase = "idle" | "connecting" | "importing";

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "たった今";
  if (mins < 60) return `${mins}分前`;
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function GoogleTasksPanel() {
  const { state, dispatch } = useStore();
  const clientId = googleClientId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [last, setLast] = useState<LastImport | null>(null);

  // localStorage は描画後に読む（サーバとクライアントで表示を揃えるため）
  useEffect(() => {
    setAuto(isAutoSyncOn());
    setLast(readLastImport());
    setConnected(isConnected());
  }, []);

  const imported = state.tasks.filter((t) => t.external?.service === "google-tasks").length;

  async function onConnect() {
    setError(null); setResult(null); setPhase("connecting");
    try {
      await connect();
      setConnected(isConnected());
    } catch (e) {
      setError(e instanceof Error ? e.message : "接続できませんでした");
    } finally {
      setPhase("idle");
    }
  }

  async function onImport() {
    setError(null); setResult(null); setPhase("importing");
    try {
      const r = await importGoogleTasks({
        existing: state.tasks, assigneeId: state.currentUserId, now: new Date(),
      });
      if (r.plan.created.length > 0) dispatch({ type: "addTasks", tasks: r.plan.created });
      for (const u of r.plan.updated) {
        dispatch({ type: "updateTask", taskId: u.taskId, patch: u.patch });
      }
      rememberLastImport(r.message);
      setLast(readLastImport());
      setResult(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り込めませんでした");
      setConnected(isConnected());
    } finally {
      setPhase("idle");
    }
  }

  /*
    クライアントIDが無いうちは、押せるものを出さない。
    押しても必ず失敗するボタンは、置いてあること自体が誤解を招く。
  */
  if (!clientId) {
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium">Google ToDo リスト</p>
          <Badge tone="neutral">未設定</Badge>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
          使うには、Google Cloud で OAuth クライアントID を作り、
          <code className="mx-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11.5px]">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code>
          として設定する必要があります。設定するとここに接続ボタンが出ます。
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-medium">Google ToDo リスト</p>
        <Badge tone={connected ? "ok" : "neutral"}>{connected ? "接続中" : "未接続"}</Badge>
        {imported > 0 && <Badge tone="brand">取り込み済み {imported}件</Badge>}
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
        Google の ToDo リストをこちらのタスク一覧に取り込みます。読み取りだけで、
        こちらの変更が Google に書き戻ることはありません。
      </p>

      {/*
        自動取り込みの入り切り。
        アプリを開いているあいだだけ動く。閉じているあいだは動かない。
      */}
      <label className="mt-3 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox" checked={auto}
          onChange={(e) => { setAuto(e.target.checked); setAutoSync(e.target.checked); }}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-brand)]"
        />
        <span className="text-[12.5px] leading-relaxed">
          自動で取り込む
          <span className="ml-1.5 text-[11.5px] text-ink-3">
            この画面を開いたときと、開いているあいだ10分ごと。閉じているあいだは動きません
          </span>
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!connected ? (
          <Button size="sm" onClick={onConnect} disabled={phase !== "idle"}>
            {phase === "connecting" ? "接続しています…" : "Google に接続する"}
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={onImport} disabled={phase !== "idle"}>
              {phase === "importing" ? "取り込んでいます…" : "いま取り込む"}
            </Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => { disconnect(); setConnected(false); setResult(null); setError(null); }}
            >
              接続を解除
            </Button>
          </>
        )}
        {last && !result && !error && (
          <span className="text-[11.5px] text-ink-3">最終取り込み {whenLabel(last.at)}</span>
        )}
      </div>

      {result && (
        <p className="mt-2.5 rounded-lg bg-ok-soft px-3 py-2 text-[12px] text-ok">{result}</p>
      )}
      {error && (
        <p className="mt-2.5 rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>
      )}
      {/* 自動で取り込んだ結果も、あとから確かめられるようにしておく */}
      {last && !result && !error && (
        <p className="mt-2.5 text-[11.5px] text-ink-3">{last.message}</p>
      )}

      <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-3">
        取り込んだタスクは「連携」の印が付きます。Google 側で消したものは、
        こちらでは自動で消えません（手を加えているかもしれないため、件数だけお知らせします）。
      </p>
    </Card>
  );
}
