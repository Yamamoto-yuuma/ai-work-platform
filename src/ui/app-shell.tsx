"use client";

/**
 * グローバルレイアウト。
 * サイドナビは6項目まで（仕様 §25-1）。機能名を並べない。
 * 「メール」「文章作成」は業務STEPの中に出るため、ナビには置かない。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/adapters/memory/store";
import { rankActions } from "@/core/context/next-action";
import { useMemo } from "react";

const NAV = [
  { href: "/", label: "HOME", icon: "⌂" },
  { href: "/workflows", label: "業務", icon: "▷" },
  { href: "/tasks", label: "タスク", icon: "☑" },
  { href: "/map", label: "マップ", icon: "⁂" },
  { href: "/knowledge", label: "ナレッジ", icon: "▤" },
  { href: "/settings", label: "管理", icon: "⚙" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, workflows, currentUser } = useStore();

  const proposedCount = state.tasks.filter((t) => t.confirmationState === "proposed").length;
  const overdueCount = useMemo(() => {
    const now = new Date();
    return rankActions({
      runs: state.runs, stepRunsByRun: state.stepRunsByRun, workflows,
      tasks: state.tasks, userId: state.currentUserId, now,
    }).filter((a) => a.urgency === "overdue").length;
  }, [state, workflows]);

  return (
    <div className="flex min-h-screen">
      <nav className="sticky top-0 flex h-screen w-[76px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-4 md:w-[188px] md:items-stretch md:px-3">
        <Link href="/" className="mb-4 px-2 md:px-2.5">
          <div className="text-[11px] font-bold leading-tight tracking-tight text-brand">
            業務<br className="md:hidden" />ナビ
          </div>
          <div className="hidden text-[10px] text-ink-3 md:block">Work Navigator</div>
        </Link>

        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
                active ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              <span className="w-4 text-center text-[15px] leading-none">{item.icon}</span>
              <span className="hidden md:inline">{item.label}</span>
              {item.href === "/tasks" && proposedCount > 0 && (
                <span className="ml-auto hidden rounded-full bg-signal px-1.5 py-0.5 text-[10px] font-bold text-white md:inline">
                  {proposedCount}
                </span>
              )}
            </Link>
          );
        })}

        <div className="mt-auto hidden border-t border-line pt-3 md:block">
          {overdueCount > 0 && (
            <div className="mb-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-[11px] font-medium text-danger">
              期限超過 {overdueCount}件
            </div>
          )}
          <div className="px-2.5 text-[11px] text-ink-3">{currentUser.name}</div>
          <div className="px-2.5 text-[10px] text-ink-3">{currentUser.team}</div>
        </div>
      </nav>

      <div className="min-w-0 flex-1">
        {state.simulatedDate && (
          <div className="flex flex-wrap items-center justify-center gap-2 bg-signal px-4 py-1.5 text-center text-[12px] text-white">
            <span className="font-medium">
              業務日を {new Date(state.simulatedDate).toLocaleDateString("ja-JP")} として表示しています（デモ用）
            </span>
            <Link href="/settings" className="underline underline-offset-2">設定で戻す</Link>
          </div>
        )}
        <main>{children}</main>
      </div>
    </div>
  );
}
