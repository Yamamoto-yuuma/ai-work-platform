"use client";

/**
 * Google ToDo リストの自動取り込み。
 *
 * アプリを開いたときと、開いているあいだ一定間隔で取り込む。
 * サーバーを持たない作りなので、閉じているあいだは動かない。
 * ただ、閉じているときに最新である必要はない。見るときに揃っていればよい。
 *
 * 見えないところで失敗しても、画面には出さない。
 * 自動でやることが騒がしいと、本来の「本日の作業」が埋もれる。
 * うまくいかないときは、管理画面の「いま取り込む」で理由が出る。
 *
 * クライアントIDが無いときは何もしない。通信もしない。
 */
import { useEffect, useRef } from "react";
import { useStore } from "@/adapters/memory/store";
import { connectSilently, googleClientId, isConnected } from "@/adapters/google/tasks";
import { importGoogleTasks } from "@/services/google-import";
import {
  AUTO_KEY, LAST_KEY, isAutoSyncOn, rememberLastImport,
} from "./google-sync-prefs";

/** 開いているあいだの間隔。短くしても向こうが変わっていなければ何も起きない */
const INTERVAL_MS = 10 * 60 * 1000;
/** 画面に戻ってきたときは、前回から離れていれば取り直す */
const REFRESH_AFTER_MS = 5 * 60 * 1000;

export function GoogleAutoSync() {
  const { state, dispatch } = useStore();
  // 走っている最中に重ねない。取り込みは何度呼んでも安全だが、通信は無駄になる
  const running = useRef(false);
  const lastRun = useRef(0);
  // 反映のたびに effect を張り直さないよう、最新の状態は ref で見る
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!googleClientId()) return;

    let alive = true;

    async function sync() {
      if (!alive || running.current) return;
      if (!isAutoSyncOn()) return;
      running.current = true;
      try {
        if (!isConnected() && !(await connectSilently())) return;
        const s = latest.current;
        const r = await importGoogleTasks({
          existing: s.tasks, assigneeId: s.currentUserId, now: new Date(),
        });
        if (!alive) return;
        if (r.plan.created.length > 0) dispatch({ type: "addTasks", tasks: r.plan.created });
        for (const u of r.plan.updated) {
          dispatch({ type: "updateTask", taskId: u.taskId, patch: u.patch });
        }
        rememberLastImport(r.message);
        lastRun.current = Date.now();
      } catch {
        // 黙って諦める。理由が要るときは管理画面から手で押してもらう
      } finally {
        running.current = false;
      }
    }

    void sync();
    const timer = window.setInterval(() => void sync(), INTERVAL_MS);
    // 別のタブから戻ってきたとき。放置していた間の変更を拾う
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRun.current < REFRESH_AFTER_MS) return;
      void sync();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // dispatch は store から来る安定した関数
  }, [dispatch]);

  return null;
}

export { AUTO_KEY, LAST_KEY };
