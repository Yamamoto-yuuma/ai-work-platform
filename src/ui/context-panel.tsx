"use client";

/**
 * コンテキストパネル。
 * 「現在のSTEPに関係するものだけ」を出す（仕様 §5 原則3 / §15）。
 * 空のセクションは見出しごと出さない（仕様 §15-4）。
 */
import Link from "next/link";
import type { StepContext } from "@/core/model/types";
import { Badge } from "./primitives";

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

export function ContextPanel({ ctx }: { ctx: StepContext }) {
  const hasAnything =
    ctx.conflicts.length > 0 || ctx.missingInfo.length > 0 || ctx.notices.length > 0 ||
    ctx.rules.length > 0 || ctx.knowledge.length > 0 || ctx.derivedTasks.length > 0 ||
    ctx.tools.length > 0 || ctx.deadline;

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

        {ctx.deadline && (
          <Section title="期限" icon="⏱">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">
                {new Date(ctx.deadline.dueAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" })}
              </span>
              <Badge tone={ctx.deadline.isOverdue ? "danger" : "brand"}>{ctx.deadline.remainingLabel}</Badge>
            </div>
          </Section>
        )}

        {ctx.missingInfo.length > 0 && (
          <Section title="不足情報" icon="❗">
            <ul className="flex flex-col gap-1.5">
              {ctx.missingInfo.map((m) => (
                <li key={m.key} className="flex items-start justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2">
                  <span className="text-[12.5px] font-medium text-danger">{m.label}</span>
                  <span className="shrink-0 text-[11px] text-danger/80">{m.reason}</span>
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
                <li key={r.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
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
                  <Link href={`/tasks/${t.id}`} className="block rounded-lg border border-line bg-surface-2 px-3 py-2 hover:border-brand">
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
      </div>
    </aside>
  );
}
