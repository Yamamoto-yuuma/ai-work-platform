"use client";

/**
 * ナレッジを消す操作。
 * タスクの削除（delete-task.tsx）と同じ作りにする。
 * 押した場所で挙動が変わらないようにするため、確認は必ず挟む。
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/adapters/memory/store";
import { Button } from "./primitives";
import type { KnowledgeItem } from "@/core/model/types";

export function DeleteKnowledgeButton({
  item, onDeleted,
}: {
  item: KnowledgeItem;
  onDeleted?: () => void;
}) {
  const { dispatch } = useStore();
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  // 確認を出したまま他所を触ったら閉じる
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

  if (!asking) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>削除</Button>
    );
  }

  return (
    <span ref={box} className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-ink-2">「{item.title}」を消しますか？</span>
      <Button
        variant="danger" size="sm"
        onClick={() => { dispatch({ type: "deleteKnowledge", id: item.id }); setAsking(false); onDeleted?.(); }}
      >
        削除する
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>やめる</Button>
    </span>
  );
}
