"use client";

/**
 * 案内役の黒猫（仕様 §29）。
 *
 * 画面の主役にはしない。既存の情報階層の外側に、小さく1〜2行だけ添える。
 * 文言は core/cat/message.ts が既存データから決めており、ここは表示だけ。
 * 閉じられたら同じ状況では出し直さない。
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

/** 黒猫。装飾は最小限。目だけ色を持たせる */
export function CatAvatar({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 32 32" aria-hidden
      className="shrink-0"
    >
      {/* 耳（先を立てて、小さくても猫と分かるようにする） */}
      <path d="M6.4 14.2 5.2 3.6l7.4 5.6ZM25.6 14.2l1.2-10.6-7.4 5.6Z" fill="var(--color-ink)" />
      {/* 頭 */}
      <ellipse cx="16" cy="18.2" rx="11" ry="9.6" fill="var(--color-ink)" />
      {/* 目。ここだけ色を持たせる */}
      <g fill="var(--color-brand-soft)">
        <ellipse cx="12" cy="17.6" rx="1.6" ry="2.3" />
        <ellipse cx="20" cy="17.6" rx="1.6" ry="2.3" />
      </g>
      {/* 少し未来的に。首もとの細いライン1本だけ */}
      <path d="M11.5 25.2h9" stroke="var(--color-brand)" strokeWidth="1.3" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
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

  if (!message) return null;
  if (dismissed.includes(message.id)) return null;
  const lines = message.lines.filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  return (
    <div
      className={`flex items-start gap-2.5 ${
        tone === "soft" ? "rounded-lg border border-line bg-surface px-3 py-2" : ""
      } ${className}`}
    >
      <CatAvatar />
      <div className="min-w-0 flex-1">
        {lines.map((l, i) => (
          <p key={i} className="text-[12.5px] leading-relaxed text-ink-2">{l}</p>
        ))}
      </div>
      <button
        type="button"
        aria-label="この案内を閉じる"
        onClick={() => { remember(message.id); setDismissed((d) => [...d, message.id]); }}
        className="shrink-0 rounded px-1.5 text-[13px] leading-none text-ink-3 hover:bg-surface-2 hover:text-ink-2"
      >
        ×
      </button>
    </div>
  );
}
