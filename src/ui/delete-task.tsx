"use client";

/**
 * タスクを消す操作。
 *
 * 「完了」とは別物として扱う。完了は済んだ記録として残るもので、
 * 削除は存在自体が要らなかったものを記録ごと消すもの。
 * 間違えて作ったタスクを自分で片付けられるようにするための入口。
 *
 * 一覧と詳細で同じものを使う。押した場所で挙動が変わらないようにする。
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/adapters/memory/store";
import { Button } from "./primitives";
import type { Task } from "@/core/model/types";

export function DeleteTaskButton({
  task, size = "sm", onDeleted,
}: {
  task: Task;
  size?: "sm" | "md";
  /** 詳細画面など、消えたあとに行き先が要る場合 */
  onDeleted?: () => void;
}) {
  const { dispatch } = useStore();
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  // 確認を出したまま他所を触ったら閉じる。押しっぱなしにしない
  useEffect(() => {
    if (!asking) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setAsking(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAsking(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [asking]);

  function remove() {
    dispatch({ type: "deleteTask", taskId: task.id });
    setAsking(false);
    onDeleted?.();
  }

  if (!asking) {
    return (
      <Button
        variant="ghost" size={size}
        title="このタスクを消します。完了とは別で、記録ごと無くなります"
        onClick={() => setAsking(true)}
      >
        削除
      </Button>
    );
  }

  return (
    <span ref={box} className="inline-flex flex-wrap items-center gap-1.5">
      {/* 何が消えるのかを名前で示してから確定させる */}
      <span className="text-[11.5px] text-ink-2">「{task.title}」を消しますか？</span>
      <Button variant="danger" size={size} onClick={remove}>削除する</Button>
      <Button variant="ghost" size={size} onClick={() => setAsking(false)}>やめる</Button>
    </span>
  );
}
