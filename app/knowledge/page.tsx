"use client";

/**
 * ナレッジ（仕様 §16）。
 * この画面は「取りこぼしを拾う補助手段」であり、主導線ではない。
 * 本来は業務STEPから必要なものが提示される。
 */
import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useWorkflows } from "@/ui/use-navigator";
import { Badge, Card, Empty, PageHeader } from "@/ui/primitives";

const KIND_LABEL = { manual: "マニュアル", faq: "FAQ", policy: "社内ルール", material: "資料" } as const;
const SOURCE_LABEL = { internal: "社内", gdrive: "Google Drive", notion: "Notion" } as const;

export default function KnowledgePage() {
  const { knowledge } = useStore();
  const workflows = useWorkflows();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("all");

  const filtered = knowledge.filter((k) => {
    if (kind !== "all" && k.kind !== kind) return false;
    if (!q) return true;
    const t = q.toLowerCase();
    return k.title.toLowerCase().includes(t) || k.body.toLowerCase().includes(t) || k.tags.some((x) => x.includes(t));
  });

  return (
    <div className="mx-auto max-w-[900px] px-6 py-6">
      <PageHeader
        title="ナレッジ"
        description="マニュアル・FAQ・社内ルール・資料です。通常は業務のSTEPから必要なものが自動的に提示されるため、この画面は補助的な位置づけです。"
      />

      <Card className="mb-5 border-brand/30 bg-brand-soft p-4">
        <p className="text-[12.5px] leading-relaxed text-brand-ink">
          <strong className="font-bold">探さなくても出てきます。</strong>
          各ナレッジは業務のSTEPに紐付いており、該当のSTEPを開くとコンテキストパネルに自動的に表示されます。
        </p>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="キーワードで検索"
          className="min-w-[200px] flex-1 rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-brand"
        />
        <select
          value={kind} onChange={(e) => setKind(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
        >
          <option value="all">すべての種別</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <Empty>該当するナレッジはありません</Empty>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtered.map((k) => {
            const linked = workflows.filter((w) => k.linkedWorkflowKeys.includes(w.key));
            return (
              <li key={k.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-[14px] font-bold leading-snug">{k.title}</h3>
                    <div className="flex shrink-0 gap-1.5">
                      <Badge tone="neutral">{KIND_LABEL[k.kind]}</Badge>
                      <Badge tone={k.source === "internal" ? "neutral" : "brand"}>{SOURCE_LABEL[k.source]}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">{k.body}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft pt-2.5 text-[11.5px] text-ink-3">
                    <span>更新 {new Date(k.updatedAt).toLocaleDateString("ja-JP")}</span>
                    {linked.length > 0 && (
                      <span>
                        提示される業務：
                        {linked.map((w, i) => (
                          <span key={w.key}>
                            {i > 0 && "、"}
                            <Link href={`/workflows/${w.key}`} className="text-brand hover:underline">{w.name}</Link>
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Card className="mt-6 border-dashed p-4 text-center">
        <p className="text-[12.5px] text-ink-3">
          Google Drive / Notion からの取り込みは Phase 7 で接続します。現在は社内データのみを表示しています。
        </p>
      </Card>
    </div>
  );
}
