"use client";

/**
 * 右から出る詳細。
 *
 * 一覧から離れずに中身を見るためのもの。画面を移ってしまうと、
 * 戻ってきたときに「どこを見ていたか」を毎回思い出すことになる。
 *
 * 中身そのものは持たない。何を出すかは呼ぶ側が決める。
 * ここが受け持つのは「開いている／閉じる」だけ。
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function Drawer({
  open, onClose, title, subtitle, children, footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  /** 下に貼り付ける操作。並べる数は絞る */
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Escape で閉じる。開いているあいだは後ろの画面を動かさない
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 開いた直後は中身の先頭に焦点を移す。読み上げでも開いたことが分かる
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* 後ろを押したら閉じる。閉じ方を1つに限定しない */}
      <div className="drawer-veil" onClick={onClose} aria-hidden="true" />
      <div
        className="drawer" role="dialog" aria-modal="true" aria-label={title}
        ref={panel} tabIndex={-1}
      >
        <div className="flex items-start gap-3 border-b border-line-soft px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14.5px] font-bold leading-snug">{title}</h2>
            {subtitle && <div className="mt-1 text-[11.5px] text-ink-3">{subtitle}</div>}
          </div>
          <button
            type="button" onClick={onClose} aria-label="閉じる" title="閉じる（Esc）"
            className="shrink-0 rounded-[5px] px-2 py-1 text-[15px] leading-none text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
