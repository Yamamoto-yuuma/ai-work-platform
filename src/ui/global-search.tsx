"use client";

/**
 * 画面上部の検索。
 *
 * この道具の目的は「業務を進めるうえで迷わない」こと。
 * 検索も同じで、探し物で迷わないためのものにする。
 *
 * だから結果は、名前だけを並べない。
 * どの業務のものか、いま待ち中か、終わっているか。
 * 選ぶのに要るだけの手がかりを1行に添える。
 * 並べ方（いま動いているものを先に出す）は core/search/find.ts にある。
 *
 * 開いたまま画面を移らない。押したらその場所へ飛ぶ。
 * 検索結果の一覧をもう1画面挟むと、そこでまた迷う。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/adapters/memory/store";
import { useLatestWorkflows } from "./use-navigator";
import { HIT_KIND_LABEL, search, type Hit } from "@/core/search/find";

export function GlobalSearch() {
  const router = useRouter();
  const { state, knowledge } = useStore();
  const workflows = useLatestWorkflows();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => search({
    query: q, tasks: state.tasks, runs: state.runs, workflows, knowledge,
    currentUserId: state.currentUserId,
  }), [q, state.tasks, state.runs, workflows, knowledge, state.currentUserId]);

  // 候補が変われば、選択は先頭に戻す。押す先が入力中にずれない
  useEffect(() => setCursor(0), [q]);

  // 他所を触ったら閉じる
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  /*
    どの画面からでも、キーだけで探し始められるようにする。
    入力欄に居るときは邪魔をしない（本文を打っている最中に奪わない）。
  */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  function go(hit: Hit) {
    setOpen(false);
    setQ("");
    input.current?.blur();
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { setOpen(false); input.current?.blur(); return; }
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % hits.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + hits.length) % hits.length); }
    if (e.key === "Enter") { e.preventDefault(); const h = hits[cursor]; if (h) go(h); }
  }

  const showing = open && q.trim().length > 0;

  return (
    <div ref={box} className="relative w-full max-w-[480px]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13.5px] leading-none text-ink-3"
      >
        ⌕
      </span>
      <input
        ref={input}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="業務・タスク・ナレッジを探す"
        aria-label="探す"
        role="combobox"
        aria-expanded={showing}
        aria-controls="search-results"
        className="field field-sm w-full pl-8"
      />

      {showing && (
        <div
          id="search-results" role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl bg-surface shadow-pop"
        >
          {hits.length === 0 ? (
            <p className="px-4 py-3.5 text-[13.5px] text-ink-3">見つかりませんでした</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {hits.map((h, i) => (
                <li key={`${h.kind}-${h.id}`}>
                  <button
                    type="button" role="option" aria-selected={i === cursor}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(h)}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors ${
                      i === cursor ? "bg-surface-2" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13.5px] ${h.dimmed ? "text-ink-3" : "font-medium"}`}>
                        {h.title}
                      </span>
                      {h.hint && (
                        <span className="mt-0.5 block truncate text-[12px] text-ink-3">{h.hint}</span>
                      )}
                    </span>
                    {/* 何の話かを、色ではなく言葉で示す */}
                    <span className="shrink-0 text-[12px] text-ink-3">{HIT_KIND_LABEL[h.kind]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
