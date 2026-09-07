"use client";

/**
 * Google ToDo リストの取り込み（設定画面）。
 *
 * 読み取りだけ。こちらからは書き戻さない。
 * 取り込むかどうかの判断は core/integration/google-tasks.ts が持ち、
 * ここは押す入口と、結果の見せ方だけを受け持つ。
 *
 * 勝手に取り込まない。押したときだけ動く。
 * 開くたびに黙って増えていると、自分の一覧が自分のものでなくなる。
 */
import { useState } from "react";
import { useStore } from "@/adapters/memory/store";
import { Badge, Button, Card } from "./primitives";
import { newTaskId } from "@/lib/id";
import { describeImport, planImport, type ImportPlan } from "@/core/integration/google-tasks";
import {
  connect, disconnect, fetchTaskLists, fetchTasks, googleClientId, isConnected,
} from "@/adapters/google/tasks";

type Phase = "idle" | "connecting" | "importing";

export function GoogleTasksPanel() {
  const { state, dispatch } = useStore();
  const clientId = googleClientId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

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
      const lists = await fetchTaskLists();
      if (lists.length === 0) { setResult("Google に ToDo リストがありませんでした"); return; }

      // リストごとに計画を立てて、まとめて反映する
      const total: ImportPlan = { created: [], updated: [], untouched: 0, goneOnRemote: [] };
      for (const list of lists) {
        const incoming = await fetchTasks(list.id);
        const plan = planImport({
          incoming, listId: list.id, existing: state.tasks,
          assigneeId: state.currentUserId, now: new Date(), newId: newTaskId,
        });
        total.created.push(...plan.created);
        total.updated.push(...plan.updated);
        total.untouched += plan.untouched;
        total.goneOnRemote.push(...plan.goneOnRemote);
      }

      if (total.created.length > 0) dispatch({ type: "addTasks", tasks: total.created });
      for (const u of total.updated) {
        dispatch({ type: "updateTask", taskId: u.taskId, patch: u.patch });
      }
      setResult(`${lists.length}件のリストから：${describeImport(total)}`);
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
        こちらの変更が Google に書き戻ることはありません。押したときだけ取り込みます。
      </p>

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
      </div>

      {result && (
        <p className="mt-2.5 rounded-lg bg-ok-soft px-3 py-2 text-[12px] text-ok">{result}</p>
      )}
      {error && (
        <p className="mt-2.5 rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>
      )}

      <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-3">
        取り込んだタスクは「連携」の印が付きます。Google 側で消したものは、
        こちらでは自動で消えません（手を加えているかもしれないため、件数だけお知らせします）。
      </p>
    </Card>
  );
}
