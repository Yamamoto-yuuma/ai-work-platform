"use client";

/**
 * 案内の一言（仕様 §29）。
 *
 * 画面の主役にはしない。既存の情報階層の外側に、小さく1〜2行だけ添える。
 * 文言は core/cat/message.ts が既存データから決めており、ここは表示だけ。
 * 言うことがないときは何も出さない。閉じられたら同じ状況では出し直さない。
 *
 * 絵は置かない。仕事の画面に絵が1つ入るだけで、道具が玩具に見える。
 * 役割（なぜそれが上に来ているかを言う）はそのまま残す。
 */
import { useEffect, useState } from "react";
import type { CatMessage } from "@/core/cat/message";

const DISMISS_KEY = "ai-work-platform:cat-dismissed";

function readDismissed(): string[] {
  try {
    const raw = window.sessionStorage.getItem(DISMISS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function remember(id: string) {
  try {
    const next = Array.from(new Set([...readDismissed(), id])).slice(-40);
    window.sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch {
    // 覚えられなくても表示は続けられる
  }
}

export function CatSays({
  message,
  tone = "plain",
  className = "",
}: {
  message: CatMessage | null;
  /** plain = 地の色 / soft = 淡い枠。置く場所の背景に合わせる */
  tone?: "plain" | "soft";
  className?: string;
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);

  // sessionStorage は描画後に読む（サーバとクライアントで表示を揃えるため）
  useEffect(() => setDismissed(readDismissed()), []);

  const lines = message ? message.lines.filter((l) => l.trim().length > 0) : [];
  const silent = !message || dismissed.includes(message.id) || lines.length === 0;

  // 言うことがなければ何も出さない。猫は情報があるときだけ現れる（仕様 §29-2）
  if (silent) return null;

  return (
    <div
      /*
        絵をやめたので、これが何なのかを見た目に頼らず示す。
        読み上げにも「本文とは別の補足」として伝わる。
      */
      role="note"
      aria-label="案内"
      className={`flex items-start gap-2.5 ${
        tone === "soft" ? "rounded-lg border border-line bg-surface px-3 py-2" : ""
      } ${className}`}
    >
      {/*
        文の左に細い縦線を1本だけ引く。
        本文と地続きに見えないようにするためのもので、飾りではない。
      */}
      <span aria-hidden="true" className="mt-0.5 w-px shrink-0 self-stretch bg-line" />
      <div className="min-w-0 flex-1">
        {lines.map((l, i) => (
          <p key={i} className="text-[13.5px] leading-relaxed text-ink-2">{l}</p>
        ))}
      </div>
      <button
        type="button"
        aria-label="この案内を閉じる"
        onClick={() => { remember(message!.id); setDismissed((d) => [...d, message!.id]); }}
        className="shrink-0 rounded px-1.5 text-[13.5px] leading-none text-ink-3 hover:bg-surface-2 hover:text-ink-2"
      >
        ×
      </button>
    </div>
  );
}
