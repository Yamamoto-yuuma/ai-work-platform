"use client";

/**
 * コンテキストパネル。
 * 「現在のSTEPに関係するものだけ」を出す（仕様 §5 原則3 / §15）。
 * 空のセクションは見出しごと出さない（仕様 §15-4）。
 */
import Link from "next/link";
import type { StepContext } from "@/core/model/types";
import { Badge, Button } from "./primitives";

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line-soft px-4 py-3.5 last:border-b-0">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-ink-3">
        <span className="text-[12px]">{icon}</span>{title}
      </h3>
      {children}
    </section>
  );
}

export function ContextPanel({
  ctx, onRequestChange, onWaitRun, onCancelRun, historyHref, historyCount,
}: {
  ctx: StepContext;
  /** 変更起票の入口。渡されたときだけ表示する */
  onRequestChange?: () => void;
  /** 待ちにする入口。進行中の業務にだけ渡す */
  onWaitRun?: () => void;
  /** 業務中止の入口。進行中の業務にだけ渡す */
  onCancelRun?: () => void;
  /** 変更履歴への導線。変更が1件以上あるときだけ渡す */
  historyHref?: string;
  historyCount?: number;
}) {
  // 期限はこのパネルに出さないので、中身の有無にも数えない
  const hasAnything =
    ctx.conflicts.length > 0 || ctx.missingInfo.length > 0 || ctx.notices.length > 0 ||
    ctx.rules.length > 0 || ctx.knowledge.length > 0 || ctx.derivedTasks.length > 0 ||
    ctx.tools.length > 0;

  return (
    <aside className="w-full shrink-0 lg:w-[312px]">
      <div className="sticky top-4 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line bg-surface-2 px-4 py-2.5">
          <h2 className="text-[12px] font-bold">このSTEPの情報</h2>
          <p className="mt-0.5 text-[11px] text-ink-3">現在の作業に関係するものだけを表示しています</p>
        </div>

        {/* 注意を要するものを最上部に固定（仕様 §15-4） */}
        {ctx.conflicts.length > 0 && (
          <Section title="ルールの競合" icon="⚠">
            <ul className="flex flex-col gap-2">
              {ctx.conflicts.map((c, i) => (
                <li key={i} className={`rounded-lg px-3 py-2 text-[12px] leading-relaxed ${c.severity === "high" ? "bg-danger-soft text-danger" : "bg-surface-2 text-ink-2"}`}>
                  {c.message}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/*
          期限はここには出さない（仕様 §26-6 / Phase 11）。
          業務全体の期限はヘッダーのバッジ、STEPの期限はSTEP見出しが出しており、
          同じ日付を3か所で繰り返さないため。
        */}

        {ctx.missingInfo.length > 0 && (
          <Section title="不足している業務情報" icon="❗">
            <p className="mb-2 text-[11px] leading-relaxed text-ink-3">
              この業務を完遂するために、まだ取得できていない情報です。
            </p>
            <ul className="flex flex-col gap-1.5">
              {ctx.missingInfo.map((m) => (
                <li key={m.key} className="rounded-lg bg-danger-soft px-3 py-2">
                  <span className="block text-[12.5px] font-medium text-danger">{m.label}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {ctx.notices.length > 0 && (
          <Section title="このSTEPの注意事項" icon="⚑">
            <ul className="flex flex-col gap-2">
              {ctx.notices.map((n, i) => (
                <li key={i} className={`rounded-lg px-3 py-2 ${n.level === "warn" ? "bg-danger-soft" : "bg-signal-soft"}`}>
                  <p className={`text-[12.5px] leading-relaxed ${n.level === "warn" ? "text-danger" : "text-signal"}`}>{n.text}</p>
                  <p className="mt-1 text-[11px] text-ink-3">{n.ruleName}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {ctx.rules.length > 0 && (
          <Section title="適用中のルール" icon="⚖">
            <ul className="flex flex-col gap-1.5">
              {ctx.rules.map((r) => (
                <li key={r.id} className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={r.ruleType === "temporary" ? "signal" : "neutral"}>
                      {{ case: "個別案件", temporary: "期間限定", department: "部署", standard: "標準" }[r.ruleType]}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-[12.5px] font-medium leading-snug">{r.name}</p>
                  {r.activeTo && (
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      〜{new Date(r.activeTo).toLocaleDateString("ja-JP")}まで
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {ctx.knowledge.length > 0 && (
          <Section title="関連ナレッジ" icon="▤">
            <ul className="flex flex-col gap-1.5">
              {ctx.knowledge.map((k) => (
                <li key={k.id}>
                  <details className="group rounded-lg border border-line bg-surface-2">
                    <summary className="cursor-pointer list-none px-3 py-2 text-[12.5px] font-medium hover:text-brand">
                      {k.title}
                      <span className="ml-1.5 text-[11px] text-ink-3 group-open:hidden">開く</span>
                    </summary>
                    <p className="whitespace-pre-wrap border-t border-line px-3 py-2 text-[12px] leading-relaxed text-ink-2">{k.body}</p>
                  </details>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {ctx.derivedTasks.length > 0 && (
          <Section title="この業務から発生したタスク" icon="⑂">
            <ul className="flex flex-col gap-1.5">
              {ctx.derivedTasks.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className="block rounded-lg border border-line-soft bg-surface-2 px-3 py-2 hover:border-brand">
                    <span className="text-[12.5px]">{t.title}</span>
                    {t.confirmationState === "proposed" && <Badge tone="signal">提案中</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {ctx.tools.length > 0 && (
          <Section title="必要なツール" icon="🔧">
            <ul className="flex flex-col gap-1.5">
              {ctx.tools.map((t) => (
                <li key={t.label} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span>{t.label}</span>
                  <Badge tone={t.available ? "ok" : "neutral"}>{t.available ? "利用可" : t.reason ?? "未接続"}</Badge>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {!hasAnything && (
          <div className="px-4 py-6 text-center text-[12px] text-ink-3">このSTEPに固有の注意事項はありません</div>
        )}

        {/*
          業務の途中で取れる操作。「このSTEPの情報」ではないので情報セクションと分ける。
          説明文は畳み、ボタンだけを1行に並べる。スクロールなしで見えることを優先する。
        */}
        {(onRequestChange || onWaitRun || onCancelRun) && (
          <div className="border-t border-line bg-surface-2 px-4 py-3">
            <p className="mb-2 text-[11px] font-bold tracking-wide text-ink-3">この業務に対して</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {onRequestChange && (
                <Button
                  variant="secondary" size="sm" onClick={onRequestChange}
                  title="期限や条件が変わった場合に起票して、影響を確認できます"
                >
                  変更を起票
                </Button>
              )}
              {onWaitRun && (
                <Button
                  variant="secondary" size="sm" onClick={onWaitRun}
                  title="返事や外部の処理を待つ場合、次に確認する日を決めて一旦止められます"
                >
                  待ちにする
                </Button>
              )}
              {onCancelRun && (
                <Button
                  variant="ghost" size="sm" onClick={onCancelRun}
                  title="完了ではなく、途中でやめた記録として残します"
                >
                  中止
                </Button>
              )}
            </div>
            {historyHref && historyCount ? (
              <Link href={historyHref} className="mt-2 block text-[11.5px] text-brand hover:underline">
                変更履歴（{historyCount}件）→
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
