import Link from "next/link";
import type { ReactNode } from "react";

/**
 * AI WORK HUB の共通部品。
 *
 * 画面ごとに装飾を書かず、まとまり・押せるもの・状態の見せ方はここに集める。
 * 考え方は次の3つだけ。
 *
 * 1. 枠線で囲うより、地との明度差とごく薄い影でまとまりを作る。
 *    枠線を並べると画面が網目に見えて、長く見ていると疲れる。
 * 2. 影は1段だけ。触れたときに1段持ち上げ、それ以上は重ねない。
 * 3. 選択中は色の面で示す。線を太くして示さない。
 *
 * 影・角丸の実際の値は globals.css のトークンにある。
 */

export function Card({
  children, className = "", interactive = false, tone = "plain",
}: {
  children: ReactNode;
  className?: string;
  /** 押せるカード。触れたときに1段持ち上げる */
  interactive?: boolean;
  /** 面の役割。plain=紙から浮く白面 / sunken=紙より沈めた面 */
  tone?: "plain" | "sunken";
}) {
  /*
    線で囲わない。白い面と、紙面との明度差と、ごく薄い影で存在を示す。
    枠線は面だけでは境が出ない sunken のときにだけ、淡いものを引く。
  */
  const base = tone === "sunken"
    ? "border border-line-soft bg-surface-2"
    : "bg-surface shadow-card";
  return (
    <div
      className={`rounded-xl ${base} ${
        interactive ? "transition-shadow duration-150 hover:shadow-lift" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

type Tone = "neutral" | "brand" | "signal" | "danger" | "ok" | "ai";

/*
  状態や種別を示す小さな印。
  枠で囲まず、薄い面に落ち着いた文字で置く。丸めすぎない。
  数が並ぶところなので、ひとつひとつが目立つと画面が騒がしくなる。
*/
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  brand: "bg-brand-soft text-brand-ink",
  signal: "bg-signal-soft text-signal",
  danger: "bg-danger-soft text-danger",
  ok: "bg-ok-soft text-ok",
  ai: "bg-ai-soft text-ai",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11px] font-medium leading-5 ${TONE[tone]}`}>
      {children}
    </span>
  );
}

/*
  ボタン。用途で3段に分ける。同じ画面に同じ強さのものを並べない。

  primary   … いま押してほしい操作。青い面で塗る。1画面に基本ひとつ
  secondary … 並ぶ選択肢。白い面に、あるかないかの線
  ghost     … 文字と同じ扱い。枠は持たない
  danger    … 戻せない操作。ふだんは静かで、触れたときだけ赤が差す

  角丸・余白・触れたときの動きは全段で揃える。
  触れると1段浮き、押した瞬間に1px沈む。それ以上は動かさない。
*/
const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[9px] border font-medium " +
  "transition-[background-color,border-color,box-shadow,transform] duration-150 " +
  /*
    押せないときは、薄くするのではなく沈めた面にする。
    薄くするだけだと、色の付いた帯の上に置いたときに文字が読めなくなる。
  */
  "active:translate-y-px disabled:cursor-not-allowed " +
  "disabled:border-transparent disabled:bg-surface-2 disabled:text-ink-3 " +
  "disabled:shadow-none disabled:active:translate-y-0 " +
  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/20";

const BTN_VARIANTS = {
  primary:
    "border-transparent bg-brand text-white shadow-card " +
    "hover:bg-brand-ink hover:shadow-lift",
  secondary:
    "border-line-soft bg-surface text-ink shadow-card " +
    "hover:border-line hover:bg-brand-soft/45 hover:shadow-lift",
  ghost:
    "border-transparent bg-transparent text-ink-2 " +
    "hover:bg-surface-2 hover:text-ink",
  danger:
    "border-transparent bg-surface text-danger shadow-card " +
    "hover:bg-danger-soft hover:shadow-lift",
} as const;

const BTN_SIZES = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-[13px]",
  lg: "px-5 py-2.5 text-sm",
} as const;

export function Button({
  children, onClick, variant = "primary", size = "md", disabled, type = "button", className = "",
  title,
}: {
  children: ReactNode; onClick?: () => void;
  variant?: keyof typeof BTN_VARIANTS;
  size?: keyof typeof BTN_SIZES; disabled?: boolean; type?: "button" | "submit"; className?: string;
  /** 説明を常時表示しないときの補足。ボタン中心のUIで使う */
  title?: string;
}) {
  return (
    <button
      type={type} onClick={onClick} disabled={disabled} title={title}
      className={`${BTN_BASE} ${BTN_VARIANTS[variant]} ${BTN_SIZES[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  children, href, variant = "primary", size = "md",
}: {
  children: ReactNode; href: string;
  variant?: "primary" | "secondary" | "ghost"; size?: keyof typeof BTN_SIZES;
}) {
  return (
    <Link href={href} className={`${BTN_BASE} ${BTN_VARIANTS[variant]} ${BTN_SIZES[size]}`}>
      {children}
    </Link>
  );
}

/**
 * まだ何も無いときの表示。
 * 「無い」ことだけでなく、次に何をすればよいかまで置けるようにする。
 */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-6 py-12 text-center">
      <p className="text-[13px] leading-[1.9] text-ink-2">{children}</p>
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2.5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[21px] font-bold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[13px] leading-[1.85] text-ink-2">{description}</p>}
      </div>
      {action}
    </header>
  );
}

/** 未接続の外部連携を明示するバナー。仕様 §22-3 */
export function NotConnected({ label, phase }: { label: string; phase: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[9px] bg-surface-2 px-3.5 py-2.5 text-[12px] text-ink-3">
      <span className="font-medium text-ink-2">{label} は未接続です</span>
      <span>（{phase} で接続予定。業務の進行は妨げません）</span>
    </div>
  );
}
