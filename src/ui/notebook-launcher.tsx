"use client";

/**
 * ノートブックへの入口。
 *
 * 資料の本体は Gemini Notebook 側にある。中身は API で取れないので、
 * こちらから開きに行くのが実際の使い方になる。だったらその一手を
 * 一覧の中に埋めず、押すと決まっている場所に大きく置く。
 *
 * 表の1行にしておくと、開くたびに目で探すことになる。
 * 探さないための道具で探させない。
 */
import type { KnowledgeItem } from "@/core/model/types";
import { LOCATION_MARK } from "./icons";

/** Gemini Notebook のトップ。まだ1冊も登録していないときの行き先 */
const NOTEBOOK_HOME = "https://notebooklm.google.com/";

export function NotebookLauncher({
  items, onOpenDetail,
}: {
  /** 置き場所が Gemini Notebook のナレッジ */
  items: KnowledgeItem[];
  /** 題名を押したときに、こちら側の記録を開く */
  onOpenDetail: (id: string) => void;
}) {
  const Mark = LOCATION_MARK.notebooklm;

  if (items.length === 0) {
    /*
      1冊も登録していないとき。
      「登録してください」とだけ言われても、どこから取るのか分からない。
      取りに行く先そのものを出す。
    */
    return (
      <section className="mb-4">
        <a
          href={NOTEBOOK_HOME} target="_blank" rel="noreferrer"
          className="group flex min-h-[68px] items-center gap-3.5 rounded-xl border border-line-soft bg-surface px-5 py-3.5 shadow-card transition-colors hover:border-brand/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Mark />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">Gemini Notebook を開く</span>
            <span className="block text-[12px] text-ink-3">
              ノートブックのURLを置き場所に貼ると、ここに大きく並びます
            </span>
          </span>
          <span className="shrink-0 text-[13.5px] font-medium text-brand">開く ↗</span>
        </a>
      </section>
    );
  }

  return (
    <section className="mb-4">
      <h2 className="mb-2 text-[12px] font-semibold tracking-[.02em] text-ink-3">ノートブック</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((k) => (
          <div
            key={k.id}
            className="group relative flex min-h-[68px] items-center gap-3.5 rounded-xl border border-line-soft bg-surface px-5 py-3.5 shadow-card transition-colors hover:border-brand/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Mark />
            </span>
            <span className="min-w-0 flex-1">
              {/*
                面のどこを押しても向こうへ飛ぶ（::before）。
                大きいボタンなのに端が効かない、を起こさないため。
              */}
              <a
                href={k.location} target="_blank" rel="noreferrer"
                className="block truncate text-[15px] font-semibold text-ink before:absolute before:inset-0"
              >
                {k.title}
              </a>
              <span className="block truncate text-[12px] text-ink-3">Gemini Notebook</span>
            </span>
            <span className="shrink-0 text-[13.5px] font-medium text-brand">開く ↗</span>
            {/*
              こちら側に書いた覚書を読むための小さい出口。
              面の当たり判定より上に置く（z-10）。
            */}
            {(k.body || k.tags.length > 0) && (
              <button
                type="button"
                onClick={() => onOpenDetail(k.id)}
                className="relative z-10 shrink-0 rounded-md border border-line-soft px-2 py-1 text-[12px] text-ink-3 transition-colors hover:border-brand/40 hover:text-brand"
              >
                メモ
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
