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
import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleAutoSync } from "./google-auto-sync";
import { GlobalSearch } from "./global-search";
import { NAV_ICON, SettingsIcon } from "./icons";

const NAV = [
  { href: "/", label: "ホーム" },
  { href: "/workflows", label: "業務" },
  { href: "/tasks", label: "タスク" },
  { href: "/daily-report", label: "日報" },
  { href: "/map", label: "マップ" },
  { href: "/knowledge", label: "ナレッジ" },
  { href: "/settings", label: "管理" },
];

/** 左レーンの開閉。作業に関係しない見た目の状態なので、業務データには入れない */
const RAIL_KEY = "ai-work-platform:rail-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, workflows, users } = useStore();

  // localStorage は描画後に読む（サーバとクライアントで表示を揃えるため）
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(readCollapsed()), []);
  function toggleRail() {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(RAIL_KEY, next ? "1" : "0"); } catch { /* 使えなくても畳めればよい */ }
      return next;
    });
  }

  // 左下のユーザーメニュー。設定への入口をここにまとめる
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);
  // 画面を移ったらメニューは閉じる
  useEffect(() => setMenuOpen(false), [pathname]);

  const proposedCount = state.tasks.filter((t) => t.confirmationState === "proposed").length;
  const overdueCount = useMemo(() => {
    const now = new Date();
    return rankActions({
      runs: state.runs, stepRunsByRun: state.stepRunsByRun, workflows,
      tasks: state.tasks, userId: state.currentUserId, now,
    }).filter((a) => a.urgency === "overdue").length;
  }, [state, workflows]);

  // 畳んだときはアイコンだけ。狭い画面はもともとアイコンだけなので変わらない
  const wide = collapsed ? "md:w-[76px] md:items-center md:px-2" : "md:w-[188px] md:items-stretch md:px-3";
  const labelCls = collapsed ? "hidden" : "hidden md:inline";

  return (
    <div className="flex min-h-screen">
      {/*
        Google ToDo リストの自動取り込み。画面には何も出さない。
        クライアントIDが設定されていなければ、通信もしない。
      */}
      <GoogleAutoSync />
      {/*
        左レーン。白で通す。
        紙面よりわずかに明るい純白にして、色ではなく面の違いと細い線で
        本文と分ける。地には淡い滲みを敷いている（rail-wash）。
        滲みは ::before にあるので、中身は relative で上に重ねる。
      */}
      <nav
        className={`rail-wash sticky top-0 flex h-screen w-[76px] shrink-0 flex-col items-center overflow-hidden border-r border-line-soft py-4 text-rail-ink ${wide}`}
        aria-label="メインナビゲーション"
      >
        <div className={`relative mb-4 flex w-full items-center gap-1 ${collapsed ? "md:flex-col md:gap-1.5" : ""}`}>
          {/*
            畳んだときは幅が 76px しかないので、社名を折り返さず頭文字だけ出す。
            どちらの状態でも HOME への入口であることは変えない。
          */}
          <Link href="/" title="AI WORK HUB" className={collapsed ? "" : "min-w-0 px-2 md:px-2.5"}>
            {collapsed ? (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-[12px] font-bold tracking-tight text-brand-ink">
                AI
              </span>
            ) : (
              <span className="block whitespace-nowrap text-[12px] font-bold leading-tight tracking-tight text-brand">
                AI WORK HUB
              </span>
            )}
          </Link>
          {/* 大きい画面では左レーンを畳んで作業領域を広く使える */}
          <button
            type="button"
            onClick={toggleRail}
            aria-label={collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
            aria-expanded={!collapsed}
            title={collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
            className={`hidden shrink-0 rounded-[5px] py-1 text-[13.5px] leading-none text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2 md:block ${
              collapsed ? "px-2" : "ml-auto px-2"
            }`}
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        {/*
          項目だけが独立してスクロールする（Phase 13）。
          ここが伸びても、下のユーザー欄と本文は動かない。
        */}
        <div className="relative flex w-full min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-[13.5px] transition-[background-color,color,box-shadow] duration-150 ${
                  active
                    ? "bg-brand-soft font-semibold text-brand-ink"
                    : "font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  {(() => { const Icon = NAV_ICON[item.href]; return Icon ? <Icon /> : null; })()}
                </span>
                <span className={labelCls}>{item.label}</span>
                {item.href === "/tasks" && proposedCount > 0 && (
                  <span className={`ml-auto rounded-full bg-signal px-1.5 py-0.5 text-[12px] font-bold text-white ${labelCls}`}>
                    {proposedCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="relative hidden w-full shrink-0 border-t border-rail-line pt-3 md:block" ref={menuRef}>
          {overdueCount > 0 && !collapsed && (
            <div className="mb-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-[12px] font-medium text-danger">
              期限超過 {overdueCount}件
            </div>
          )}

          {/* 開いたメニュー。設定への入口をここに集める */}
          {menuOpen && (
            <div className="mb-1.5 overflow-hidden rounded-[5px] border border-line-soft bg-surface shadow-pop">
              <Link
                href="/settings"
                className="block px-3.5 py-2.5 text-[13.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                管理・設定
              </Link>
              {/* 切り替える先が無いときは出さない。押しても何も起きない道を作らない */}
              {users.length > 1 && (
                <Link
                  href="/settings#users"
                  className="block border-t border-line-soft px-3.5 py-2.5 text-[13.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  使う人を切り替える
                </Link>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="設定を開く"
            className={`flex w-full items-center gap-2 rounded-[5px] py-2 text-left text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink ${
              collapsed ? "justify-center px-1" : "px-2.5"
            }`}
          >
            {/*
              自分の名前は出さない。ここは設定への入口であって、
              誰が使っているかを知らせる場所ではない。
              使う人を切り替えたときだけ、メニューの中で確認できればよい。
            */}
            <span className="flex w-4 shrink-0 items-center justify-center"><SettingsIcon /></span>
            {!collapsed && <span className="text-[13.5px]">設定</span>}
          </button>
        </div>
      </nav>

      {/*
        作業する側。左レーンとの間に、常にわずかな隙間を置く。
        レーンを畳むと画面が詰まり、見出しの帯がレーンに接して
        「レーンに食い込んでいる」ように見えるため。
      */}
      <div className="min-w-0 flex-1 md:pl-3">
        {state.simulatedDate && (
          <div className="flex flex-wrap items-center justify-center gap-2 bg-signal px-4 py-1.5 text-center text-[13.5px] text-white">
            <span className="font-medium">
              業務日を {new Date(state.simulatedDate).toLocaleDateString("ja-JP")} として表示しています（デモ用）
            </span>
            <Link href="/settings" className="underline underline-offset-2">設定で戻す</Link>
          </div>
        )}
        {/*
          画面上部の帯。どの画面にいても、ここから探し始められる。
          目的の場所へ直接飛ばすためのもので、検索結果の一覧は挟まない。
          下の見出しの帯（TopBar）と重ならないよう、こちらが上に来る。
        */}
        <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-line-soft bg-paper/95 px-6 backdrop-blur-sm">
          <GlobalSearch />
        </div>
        <main>{children}</main>
      </div>
    </div>
  );
}
