"use client";

/** 一時ルール管理（仕様 §14）。期間終了で自動的に無効になることを可視化する */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useWorkflows, useNow } from "@/ui/use-navigator";
import { ruleWeight, ruleAppliesToStep } from "@/core/rules/resolver";
import { Badge, Button, Card, PageHeader } from "@/ui/primitives";
import type { BusinessRule } from "@/core/model/types";

const TYPE_LABEL = { case: "個別案件ルール", temporary: "期間限定ルール", department: "部署ルール", standard: "標準" } as const;

export default function RulesPage() {
  const { state, dispatch } = useStore();
  const workflows = useWorkflows();
  const now = useNow();
  const [preview, setPreview] = useState<BusinessRule | null>(null);

  const grouped = useMemo(() => {
    const active: BusinessRule[] = [];
    const scheduled: BusinessRule[] = [];
    const expired: BusinessRule[] = [];
    for (const r of state.businessRules) {
      if (!r.enabled) { expired.push(r); continue; }
      if (new Date(r.activeFrom) > now) scheduled.push(r);
      else if (r.activeTo && new Date(r.activeTo) < now) expired.push(r);
      else active.push(r);
    }
    return { active, scheduled, expired };
  }, [state.businessRules, now]);

  /**
   * ルールが実際にどのSTEPへ影響するかを事前に示す（仕様 §14-8）。
   * 判定は業務ナビゲーターと同じ core の関数を使う。ここで独自判定を持たない。
   */
  function affectedSteps(rule: BusinessRule) {
    const out: { workflow: string; step: string }[] = [];
    for (const w of workflows) {
      for (const s of w.steps) {
        if (s.componentType === "branch") continue;
        if (!ruleAppliesToStep(rule, w, s)) continue;
        out.push({ workflow: w.name, step: s.title });
      }
    }
    return out;
  }

  function RuleCard({ rule, phase }: { rule: BusinessRule; phase: "active" | "scheduled" | "expired" }) {
    const affected = affectedSteps(rule);
    const itemCount = rule.effects.reduce(
      (n, e) => n + (e.type === "addChecklistItems" ? e.items.length : e.type === "addFields" ? e.fields.length : 0), 0,
    );
    return (
      <Card className={`p-4 ${phase === "expired" ? "opacity-55" : phase === "active" && rule.ruleType === "temporary" ? "border-signal/40" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={rule.ruleType === "temporary" ? "signal" : "neutral"}>{TYPE_LABEL[rule.ruleType]}</Badge>
              <Badge tone="neutral">優先度 {ruleWeight(rule)}</Badge>
              {phase === "active" && <Badge tone="ok">適用中</Badge>}
              {phase === "scheduled" && <Badge tone="brand">開始前</Badge>}
              {phase === "expired" && <Badge tone="neutral">期間終了</Badge>}
            </div>
            <h3 className="mt-2 text-[14px] font-bold leading-snug">{rule.name}</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{rule.description}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setPreview(preview?.id === rule.id ? null : rule)}>
            {preview?.id === rule.id ? "閉じる" : "影響を確認"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft pt-3 text-[11.5px] text-ink-3">
          <span>
            {new Date(rule.activeFrom).toLocaleDateString("ja-JP")}
            {rule.activeTo ? ` 〜 ${new Date(rule.activeTo).toLocaleDateString("ja-JP")}` : " 〜 （無期限）"}
          </span>
          {itemCount > 0 && <span>確認項目 {itemCount}件を追加</span>}
          <span>影響STEP {affected.length}件</span>
          <button onClick={() => dispatch({ type: "toggleRule", ruleId: rule.id })} className="ml-auto text-brand hover:underline">
            {rule.enabled ? "無効にする" : "有効にする"}
          </button>
        </div>

        {preview?.id === rule.id && (
          <div className="mt-3 rounded-lg border border-brand/30 bg-brand-soft p-3.5">
            <p className="text-[12px] font-bold text-brand">このルールの影響</p>
            {affected.length === 0 ? (
              <p className="mt-1.5 text-[12px] text-ink-2">影響するSTEPはありません。</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {affected.map((a, i) => (
                  <li key={i} className="text-[12px] text-ink-2">
                    「{a.workflow}」の <span className="font-medium">{a.step}</span> STEP
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-2.5 flex flex-col gap-1 border-t border-brand/20 pt-2.5">
              {rule.effects.map((e, i) => (
                <li key={i} className="text-[12px] text-ink-2">
                  {e.type === "addChecklistItems" && `確認項目を${e.items.length}件追加：${e.items.map((x) => x.label).join(" / ")}`}
                  {e.type === "addFields" && `入力項目を${e.fields.length}件追加`}
                  {e.type === "showNotice" && `注意文を表示：${e.text}`}
                  {e.type === "attachKnowledge" && `ナレッジを${e.knowledgeIds.length}件追加`}
                  {e.type === "requireConfirmation" && "完了前の確認を必須化"}
                  {e.type === "blockCompletion" && "条件未達なら完了をブロック"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-[900px] px-6 py-6">
      <PageHeader
        title="一時ルール"
        description="期間限定の業務ルールです。業務フローの定義は書き換えず、該当STEPに重ねて適用されます。期間が終了すると自動的に無効になります。"
      />

      <Card className="mb-6 p-4">
        <p className="text-[12.5px] font-bold">ルールの優先順位</p>
        <ol className="mt-2 flex flex-wrap gap-2 text-[12px]">
          {(["case", "temporary", "department", "standard"] as const).map((t, i) => (
            <li key={t} className="flex items-center gap-1.5">
              <span className="rounded bg-surface-2 px-2 py-1">{i + 1}. {TYPE_LABEL[t]}</span>
              {i < 3 && <span className="text-ink-3">＞</span>}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11.5px] text-ink-3">競合した場合は上位が優先されます。重要な競合は業務ナビゲーター上で警告します。</p>
      </Card>

      {(["active", "scheduled", "expired"] as const).map((key) => {
        const list = grouped[key];
        const titles = { active: "適用中", scheduled: "開始前（予約）", expired: "期間終了・無効" };
        if (list.length === 0) return null;
        return (
          <section key={key} className="mb-7">
            <h2 className="mb-3 text-[13px] font-bold">{titles[key]}（{list.length}）</h2>
            <div className="flex flex-col gap-2.5">
              {list.map((r) => <RuleCard key={r.id} rule={r} phase={key} />)}
            </div>
          </section>
        );
      })}

      <Card className="border-dashed p-5 text-center">
        <p className="text-[13px] font-medium text-ink-2">＋ 新しい一時ルールを追加</p>
        <p className="mt-1 text-[12px] text-ink-3">ルール作成フォームは Phase 5 で実装します。</p>
      </Card>

      {(() => {
        // 適用中ルールが影響する業務をデータから引く（業務名はコードに書かない）
        const target = grouped.active.flatMap((r) => affectedSteps(r))[0];
        const wf = target ? workflows.find((w) => w.name === target.workflow) : undefined;
        if (!wf) return null;
        return (
          <p className="mt-5 text-center text-[12px] text-ink-3">
            ルールが実際に業務へ反映される様子は
            <Link href={`/workflows/${wf.key}`} className="mx-1 text-brand hover:underline">{wf.name}</Link>
            で確認できます。
          </p>
        );
      })()}
    </div>
  );
}
