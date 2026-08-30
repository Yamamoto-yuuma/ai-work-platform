import Link from "next/link";
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-surface ${className}`}>{children}</div>
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
  brand: "bg-brand-soft text-brand-ink border-brand/30",
  signal: "bg-signal-soft text-signal border-signal/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  ok: "bg-ok-soft text-ok border-ok/30",
  ai: "bg-ai-soft text-ai border-ai/30",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function Button({
  children, onClick, variant = "primary", size = "md", disabled, type = "button", className = "",
  title,
}: {
  children: ReactNode; onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg"; disabled?: boolean; type?: "button" | "submit"; className?: string;
  /** 説明を常時表示しないときの補足。ボタン中心のUIで使う */
  title?: string;
}) {
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-ink border-brand",
    secondary: "bg-surface text-ink hover:bg-surface-2 border-line",
    ghost: "bg-transparent text-ink-2 hover:bg-surface-2 border-transparent",
    danger: "bg-surface text-danger hover:bg-danger-soft border-danger/40",
  };
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-2 text-[13px]", lg: "px-5 py-2.5 text-sm" };
  return (
    <button
      type={type} onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  children, href, variant = "primary", size = "md",
}: { children: ReactNode; href: string; variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" | "lg" }) {
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-ink border-brand",
    secondary: "bg-surface text-ink hover:bg-surface-2 border-line",
    ghost: "bg-transparent text-ink-2 hover:bg-surface-2 border-transparent",
  };
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-2 text-[13px]", lg: "px-5 py-2.5 text-sm" };
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors ${variants[variant]} ${sizes[size]}`}>
      {children}
    </Link>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-3">{children}</p>;
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
