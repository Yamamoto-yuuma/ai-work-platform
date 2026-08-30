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
  /** 面の役割。plain=通常 / sunken=一段沈めた補助面 */
  tone?: "plain" | "sunken";
}) {
  const base = tone === "sunken"
    ? "border-line-soft bg-surface-2"
    : "border-line-soft bg-surface shadow-card";
  return (
    <div
      className={`rounded-xl border ${base} ${
        interactive ? "transition-shadow duration-150 hover:shadow-lift" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[15px] font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

type Tone = "neutral" | "brand" | "signal" | "danger" | "ok" | "ai";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  brand: "bg-brand-soft text-brand-ink border-brand/25",
  signal: "bg-signal-soft text-signal border-signal/25",
  danger: "bg-danger-soft text-danger border-danger/25",
  ok: "bg-ok-soft text-ok border-ok/25",
  ai: "bg-ai-soft text-ai border-ai/25",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 ${TONE[tone]}`}>
      {children}
    </span>
  );
}

/*
  ボタン。
  主操作だけを面で塗り、それ以外は地に近づけて静かにする。
  押せることは、触れたときの持ち上がりと、押した瞬間の沈み込みで示す。
*/
const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium " +
  "transition-[background-color,border-color,box-shadow,transform] duration-150 " +
  "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 " +
  "disabled:shadow-none disabled:active:translate-y-0 " +
  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/25";

const BTN_VARIANTS = {
  primary: "border-brand bg-brand text-white shadow-card hover:bg-brand-ink hover:shadow-lift",
  secondary: "border-line bg-surface text-ink shadow-card hover:border-brand/40 hover:bg-surface-2 hover:shadow-lift",
  ghost: "border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border-danger/35 bg-surface text-danger shadow-card hover:border-danger/60 hover:bg-danger-soft hover:shadow-lift",
} as const;

const BTN_SIZES = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-[13px]",
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
    <div className="rounded-xl border border-line-soft bg-surface-2 px-6 py-9 text-center">
      <p className="text-[13px] leading-relaxed text-ink-2">{children}</p>
      {action && <div className="mt-3.5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">{description}</p>}
      </div>
      {action}
    </header>
  );
}

/** 未接続の外部連携を明示するバナー。仕様 §22-3 */
export function NotConnected({ label, phase }: { label: string; phase: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-3">
      <span className="font-medium text-ink-2">{label} は未接続です</span>
      <span>（{phase} で接続予定。業務の進行は妨げません）</span>
    </div>
  );
}
